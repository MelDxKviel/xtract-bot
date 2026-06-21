import { describe, expect, it } from "vitest";

import type { AppContext } from "@/bot/context";
import { privateComposer } from "@/bot/handlers/private";
import { formatTweet } from "@/formatters/telegram";
import { makeMedia, makeTweet, type TweetData } from "@/providers/base";
import type { ProcessOptions, ShareResult, TweetShareService } from "@/services/tweetShare";

import { createHarness, type HarnessOptions } from "./support/botHarness";

function tweet(overrides: Partial<TweetData> = {}): TweetData {
  return makeTweet({
    tweetId: "123",
    url: "https://x.com/user/status/123",
    authorName: "User",
    authorUsername: "user",
    authorUrl: "https://x.com/user",
    text: "hello world",
    ...overrides,
  });
}

function successResult(overrides: Partial<ShareResult> = {}): ShareResult {
  const data = overrides.tweet ?? tweet();
  return {
    status: "success",
    ok: true,
    tweetId: data.tweetId,
    sourceUrl: data.url,
    normalizedUrl: data.url,
    tweet: data,
    post: formatTweet(data),
    errorCode: null,
    elapsedMs: 1,
    cacheHit: false,
    threadSize: 1,
    ...overrides,
  };
}

function errorResult(status: ShareResult["status"], errorCode: string): ShareResult {
  return {
    status,
    ok: false,
    tweetId: null,
    sourceUrl: null,
    normalizedUrl: null,
    tweet: null,
    post: null,
    errorCode,
    elapsedMs: null,
    cacheHit: false,
    threadSize: 0,
  };
}

interface InjectConfig {
  result?: ShareResult;
  isAdmin?: boolean;
  onProcess?: (text: string) => void;
}

function inject(config: InjectConfig = {}): (ctx: AppContext) => void {
  const tweetShare: Pick<TweetShareService, "processText" | "processUrl"> = {
    async processText(text: string, _options: ProcessOptions): Promise<ShareResult> {
      config.onProcess?.(text);
      return config.result ?? successResult();
    },
    async processUrl(): Promise<ShareResult> {
      return config.result ?? successResult();
    },
  };
  return (ctx) => {
    ctx.services = {
      access: { isAdmin: () => config.isAdmin ?? false },
      stats: {},
      tweetShare,
    } as unknown as AppContext["services"];
    ctx.runtimeConfig = { whitelistEnabled: true, russianTranslationEnabled: false };
  };
}

function privateText(text: string, command = false): Record<string, unknown> {
  const message: Record<string, unknown> = {
    message_id: 10,
    date: 0,
    chat: { id: 100, type: "private", first_name: "U" },
    from: { id: 100, is_bot: false, first_name: "U" },
    text,
  };
  if (command) {
    message.entities = [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0]!.length }];
  }
  return { update_id: 1, message };
}

function harness(
  config: InjectConfig = {},
  options: Partial<HarnessOptions> = {},
): ReturnType<typeof createHarness> {
  return createHarness({
    register: (bot) => bot.use(privateComposer),
    inject: inject(config),
    ...options,
  });
}

const TWEET_URL = "https://x.com/user/status/123";

describe("private handler", () => {
  it("greets on /start", async () => {
    const h = harness();
    await h.handle(privateText("/start", true));
    const reply = h.lastCall("sendMessage");
    expect(reply).toBeDefined();
    expect(String(reply!.payload.text)).toContain("Xtract Bot");
  });

  it("answers unknown commands", async () => {
    const h = harness();
    await h.handle(privateText("/whatever"));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("Неизвестная команда");
  });

  it("replies with the invalid-link hint for non-tweet text", async () => {
    const h = harness({ result: errorResult("invalid_url", "invalid_url") });
    await h.handle(privateText("just chatting"));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("Пришлите ссылку");
  });

  it("streams a thinking draft and sends a rich message on success", async () => {
    const h = harness({ result: successResult() });
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendRichMessageDraft").length).toBe(1);
    expect(h.callsTo("sendRichMessage").length).toBe(1);
  });

  it("passes the message text to the share service", async () => {
    let seen = "";
    const h = harness({ onProcess: (text) => (seen = text) });
    await h.handle(privateText(TWEET_URL));
    expect(seen).toBe(TWEET_URL);
  });

  it("reports a fetch error", async () => {
    const h = harness({ result: errorResult("error", "not_found") });
    await h.handle(privateText(TWEET_URL));
    const reply = h.lastCall("sendMessage");
    expect(String(reply!.payload.text)).toContain("Не удалось получить пост");
  });

  it("falls back to a media group when the rich message is rejected", async () => {
    const withMedia = tweet({
      media: [
        makeMedia({ type: "photo", url: "https://pbs.twimg.com/a.jpg" }),
        makeMedia({ type: "photo", url: "https://pbs.twimg.com/b.jpg" }),
      ],
    });
    const h = harness(
      { result: successResult({ tweet: withMedia, post: formatTweet(withMedia) }) },
      { failMethods: ["sendRichMessage"] },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendRichMessage").length).toBe(1);
    expect(h.callsTo("sendMediaGroup").length).toBe(1);
  });

  it("falls back to plain text when rich message fails and there is no media", async () => {
    const h = harness({ result: successResult() }, { failMethods: ["sendRichMessage"] });
    await h.handle(privateText(TWEET_URL));
    const reply = h.lastCall("sendMessage");
    expect(reply).toBeDefined();
    expect(String(reply!.payload.text)).toContain("hello world");
  });
});
