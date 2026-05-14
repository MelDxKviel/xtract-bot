import { describe, expect, it } from "vitest";

import {
  TweetProviderError,
  makeTweet,
  type TweetData,
  type TweetProvider,
} from "@/providers/base";
import type { TweetCacheRepository } from "@/repositories/tweetCache";
import { createTweetShareService } from "@/services/tweetShare";

function makeTweetData(tweetId = "123", url = "https://x.com/user/status/123"): TweetData {
  return makeTweet({
    tweetId,
    url,
    authorName: "User",
    authorUsername: "user",
    authorUrl: "https://x.com/user",
    text: "text",
  });
}

class FakeCache implements TweetCacheRepository {
  setCalls = 0;
  constructor(public tweet: TweetData | null = null) {}

  async get(tweetId: string): Promise<TweetData | null> {
    return this.tweet && this.tweet.tweetId === tweetId ? this.tweet : null;
  }

  async set(tweet: TweetData): Promise<void> {
    this.tweet = tweet;
    this.setCalls += 1;
  }
}

class FakeEvents {
  readonly items: Record<string, unknown>[] = [];
  async create(input: unknown): Promise<void> {
    this.items.push(input as Record<string, unknown>);
  }
}

class FakeProvider implements TweetProvider {
  calls = 0;
  constructor(private readonly options: { fail?: boolean } = {}) {}

  async getTweet(tweetId: string, sourceUrl: string): Promise<TweetData> {
    this.calls += 1;
    if (this.options.fail) {
      throw new TweetProviderError("failed", { code: "not_found" });
    }
    return makeTweetData(tweetId, sourceUrl);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // no-op
  }
}

describe("TweetShareService", () => {
  it("fetches via provider and records success", async () => {
    const provider = new FakeProvider();
    const events = new FakeEvents();
    const service = createTweetShareService({
      provider,
      cacheRepository: new FakeCache(),
      shareEventsRepository: events,
      cacheTtlSeconds: 60,
    });

    const result = await service.processText("https://x.com/user/status/123", {
      telegramUserId: 1,
      chatId: 10,
      mode: "private",
    });

    expect(result.ok).toBe(true);
    expect(provider.calls).toBe(1);
    expect(events.items[0]!.status).toBe("success");
  });

  it("uses cache when present", async () => {
    const provider = new FakeProvider();
    const events = new FakeEvents();
    const service = createTweetShareService({
      provider,
      cacheRepository: new FakeCache(makeTweetData()),
      shareEventsRepository: events,
      cacheTtlSeconds: 60,
    });

    const result = await service.processText("https://x.com/user/status/123", {
      telegramUserId: 1,
      chatId: 10,
      mode: "private",
    });

    expect(result.ok).toBe(true);
    expect(result.cacheHit).toBe(true);
    expect(provider.calls).toBe(0);
  });

  it("records provider errors", async () => {
    const events = new FakeEvents();
    const service = createTweetShareService({
      provider: new FakeProvider({ fail: true }),
      cacheRepository: new FakeCache(),
      shareEventsRepository: events,
      cacheTtlSeconds: 60,
    });

    const result = await service.processText("https://x.com/user/status/123", {
      telegramUserId: 1,
      chatId: 10,
      mode: "private",
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("not_found");
    expect(events.items[0]!.status).toBe("error");
  });
});
