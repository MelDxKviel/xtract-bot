import { describe, expect, it } from "vitest";

import {
  TweetProviderError,
  makeTweet,
  tweetFromPayload,
  tweetToPayload,
  type TweetData,
  type TweetProvider,
} from "@/providers/base";
import type { FetchLike } from "@/providers/http";
import { PublicEmbedTweetProvider } from "@/providers/publicEmbed";
import { buildRichMessage } from "@/formatters/richMessage";
import type { AppContext } from "@/bot/context";
import { inlineComposer } from "@/bot/handlers/inline";
import { privateComposer } from "@/bot/handlers/private";
import fixture from "./fixtures/video-2105979012426174943.json";
import { createHarness } from "./support/botHarness";
import type { CacheEntry, TweetCacheRepository } from "@/repositories/tweetCache";
import { createTweetShareService, type ProcessOptions } from "@/services/tweetShare";

function makeTweetData(overrides: Partial<TweetData> = {}): TweetData {
  return makeTweet({
    tweetId: "123",
    url: "https://x.com/user/status/123",
    authorName: "User",
    authorUsername: "user",
    authorUrl: "https://x.com/user",
    text: "text",
    ...overrides,
  });
}

const OPTIONS: ProcessOptions = { telegramUserId: 1, chatId: 10, mode: "private" };

class FakeCache implements TweetCacheRepository {
  readonly entries = new Map<string, { tweet?: TweetData; errorCode?: string }>();
  setCalls = 0;
  negativeCalls = 0;

  constructor(seed?: TweetData) {
    if (seed) this.entries.set(seed.tweetId, { tweet: seed });
  }

  async getEntry(tweetId: string): Promise<CacheEntry | null> {
    const entry = this.entries.get(tweetId);
    if (!entry) return null;
    if (entry.tweet) return { kind: "hit", tweet: entry.tweet };
    return { kind: "negative", errorCode: entry.errorCode ?? "not_found" };
  }

  async set(tweet: TweetData): Promise<void> {
    this.entries.set(tweet.tweetId, { tweet });
    this.setCalls += 1;
  }

  async setNegative(tweetId: string, _sourceUrl: string, errorCode: string): Promise<void> {
    this.entries.set(tweetId, { errorCode });
    this.negativeCalls += 1;
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async clearAll(): Promise<number> {
    const removed = this.entries.size;
    this.entries.clear();
    return removed;
  }

  async clearExpired(): Promise<number> {
    return 0;
  }
}

class FakeEvents {
  readonly items: Record<string, unknown>[] = [];
  async create(input: unknown): Promise<void> {
    this.items.push(input as Record<string, unknown>);
  }
}

class FakeProvider implements TweetProvider {
  readonly calls: string[] = [];

  constructor(
    private readonly tweets: Map<string, TweetData> = new Map(),
    private readonly failCode: string | null = null,
  ) {}

  async getTweet(tweetId: string, sourceUrl: string): Promise<TweetData> {
    this.calls.push(tweetId);
    if (this.failCode) {
      throw new TweetProviderError("failed", { code: this.failCode });
    }
    return this.tweets.get(tweetId) ?? makeTweetData({ tweetId, url: sourceUrl });
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // no-op
  }
}

interface ServiceParts {
  provider: FakeProvider;
  cache: FakeCache;
  events: FakeEvents;
  service: ReturnType<typeof createTweetShareService>;
}

function makeService(
  options: {
    provider?: FakeProvider;
    cache?: FakeCache;
    negativeCacheTtlSeconds?: number;
    threadUnrollEnabled?: boolean;
    threadMaxTweets?: number;
    mediaFetch?: FetchLike;
  } = {},
): ServiceParts {
  const provider = options.provider ?? new FakeProvider();
  const cache = options.cache ?? new FakeCache();
  const events = new FakeEvents();
  const service = createTweetShareService({
    provider,
    cacheRepository: cache,
    shareEventsRepository: events,
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: options.negativeCacheTtlSeconds ?? 600,
    threadUnrollEnabled: options.threadUnrollEnabled ?? false,
    threadMaxTweets: options.threadMaxTweets ?? 10,
    mediaFetch: options.mediaFetch,
  });
  return { provider, cache, events, service };
}

describe("TweetShareService", () => {
  it.each(["private", "inline"] as const)(
    "refreshes and caches a playable rendition of the reported video in %s mode",
    async (mode) => {
      const publicProvider = new PublicEmbedTweetProvider({
        fetch: async () => new Response(JSON.stringify(fixture)),
      });
      const tweet = await publicProvider.getTweet(fixture.tweet.id, fixture.tweet.url);
      const oldPayload = tweetToPayload(tweet);
      delete oldPayload.media[0]!.video_variants;
      if (mode === "inline") {
        oldPayload.media[0]!.type = "photo";
        oldPayload.media[0]!.url = fixture.tweet.media.all[0]!.thumbnail_url;
      }
      const cache = new FakeCache(tweetFromPayload(oldPayload));
      const provider = new FakeProvider(new Map([[tweet.tweetId, tweet]]));
      const probes: string[] = [];
      const { service } = makeService({
        provider,
        cache,
        mediaFetch: async (url) => {
          probes.push(url);
          return new Response(null, {
            headers: {
              "content-length": url.includes("1920x1080") ? "56861214" : "12328458",
            },
          });
        },
      });
      const first = await service.processText(fixture.tweet.url, { ...OPTIONS, mode });
      expect(first.ok).toBe(true);
      expect(first.cacheHit).toBe(false);
      expect(first.post!.media).toHaveLength(1);
      expect(first.post!.media[0]).toMatchObject({ type: "video", width: 1280, height: 720 });
      const rich = buildRichMessage(first.post!);
      expect(rich.html).toContain("<video");
      expect(rich.html).toContain("1280x720");
      expect(rich.html).not.toContain(fixture.tweet.media.all[0]!.thumbnail_url);

      const second = await service.processText(fixture.tweet.url, { ...OPTIONS, mode });
      expect(second.cacheHit).toBe(true);
      expect(second.post!.media).toEqual(first.post!.media);
      expect(provider.calls).toEqual([tweet.tweetId]);
      expect(probes).toHaveLength(2);
      expect(cache.setCalls).toBe(1);

      // Exercise the real Telegram handlers, including rejection of rich media.
      // Both paths must retain the selected MP4 instead of attaching its cover.
      for (const failRich of [false, true]) {
        const h = createHarness({
          register: (bot) => bot.use(mode === "private" ? privateComposer : inlineComposer),
          inject: (ctx) => {
            ctx.services = { tweetShare: service } as AppContext["services"];
          },
          failCall: (call) => failRich && Boolean(call.payload.rich_message),
        });
        const from = { id: 1, is_bot: false, first_name: "User" };
        await h.handle(
          mode === "private"
            ? {
                update_id: 1,
                message: {
                  message_id: 1,
                  date: 0,
                  chat: { id: 1, type: "private" },
                  from,
                  text: fixture.tweet.url,
                },
              }
            : {
                update_id: 1,
                chosen_inline_result: {
                  result_id: `tweet-${tweet.tweetId}`,
                  inline_message_id: "MID",
                  from,
                  query: fixture.tweet.url,
                },
              },
        );
        if (failRich) {
          const call = h.lastCall(mode === "private" ? "sendVideo" : "editMessageMedia")!;
          expect(call).toBeDefined();
          if (mode === "private") expect(call.payload.video).toBe(first.post!.media[0]!.url);
          else
            expect(call.payload.media).toMatchObject({
              type: "video",
              media: first.post!.media[0]!.url,
            });
        } else {
          const call = h.lastCall(mode === "private" ? "sendRichMessage" : "editMessageText")!;
          expect(call.payload.rich_message).toMatchObject({
            html: expect.stringContaining("1280x720"),
          });
        }
        expect(h.callsTo("sendPhoto")).toHaveLength(0);
        expect(JSON.stringify(h.calls)).not.toContain(fixture.tweet.media.all[0]!.thumbnail_url);
      }
    },
  );

  it("fetches via provider and records success", async () => {
    const { provider, events, service } = makeService();
    const result = await service.processText("https://x.com/user/status/123", OPTIONS);

    expect(result.ok).toBe(true);
    expect(provider.calls).toEqual(["123"]);
    expect(events.items[0]!.status).toBe("success");
  });

  it("uses cache when present", async () => {
    const { provider, service } = makeService({ cache: new FakeCache(makeTweetData()) });
    const result = await service.processText("https://x.com/user/status/123", OPTIONS);

    expect(result.ok).toBe(true);
    expect(result.cacheHit).toBe(true);
    expect(provider.calls).toEqual([]);
  });

  it("records provider errors", async () => {
    const { events, service } = makeService({
      provider: new FakeProvider(new Map(), "not_found"),
    });
    const result = await service.processText("https://x.com/user/status/123", OPTIONS);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("not_found");
    expect(events.items[0]!.status).toBe("error");
  });

  it("returns invalid_url for text without a tweet link", async () => {
    const { provider, service } = makeService();
    const result = await service.processText("just some text", OPTIONS);
    expect(result.status).toBe("invalid_url");
    expect(provider.calls).toEqual([]);
  });
});

describe("negative caching", () => {
  it("caches terminal errors and short-circuits the provider", async () => {
    const provider = new FakeProvider(new Map(), "not_found");
    const cache = new FakeCache();
    const { service } = makeService({ provider, cache });

    const first = await service.processText("https://x.com/user/status/123", OPTIONS);
    expect(first.errorCode).toBe("not_found");
    expect(cache.negativeCalls).toBe(1);

    const second = await service.processText("https://x.com/user/status/123", OPTIONS);
    expect(second.errorCode).toBe("not_found");
    // Provider hit once total: the second call served from the negative cache.
    expect(provider.calls).toEqual(["123"]);
  });

  it("does not negative-cache transient errors", async () => {
    const provider = new FakeProvider(new Map(), "provider_rate_limited");
    const cache = new FakeCache();
    const { service } = makeService({ provider, cache });

    await service.processText("https://x.com/user/status/123", OPTIONS);
    await service.processText("https://x.com/user/status/123", OPTIONS);

    expect(cache.negativeCalls).toBe(0);
    expect(provider.calls).toEqual(["123", "123"]);
  });

  it("can be disabled via a zero TTL", async () => {
    const provider = new FakeProvider(new Map(), "not_found");
    const cache = new FakeCache();
    const { service } = makeService({ provider, cache, negativeCacheTtlSeconds: 0 });

    await service.processText("https://x.com/user/status/123", OPTIONS);
    await service.processText("https://x.com/user/status/123", OPTIONS);

    expect(cache.negativeCalls).toBe(0);
    expect(provider.calls).toEqual(["123", "123"]);
  });
});

describe("thread unrolling", () => {
  function selfThread(): Map<string, TweetData> {
    const grandparent = makeTweetData({
      tweetId: "1",
      url: "https://x.com/user/status/1",
      text: "first",
    });
    const parent = makeTweetData({
      tweetId: "2",
      url: "https://x.com/user/status/2",
      text: "second",
      inReplyToTweetId: "1",
    });
    const root = makeTweetData({
      tweetId: "3",
      url: "https://x.com/user/status/3",
      text: "third",
      inReplyToTweetId: "2",
      repliedToTweet: parent,
    });
    return new Map([
      ["1", grandparent],
      ["2", parent],
      ["3", root],
    ]);
  }

  it("walks up a same-author reply chain", async () => {
    const provider = new FakeProvider(selfThread());
    const { service } = makeService({ provider, threadUnrollEnabled: true });

    const result = await service.processUrl(
      {
        tweetId: "3",
        sourceUrl: "https://x.com/user/status/3",
        normalizedUrl: "https://x.com/user/status/3",
      },
      OPTIONS,
    );

    expect(result.ok).toBe(true);
    expect(result.threadSize).toBe(3);
    // Root (3) fetched, parent (2) reused from repliedToTweet, grandparent (1) fetched.
    expect(provider.calls).toEqual(["3", "1"]);
    expect(result.post!.html).toContain("🧵");
  });

  it("does not unroll when disabled", async () => {
    const provider = new FakeProvider(selfThread());
    const { service } = makeService({ provider, threadUnrollEnabled: false });

    const result = await service.processUrl(
      {
        tweetId: "3",
        sourceUrl: "https://x.com/user/status/3",
        normalizedUrl: "https://x.com/user/status/3",
      },
      OPTIONS,
    );

    expect(result.threadSize).toBe(1);
    expect(provider.calls).toEqual(["3"]);
  });

  it("stops at a different author", async () => {
    const parent = makeTweetData({
      tweetId: "2",
      authorUsername: "someone_else",
      authorName: "Someone Else",
      inReplyToTweetId: "1",
    });
    const root = makeTweetData({
      tweetId: "3",
      url: "https://x.com/user/status/3",
      inReplyToTweetId: "2",
      repliedToTweet: parent,
    });
    const provider = new FakeProvider(new Map([["3", root]]));
    const { service } = makeService({ provider, threadUnrollEnabled: true });

    const result = await service.processUrl(
      {
        tweetId: "3",
        sourceUrl: "https://x.com/user/status/3",
        normalizedUrl: "https://x.com/user/status/3",
      },
      OPTIONS,
    );

    expect(result.threadSize).toBe(1);
    expect(provider.calls).toEqual(["3"]);
  });

  it("matches the thread author case-insensitively", async () => {
    // Different providers (or older cache entries) may disagree on handle
    // casing; X handles are case-insensitive, so the thread must still unroll.
    const parent = makeTweetData({
      tweetId: "2",
      url: "https://x.com/User/status/2",
      authorUsername: "User",
      text: "second",
    });
    const root = makeTweetData({
      tweetId: "3",
      url: "https://x.com/user/status/3",
      authorUsername: "user",
      text: "third",
      inReplyToTweetId: "2",
      repliedToTweet: parent,
    });
    const provider = new FakeProvider(new Map([["3", root]]));
    const { service } = makeService({ provider, threadUnrollEnabled: true });

    const result = await service.processUrl(
      {
        tweetId: "3",
        sourceUrl: "https://x.com/user/status/3",
        normalizedUrl: "https://x.com/user/status/3",
      },
      OPTIONS,
    );

    expect(result.threadSize).toBe(2);
  });

  it("respects the max-tweets cap", async () => {
    const provider = new FakeProvider(selfThread());
    const { service } = makeService({ provider, threadUnrollEnabled: true, threadMaxTweets: 2 });

    const result = await service.processUrl(
      {
        tweetId: "3",
        sourceUrl: "https://x.com/user/status/3",
        normalizedUrl: "https://x.com/user/status/3",
      },
      OPTIONS,
    );

    expect(result.threadSize).toBe(2);
    // Capped before fetching the grandparent.
    expect(provider.calls).toEqual(["3"]);
  });
});
