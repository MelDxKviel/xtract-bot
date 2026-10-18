import { describe, expect, it } from "vitest";

import type { AppContext } from "@/bot/context";
import { inlineComposer } from "@/bot/handlers/inline";
import { privateComposer } from "@/bot/handlers/private";
import { accessMiddleware } from "@/bot/middlewares/access";
import { rateLimitMiddleware } from "@/bot/middlewares/rateLimit";
import { loadSettings } from "@/config";
import { makeMedia, makeTweet, TweetProviderError } from "@/providers/base";
import { makeProfile } from "@/providers/profileBase";
import type { ProfileCacheEntry, ProfileCacheRepository } from "@/repositories/profileCache";
import type { CreateShareEventInput } from "@/repositories/shareEvents";
import type { CacheEntry, TweetCacheRepository } from "@/repositories/tweetCache";
import { createProfileShareService } from "@/services/profileShare";
import { createRateLimiter } from "@/services/rateLimit";
import { createTweetShareService } from "@/services/tweetShare";

import { createHarness, type HarnessOptions, type RecordedCall } from "./support/botHarness";

const POST_URL = "https://x.com/user/status/123";
const PROFILE_URL = "https://x.com/user";
const USER = { id: 100, is_bot: false, first_name: "U" };
const SETTINGS = loadSettings({
  BOT_TOKEN: "12345:TEST",
  DATABASE_URL: "postgres://localhost/test",
});

function harness(
  config: {
    tweetError?: string | null;
    profileError?: string | null;
    allowed?: boolean;
    admin?: boolean;
    maxRequests?: number;
  } = {},
  options: Partial<HarnessOptions> = {},
) {
  const state = {
    tweetError: "provider_timeout" as string | null,
    profileError: "provider_timeout" as string | null,
    allowed: true,
    admin: false,
    ...config,
  };
  const providerCalls: { kind: string; id: string; url: string }[] = [];
  const events: CreateShareEventInput[] = [];
  const entries = new Map<string, CacheEntry>();
  const profiles = new Map<string, ProfileCacheEntry>();
  const cache: TweetCacheRepository = {
    async getEntry(id) {
      return entries.get(id) ?? null;
    },
    async set(tweet) {
      entries.set(tweet.tweetId, { kind: "hit", tweet });
    },
    async setNegative(id, _url, errorCode) {
      entries.set(id, { kind: "negative", errorCode });
    },
    async count() {
      return entries.size;
    },
    async clearAll() {
      const count = entries.size;
      entries.clear();
      return count;
    },
    async clearExpired() {
      return 0;
    },
  };
  const profileCache: ProfileCacheRepository = {
    async getEntry(id) {
      return profiles.get(id.toLowerCase()) ?? null;
    },
    async set(profile) {
      profiles.set(profile.username.toLowerCase(), { kind: "hit", profile });
    },
    async setNegative(id, _url, errorCode) {
      profiles.set(id.toLowerCase(), { kind: "negative", errorCode });
    },
    async count() {
      return profiles.size;
    },
    async clearAll() {
      const count = profiles.size;
      profiles.clear();
      return count;
    },
    async clearExpired() {
      return 0;
    },
  };
  const shareEventsRepository = {
    async create(event: CreateShareEventInput) {
      events.push(event);
    },
  };
  const tweetShare = createTweetShareService({
    provider: {
      async getTweet(id, url) {
        providerCalls.push({ kind: "tweet", id, url });
        if (state.tweetError)
          throw new TweetProviderError("unavailable", { code: state.tweetError });
        return makeTweet({
          tweetId: id,
          url: POST_URL,
          authorName: "User",
          authorUsername: "user",
          authorUrl: PROFILE_URL,
          text: "Конец треда <безопасно> & текст",
          media: [makeMedia({ type: "photo", url: "https://pbs.twimg.com/main.jpg" })],
          repliedToTweet: makeTweet({
            tweetId: "122",
            url: "https://x.com/user/status/122",
            authorName: "User",
            authorUsername: "user",
            authorUrl: PROFILE_URL,
            text: "Начало треда",
          }),
        });
      },
      async health() {
        return true;
      },
      async close() {},
    },
    cacheRepository: cache,
    shareEventsRepository,
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: 600,
    threadUnrollEnabled: true,
    threadMaxTweets: 10,
    mediaFetch: async () => {
      throw new Error("No media probes expected");
    },
  });
  const profileShare = createProfileShareService({
    provider: {
      async getProfile(id, url) {
        providerCalls.push({ kind: "profile", id, url });
        if (state.profileError)
          throw new TweetProviderError("unavailable", { code: state.profileError });
        return makeProfile({ username: id, name: "User", url, bio: "Биография <безопасно>" });
      },
      async close() {},
    },
    cacheRepository: profileCache,
    shareEventsRepository,
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: 600,
  });
  const limiter = createRateLimiter({
    maxRequests: config.maxRequests ?? 100,
    windowMs: 1_000_000,
  });
  const h = createHarness({
    inject: (ctx) => {
      ctx.settings = SETTINGS;
      ctx.runtimeConfig = { whitelistEnabled: true, russianTranslationEnabled: false };
      ctx.services = {
        access: {
          async registerUser() {},
          async hasAccess() {
            return state.allowed || state.admin;
          },
          isAdmin: () => state.admin,
        },
        tweetShare,
        profileShare,
      } as unknown as AppContext["services"];
    },
    register: (bot) => {
      bot.use(accessMiddleware);
      bot.use(rateLimitMiddleware(limiter));
      bot.use(privateComposer);
      bot.use(inlineComposer);
    },
    ...options,
  });
  return { ...h, state, providerCalls, events, entries };
}

function privateText(text: string): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: { id: 100, type: "private" },
      from: USER,
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0]!.length }]
        : [],
    },
  };
}

function callback(data: string, chatType = "private"): Record<string, unknown> {
  return {
    update_id: 2,
    callback_query: {
      id: "CB",
      from: USER,
      chat_instance: "CHAT",
      data,
      message: {
        message_id: 11,
        date: 0,
        chat: { id: 100, type: chatType },
        from: { id: 42, is_bot: true, first_name: "Test Bot" },
        text: "Ошибка загрузки",
      },
    },
  };
}

function buttons(
  call: RecordedCall | undefined,
): { text: string; url?: string; callback_data?: string }[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: ReturnType<typeof buttons>[] }
    | undefined;
  return markup?.inline_keyboard?.flat() ?? [];
}

function richHtml(call: RecordedCall | undefined): string {
  return (call?.payload.rich_message as { html?: string } | undefined)?.html ?? "";
}

describe("private share retries", () => {
  it.each([
    [POST_URL, "retry:tweet:123", false],
    [`/text ${POST_URL}`, "retry:text:123", true],
  ])("recovers from a timeout for %s and preserves its mode", async (input, data, textOnly) => {
    const h = harness();
    await h.handle(privateText(input));
    const keyboard = buttons(h.lastCall("sendMessage"));
    expect(keyboard).toContainEqual({ text: "🔄 Повторить", callback_data: data });
    expect(keyboard).toContainEqual({ text: "🔗 Оригинальный пост", url: POST_URL });
    h.state.tweetError = null;
    await h.handle(callback(data));
    expect(h.lastCall("answerCallbackQuery")?.payload).toMatchObject({ callback_query_id: "CB" });
    const result = h.lastCall("sendRichMessage");
    expect(result?.payload.chat_id).toBe(100);
    const html = richHtml(result);
    expect(html).toContain("Начало треда");
    expect(html).toContain("Конец треда &lt;безопасно&gt; &amp; текст");
    expect(html).toContain("<hr/>");
    expect(html.includes("https://pbs.twimg.com/main.jpg")).toBe(!textOnly);
    expect(buttons(result)).toContainEqual({ text: "🔗 Оригинальный пост", url: POST_URL });
    expect(h.providerCalls).toEqual([
      { kind: "tweet", id: "123", url: POST_URL },
      { kind: "tweet", id: "123", url: "https://x.com/i/status/123" },
    ]);
    expect(
      h.events.map(({ status, mode, telegramUserId, chatId }) => ({
        status,
        mode,
        telegramUserId,
        chatId,
      })),
    ).toEqual([
      { status: "error", mode: "private", telegramUserId: 100, chatId: 100 },
      { status: "success", mode: "private", telegramUserId: 100, chatId: 100 },
    ]);
  });

  it("retries a profile and returns its card and original link", async () => {
    const h = harness();
    await h.handle(privateText(PROFILE_URL));
    expect(buttons(h.lastCall("sendMessage"))).toContainEqual({
      text: "🔄 Повторить",
      callback_data: "retry:profile:user",
    });
    expect(buttons(h.lastCall("sendMessage"))).toContainEqual({
      text: "👤 Открыть профиль",
      url: PROFILE_URL,
    });
    h.state.profileError = null;
    await h.handle(callback("retry:profile:user"));
    const result = h.lastCall("sendRichMessage");
    expect(richHtml(result)).toContain("Биография &lt;безопасно&gt;");
    expect(buttons(result)).toContainEqual({ text: "👤 Открыть профиль", url: PROFILE_URL });
    expect(h.providerCalls).toHaveLength(2);
    expect(h.providerCalls[1]).toEqual({ kind: "profile", id: "user", url: PROFILE_URL });
  });

  it("offers another retry if the provider is still unavailable", async () => {
    const h = harness({ tweetError: "provider_http_error" });
    await h.handle(callback("retry:tweet:123"));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("Не удалось получить пост");
    expect(buttons(h.lastCall("sendMessage"))).toContainEqual({
      text: "🔄 Повторить",
      callback_data: "retry:tweet:123",
    });
    expect(h.callsTo("sendRichMessage")).toHaveLength(0);
  });

  it.each(["not_found", "private_or_deleted", "provider_auth"])(
    "keeps original links without retry for %s",
    async (code) => {
      const h = harness({ tweetError: code, profileError: code });
      for (const url of [POST_URL, PROFILE_URL]) {
        await h.handle(privateText(url));
        const keyboard = buttons(h.lastCall("sendMessage"));
        expect(keyboard.some((button) => button.callback_data !== undefined)).toBe(false);
        expect(keyboard.some((button) => button.url === url)).toBe(true);
      }
    },
  );

  it("respects a negative cache when an old retry button is used", async () => {
    const h = harness({ tweetError: "not_found" });
    await h.handle(privateText(POST_URL));
    h.state.tweetError = null;
    await h.handle(callback("retry:tweet:123"));
    expect(h.providerCalls).toHaveLength(1);
    expect(h.callsTo("sendRichMessage")).toHaveLength(0);
    expect(buttons(h.lastCall("sendMessage")).every((button) => !button.callback_data)).toBe(true);
  });

  it("preserves cached attachments for ordinary sharing after a text retry", async () => {
    const h = harness({ tweetError: null });
    await h.handle(callback("retry:text:123"));
    expect(richHtml(h.lastCall("sendRichMessage"))).not.toContain("main.jpg");
    await h.handle(privateText(POST_URL));
    expect(richHtml(h.lastCall("sendRichMessage"))).toContain("main.jpg");
    expect(h.providerCalls).toHaveLength(1);
  });

  it("answers the callback without fetching if access has been revoked", async () => {
    const h = harness();
    await h.handle(privateText(POST_URL));
    h.state.allowed = false;
    await h.handle(callback("retry:tweet:123"));
    expect(h.lastCall("answerCallbackQuery")?.payload).toMatchObject({
      callback_query_id: "CB",
      text: expect.stringContaining("Доступ закрыт"),
      show_alert: true,
    });
    expect(h.providerCalls).toHaveLength(1);
    expect(h.callsTo("sendMessage")).toHaveLength(1);
  });

  it("uses the same budget as the original message and answers a blocked click", async () => {
    const h = harness({ maxRequests: 1 });
    await h.handle(privateText(POST_URL));
    h.state.tweetError = null;
    await h.handle(callback("retry:tweet:123"));
    expect(h.lastCall("answerCallbackQuery")?.payload).toMatchObject({
      text: expect.stringContaining("Слишком много запросов"),
      show_alert: true,
    });
    expect(h.providerCalls).toHaveLength(1);
    expect(h.callsTo("sendRichMessage")).toHaveLength(0);
    expect(h.callsTo("sendMessage")).toHaveLength(1);
  });

  it("counts a retry against subsequent ordinary shares", async () => {
    const h = harness({ maxRequests: 1, tweetError: null });
    await h.handle(callback("retry:text:123"));
    await h.handle(privateText(POST_URL));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("Слишком много запросов");
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("keeps administrators exempt from retry limits", async () => {
    const h = harness({ admin: true, maxRequests: 1 });
    await h.handle(privateText(POST_URL));
    h.state.tweetError = null;
    await h.handle(callback("retry:tweet:123"));
    expect(richHtml(h.lastCall("sendRichMessage"))).toContain("Конец треда");
  });

  it.each([
    "retry:tweet:https://evil.test",
    "retry:tweet:0",
    "retry:tweet:123/456",
    "retry:tweet:123\n",
    "retry:tweet:123456789012345678901",
    "retry:profile:home",
    "retry:profile:user@evil.test",
    "retry:other:123",
  ])("rejects malformed callback %j without spending a fetch token", async (data) => {
    const h = harness({ maxRequests: 1, tweetError: null });
    await h.handle(callback(data));
    expect(h.lastCall("answerCallbackQuery")?.payload).toMatchObject({
      text: expect.stringContaining("ссылку"),
      show_alert: true,
    });
    expect(h.providerCalls).toHaveLength(0);
    await h.handle(callback("retry:tweet:123"));
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("does not fetch from private retry data in a group or inline message", async () => {
    const h = harness();
    await h.handle(callback("retry:tweet:123", "supergroup"));
    await h.handle({
      update_id: 3,
      callback_query: {
        id: "INLINE_CB",
        from: USER,
        chat_instance: "CHAT",
        inline_message_id: "MID",
        data: "retry:tweet:123",
      },
    });
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("continues fetching when Telegram rejects an expired callback acknowledgement", async () => {
    const h = harness({ tweetError: null }, { failMethods: ["answerCallbackQuery"] });
    await h.handle(callback("retry:tweet:123"));
    expect(richHtml(h.lastCall("sendRichMessage"))).toContain("Конец треда");
  });

  it("retains the text fallback when a retried Rich Message is rejected", async () => {
    const h = harness({ tweetError: null }, { failMethods: ["sendRichMessage"] });
    await h.handle(callback("retry:text:123"));
    const reply = h.lastCall("sendMessage");
    expect(String(reply?.payload.text)).toContain("Конец треда &lt;безопасно&gt; &amp; текст");
    expect(reply?.payload.link_preview_options).toEqual({ is_disabled: true });
    expect(buttons(reply)).toContainEqual({ text: "🔗 Оригинальный пост", url: POST_URL });
  });
});
