import type { Message, MessageEntity } from "grammy/types";
import { describe, expect, it } from "vitest";

import type { AppContext } from "@/bot/context";
import { privateComposer } from "@/bot/handlers/private";
import { accessMiddleware } from "@/bot/middlewares/access";
import { rateLimitMiddleware } from "@/bot/middlewares/rateLimit";
import { TweetProviderError } from "@/providers/base";
import { FakeTweetProvider } from "@/providers/fake";
import { FakeProfileProvider } from "@/providers/fakeProfile";
import type { ProfileCacheRepository } from "@/repositories/profileCache";
import type { CreateShareEventInput } from "@/repositories/shareEvents";
import type { TweetCacheRepository } from "@/repositories/tweetCache";
import { createProfileShareService } from "@/services/profileShare";
import { createRateLimiter } from "@/services/rateLimit";
import { createTweetShareService } from "@/services/tweetShare";

import { createHarness, type HarnessOptions } from "./support/botHarness";

const TWEET_URL = "https://x.com/user/status/123";

function message(fields: Partial<Message>): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: { id: 100, type: "private" },
      from: { id: 100, is_bot: false, first_name: "U" },
      forward_origin: { type: "hidden_user", date: 0, sender_user_name: "Channel" },
      ...fields,
    },
  };
}

function photo(caption?: string, caption_entities?: MessageEntity[]): Partial<Message> {
  return {
    photo: [{ file_id: "PHOTO", file_unique_id: "UNIQUE", width: 100, height: 100 }],
    caption,
    caption_entities,
  };
}

function harness(
  options: { hasAccess?: boolean; maxRequests?: number; unavailable?: boolean } = {},
  apiOptions: Pick<HarnessOptions, "failMethods"> = {},
) {
  // No database or external network: the real share services use cache misses
  // and deterministic providers. Events expose which link actually got shared.
  const events: CreateShareEventInput[] = [];
  const cache: TweetCacheRepository & ProfileCacheRepository = {
    getEntry: async () => null,
    set: async () => {},
    setNegative: async () => {},
    count: async () => 0,
    clearAll: async () => 0,
    clearExpired: async () => 0,
  };
  const shareEventsRepository = {
    create: async (event: CreateShareEventInput) => {
      events.push(event);
    },
  };
  const provider = new FakeTweetProvider();
  const tweetShare = createTweetShareService({
    provider: {
      getTweet: async (id, url) => {
        if (options.unavailable) throw new TweetProviderError("missing", { code: "not_found" });
        return provider.getTweet(id, url);
      },
      health: async () => true,
      close: async () => {},
    },
    cacheRepository: cache,
    shareEventsRepository,
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: 60,
    threadUnrollEnabled: false,
    threadMaxTweets: 10,
  });
  const profileShare = createProfileShareService({
    provider: new FakeProfileProvider(),
    cacheRepository: cache,
    shareEventsRepository,
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: 60,
  });
  const limiter = createRateLimiter({ maxRequests: options.maxRequests ?? 20, windowMs: 60_000 });
  const h = createHarness({
    ...apiOptions,
    inject: (ctx) => {
      ctx.services = {
        access: {
          registerUser: async () => {},
          isAdmin: () => false,
          hasAccess: async () => options.hasAccess ?? true,
        },
        tweetShare,
        profileShare,
      } as unknown as AppContext["services"];
    },
    register: (bot) => bot.use(accessMiddleware, rateLimitMiddleware(limiter), privateComposer),
  });
  return { ...h, events };
}

describe("sharing links from Telegram messages", () => {
  it("explains forwarding and hidden links in /help", async () => {
    const h = harness();
    await h.handle(
      message({
        text: "/help",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      }),
    );
    expect(h.lastCall("sendMessage")?.payload.text).toContain("Перешлите");
    expect(h.lastCall("sendMessage")?.payload.text).toContain("подписи");
    expect(h.lastCall("sendMessage")?.payload.text).toContain("под текстом");
  });

  it.each([
    {
      text: "Читайте пост",
      entities: [{ type: "text_link", offset: 0, length: 12, url: TWEET_URL }],
    },
    photo(`Источник: ${TWEET_URL}`),
    photo("Читайте пост", [{ type: "text_link", offset: 0, length: 12, url: TWEET_URL }]),
    {
      video: { file_id: "VIDEO", file_unique_id: "V", width: 100, height: 100, duration: 1 },
      caption: TWEET_URL,
    },
    {
      document: { file_id: "DOCUMENT", file_unique_id: "D" },
      caption: "Пост",
      caption_entities: [{ type: "text_link", offset: 0, length: 4, url: TWEET_URL }],
    },
  ] satisfies Partial<Message>[])("shares the post from %j", async (fields) => {
    const h = harness();
    await h.handle(message(fields));
    expect(h.events).toEqual([
      expect.objectContaining({
        telegramUserId: 100,
        chatId: 100,
        tweetId: "123",
        mode: "private",
        status: "success",
      }),
    ]);
    expect(h.lastCall("sendRichMessage")?.payload).toMatchObject({
      rich_message: { html: expect.stringContaining("Demo tweet 123") },
      reply_markup: { inline_keyboard: [[expect.objectContaining({ url: TWEET_URL })]] },
    });
    expect(h.callsTo("sendRichMessageDraft")).toHaveLength(1);
  });

  it.each([
    {
      text: "Автор",
      entities: [{ type: "text_link", offset: 0, length: 5, url: "https://fixupx.com/jack" }],
    },
    photo("https://twitter.com/jack"),
    photo("Автор", [{ type: "text_link", offset: 0, length: 5, url: "https://x.com/jack" }]),
  ] satisfies Partial<Message>[])("shares the profile from %j", async (fields) => {
    const h = harness();
    await h.handle(message(fields));
    expect(h.events[0]).toMatchObject({ tweetId: "profile:jack", status: "success" });
    expect(h.lastCall("sendRichMessage")?.payload).toMatchObject({
      rich_message: {
        html: expect.stringContaining('Demo profile for <a href="https://x.com/jack">@jack</a>'),
      },
      reply_markup: { inline_keyboard: [[expect.objectContaining({ url: "https://x.com/jack" })]] },
    });
  });

  it("uses UTF-16 offsets and the hidden target instead of a URL-looking label", async () => {
    const h = harness();
    await h.handle(
      message({
        text: "🔥 https://x.com/other/status/999",
        entities: [{ type: "text_link", offset: 3, length: 30, url: TWEET_URL }],
      }),
    );
    expect(h.events[0]?.tweetId).toBe("123");
    expect(h.lastCall("sendRichMessage")?.payload.rich_message).toMatchObject({
      html: expect.stringContaining("Demo tweet 123"),
    });
  });

  it("keeps post priority over a profile and picks the first post in reading order", async () => {
    const h = harness();
    await h.handle(
      message({
        text: "https://x.com/jack Первый Второй https://x.com/u/status/789",
        entities: [
          { type: "text_link", offset: 26, length: 6, url: "https://x.com/u/status/456" },
          { type: "bold", offset: 19, length: 6 },
          { type: "text_link", offset: 19, length: 6, url: TWEET_URL },
        ],
      }),
    );
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.tweetId).toBe("123");
  });

  it.each([
    "https://example.com/https://x.com/u/status/123",
    "https://x.com.evil.test/u/status/123",
    "http://x.com/u/status/123",
    "ftp://x.com/u/status/123",
    "javascript:alert(1)",
  ])("rejects an unsupported hidden target %s even behind a valid-looking label", async (url) => {
    const h = harness();
    await h.handle(
      message({
        text: TWEET_URL,
        entities: [{ type: "text_link", offset: 0, length: TWEET_URL.length, url }],
      }),
    );
    expect(h.events).toHaveLength(0);
    expect(h.callsTo("sendRichMessageDraft")).toHaveLength(0);
    expect(h.callsTo("sendRichMessage")).toHaveLength(0);
    expect(h.lastCall("sendMessage")?.payload.text).toContain("Пришлите ссылку");
  });

  it("reports a provider error for a caption link", async () => {
    const h = harness({ unavailable: true });
    await h.handle(message(photo(TWEET_URL)));
    expect(h.events[0]).toMatchObject({ tweetId: "123", status: "error", errorCode: "not_found" });
    expect(h.lastCall("sendMessage")?.payload.text).toContain("Не удалось получить пост");
  });

  it("preserves the legacy fallback for a hidden post link", async () => {
    const h = harness({}, { failMethods: ["sendRichMessage"] });
    await h.handle(
      message({
        text: "Пост",
        entities: [{ type: "text_link", offset: 0, length: 4, url: TWEET_URL }],
      }),
    );
    expect(h.lastCall("sendMessage")?.payload).toMatchObject({
      text: expect.stringContaining("Demo tweet 123"),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[expect.objectContaining({ url: TWEET_URL })]] },
    });
  });

  it.each([
    { text: "Пост", entities: [{ type: "text_link", offset: 0, length: 4, url: TWEET_URL }] },
    photo(TWEET_URL),
    photo("Автор", [{ type: "text_link", offset: 0, length: 5, url: "https://x.com/jack" }]),
  ] satisfies Partial<Message>[])(
    "applies the same rate budget to %j and ordinary links",
    async (fields) => {
      const h = harness({ maxRequests: 1 });
      await h.handle(message(fields));
      await h.handle(message({ text: TWEET_URL }));
      expect(h.events).toHaveLength(1);
      expect(h.callsTo("sendRichMessage")).toHaveLength(1);
      expect(h.callsTo("sendRichMessageDraft")).toHaveLength(1);
      expect(h.lastCall("sendMessage")?.payload.text).toContain("Слишком много запросов");
    },
  );

  it("blocks forwarded captions for users without access", async () => {
    const h = harness({ hasAccess: false });
    await h.handle(message(photo(TWEET_URL)));
    expect(h.events).toHaveLength(0);
    expect(h.callsTo("sendRichMessageDraft")).toHaveLength(0);
    expect(h.lastCall("sendMessage")?.payload.text).toContain("Доступ закрыт");
  });

  it("does not treat a caption starting with a slash as a command", async () => {
    const h = harness();
    await h.handle(message(photo(`/photo ${TWEET_URL}`)));
    expect(h.events[0]?.tweetId).toBe("123");
  });

  it("does not consume the rate budget for captions without a supported link", async () => {
    const h = harness({ maxRequests: 1 });
    await h.handle(message(photo("Просто фото")));
    expect(h.lastCall("sendMessage")?.payload.text).toContain("Пришлите ссылку");
    await h.handle(message({ text: TWEET_URL }));
    expect(h.events).toHaveLength(1);
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("leaves uncaptioned media and group messages alone", async () => {
    const h = harness();
    await h.handle(message(photo()));
    await h.handle(message({ text: TWEET_URL, chat: { id: -100, type: "group", title: "G" } }));
    expect(h.events).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });
});
