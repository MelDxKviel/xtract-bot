import { Parser } from "htmlparser2";
import { describe, expect, it } from "vitest";

import type { AppContext } from "@/bot/context";
import { registerBotCommands } from "@/bot/commands";
import { inlineComposer } from "@/bot/handlers/inline";
import { privateComposer } from "@/bot/handlers/private";
import { accessMiddleware } from "@/bot/middlewares/access";
import { rateLimitMiddleware } from "@/bot/middlewares/rateLimit";
import { loadSettings } from "@/config";
import { makeMedia, makeTweet, TweetProviderError, type TweetData } from "@/providers/base";
import type { CacheEntry, TweetCacheRepository } from "@/repositories/tweetCache";
import { createRateLimiter } from "@/services/rateLimit";
import { createTweetShareService } from "@/services/tweetShare";

import { createHarness, type HarnessOptions, type RecordedCall } from "./support/botHarness";

const URL = "https://x.com/user/status/123";
const SETTINGS = loadSettings({
  BOT_TOKEN: "12345:TEST",
  DATABASE_URL: "postgres://localhost/test",
});

function tweet(overrides: Partial<TweetData> = {}): TweetData {
  return makeTweet({
    tweetId: "123",
    url: URL,
    authorName: "User",
    authorUsername: "user",
    authorUrl: "https://x.com/user",
    text: "Основной текст <безопасно> & #тег",
    media: [makeMedia({ type: "photo", url: "https://pbs.twimg.com/main.jpg" })],
    quotedTweet: makeTweet({
      tweetId: "456",
      url: "https://x.com/other/status/456",
      authorName: "Other",
      authorUsername: "other",
      authorUrl: "https://x.com/other",
      text: "Полный текст цитаты",
      media: [makeMedia({ type: "video", url: "https://video.twimg.com/context.mp4" })],
    }),
    poll: {
      options: [
        { label: "Ответ <A>", votes: 3 },
        { label: "Ответ B", votes: 1 },
      ],
      totalVotes: 4,
      closed: false,
    },
    ...overrides,
  });
}

function harness(
  config: {
    data?: TweetData;
    errorCode?: string;
    allowed?: boolean;
    maxRequests?: number;
    seed?: TweetData;
  } = {},
  options: Partial<HarnessOptions> = {},
) {
  const providerCalls: string[] = [];
  const entries = new Map<string, CacheEntry>();
  if (config.seed) entries.set(config.seed.tweetId, { kind: "hit", tweet: config.seed });
  const cache: TweetCacheRepository = {
    async getEntry(id) {
      return entries.get(id) ?? null;
    },
    async set(data) {
      entries.set(data.tweetId, { kind: "hit", tweet: data });
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
  const service = createTweetShareService({
    provider: {
      async getTweet(id) {
        providerCalls.push(id);
        if (config.errorCode)
          throw new TweetProviderError("unavailable", { code: config.errorCode });
        return config.data ?? tweet();
      },
      async health() {
        return true;
      },
      async close() {},
    },
    cacheRepository: cache,
    shareEventsRepository: { async create() {} },
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: 600,
    threadUnrollEnabled: true,
    threadMaxTweets: 10,
    mediaFetch: async () => {
      throw new Error("Text fixtures must not need media probes");
    },
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
            return config.allowed ?? true;
          },
          isAdmin: () => false,
        },
        tweetShare: service,
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
  return { ...h, providerCalls };
}

function privateText(text: string): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: { id: 100, type: "private" },
      from: { id: 100, is_bot: false, first_name: "U" },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0]!.length }]
        : [],
    },
  };
}

function chosen(resultId = "tweet-text-123", query = URL): Record<string, unknown> {
  return {
    update_id: 2,
    chosen_inline_result: {
      result_id: resultId,
      query,
      inline_message_id: "MID",
      from: { id: 100, is_bot: false, first_name: "U" },
    },
  };
}

function richHtml(call: RecordedCall | undefined): string {
  return (call?.payload.rich_message as { html?: string } | undefined)?.html ?? "";
}

function textContent(html: string): string {
  let text = "";
  new Parser({
    ontext: (part) => {
      text += part;
    },
  }).end(html);
  return text;
}

describe("text-only sharing", () => {
  it("sends text, escaped entities, poll and quote without either post's media", async () => {
    const h = harness();
    await h.handle(privateText(`/text ${URL}`));
    const call = h.lastCall("sendRichMessage");
    const html = richHtml(call);
    expect(html).toContain("Основной текст &lt;безопасно&gt; &amp;");
    expect(html).toContain("Полный текст цитаты");
    expect(html).toContain("Ответ &lt;A&gt;");
    expect(html).toContain("75%");
    expect(html).not.toMatch(/<img|<video|tg-slideshow|twimg\.com/);
    expect(JSON.stringify(call?.payload.reply_markup)).toContain(URL);
    expect(h.callsTo("sendMediaGroup")).toHaveLength(0);
  });

  it("keeps the configured self-thread and all its text without media", async () => {
    const parent = tweet({ tweetId: "122", text: "Начало треда", poll: null, quotedTweet: null });
    const h = harness({
      data: tweet({ text: "Конец треда", repliedToTweet: parent, quotedTweet: null }),
    });
    await h.handle(privateText(`/text ${URL}`));
    const html = richHtml(h.lastCall("sendRichMessage"));
    expect(html).toContain("Начало треда");
    expect(html).toContain("Конец треда");
    expect(html.indexOf("Начало треда")).toBeLessThan(html.indexOf("Конец треда"));
    expect(html).toContain("<hr/>");
    expect(html).not.toMatch(/<img|<video|tg-slideshow/);
  });

  it("preserves cached media for an ordinary share after /text", async () => {
    const h = harness({ seed: tweet() });
    await h.handle(privateText(`/text ${URL}`));
    expect(richHtml(h.lastCall("sendRichMessage"))).not.toContain("twimg.com");
    await h.handle(privateText(URL));
    const html = richHtml(h.lastCall("sendRichMessage"));
    expect(html).toContain("https://pbs.twimg.com/main.jpg");
    expect(html).toContain("https://video.twimg.com/context.mp4");
    expect(h.providerCalls).toEqual([]);
  });

  it("falls back to complete escaped text in bounded messages when rich sending fails", async () => {
    const body = "😀<&>\n".repeat(1500) + "Последние слова";
    const quote = "Цитата ".repeat(900) + "Конец цитаты";
    const data = tweet({ text: body, quotedTweet: tweet({ text: quote, quotedTweet: null }) });
    const h = harness({ data }, { failMethods: ["sendRichMessage"] });
    await h.handle(privateText(`/text ${URL}`));
    const messages = h.callsTo("sendMessage");
    expect(messages.length).toBeGreaterThan(2);
    const joined = messages.map((call) => textContent(String(call.payload.text))).join("");
    expect(joined).toContain(body);
    expect(joined).toContain(quote);
    for (const call of messages) {
      const html = String(call.payload.text);
      const plain = textContent(html);
      expect(plain.length).toBeLessThanOrEqual(4096);
      expect(plain).not.toMatch(/\p{Surrogate}/u);
      expect(html).not.toContain("<&>");
      expect(call.payload.parse_mode).toBe("HTML");
      expect(call.payload.link_preview_options).toEqual({ is_disabled: true });
    }
    expect(JSON.stringify(messages.at(-1)?.payload.reply_markup)).toContain(URL);
    expect(h.calls.some((call) => /send(Photo|Video|Animation|MediaGroup)/.test(call.method))).toBe(
      false,
    );
  });

  it("keeps an emoji intact when it straddles the plain-message limit", async () => {
    const header = "𝕏 User (@user)\n\n";
    const body = "a".repeat(4096 - header.length - 1) + "😀Конец";
    const h = harness(
      { data: tweet({ text: body, poll: null, quotedTweet: null }) },
      { failMethods: ["sendRichMessage"] },
    );
    await h.handle(privateText(`/text ${URL}`));
    const texts = h.callsTo("sendMessage").map((call) => textContent(String(call.payload.text)));
    expect(texts).toHaveLength(2);
    expect(texts[0]!.length).toBe(4095);
    expect(texts[1]).toBe("😀Конец");
    expect(texts.join("")).toBe(header + body);
  });

  it.each(["/text", "/text https://example.com/a", "/text https://x.com/user"])(
    "explains post-link usage for %s without consuming a fetch token",
    async (input) => {
      const h = harness({ maxRequests: 1 });
      await h.handle(privateText(input));
      expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("/text");
      expect(h.providerCalls).toEqual([]);
      expect(h.callsTo("sendRichMessageDraft")).toHaveLength(0);
      await h.handle(privateText(`/text ${URL}`));
      expect(h.callsTo("sendRichMessage")).toHaveLength(1);
    },
  );

  it("reports unavailable posts instead of treating /text as unknown", async () => {
    const h = harness({ errorCode: "not_found" });
    await h.handle(privateText(`/text ${URL}`));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("Не удалось получить пост");
    expect(h.callsTo("sendRichMessage")).toHaveLength(0);
    expect(h.providerCalls).toEqual(["123"]);
  });

  it("enforces the shared fetch budget for addressed /text commands", async () => {
    const h = harness({ maxRequests: 1 });
    await h.handle(privateText(URL));
    await h.handle(privateText(`/text@test_bot ${URL}`));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("Слишком много запросов");
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("counts /text against subsequent ordinary sharing", async () => {
    const h = harness({ maxRequests: 1 });
    await h.handle(privateText(`/text@test_bot ${URL}`));
    await h.handle(privateText(URL));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("Слишком много запросов");
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("keeps /text behind the existing access check", async () => {
    const h = harness({ allowed: false });
    await h.handle(privateText(`/text ${URL}`));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("Доступ закрыт");
    expect(h.providerCalls).toEqual([]);
  });

  it("offers the inline variant without fetching the post", async () => {
    const h = harness();
    await h.handle({
      update_id: 1,
      inline_query: {
        id: "q1",
        query: URL,
        offset: "",
        from: { id: 100, is_bot: false, first_name: "U" },
      },
    });
    const results = h.lastCall("answerInlineQuery")?.payload.results as Record<string, unknown>[];
    const result = results.find((item) => item.id === "tweet-text-123");
    expect(result?.title).toContain("Только текст");
    expect(result?.input_message_content).toMatchObject({
      message_text: expect.stringContaining("Загрузка"),
      link_preview_options: { is_disabled: true },
    });
    expect(h.providerCalls).toEqual([]);
  });

  it("edits the selected inline result to full text and context without media", async () => {
    const h = harness();
    await h.handle(chosen());
    const call = h.lastCall("editMessageText");
    const html = richHtml(call);
    expect(html).toContain("Основной текст");
    expect(html).toContain("Полный текст цитаты");
    expect(html).toContain("75%");
    expect(html).not.toMatch(/<img|<video|tg-slideshow|twimg\.com/);
    expect(JSON.stringify(call?.payload.reply_markup)).toContain(URL);
    await h.handle(chosen("tweet-123"));
    expect(richHtml(h.lastCall("editMessageText"))).toContain("https://pbs.twimg.com/main.jpg");
    expect(h.providerCalls).toEqual(["123"]);
  });

  it("falls back to inline text with previews disabled instead of attaching media", async () => {
    const h = harness({}, { failCall: (call) => call.payload.rich_message !== undefined });
    await h.handle(chosen());
    const call = h.lastCall("editMessageText");
    expect(String(call?.payload.text)).toContain("Полный текст цитаты");
    expect(call?.payload.link_preview_options).toEqual({ is_disabled: true });
    expect(h.callsTo("editMessageMedia")).toHaveLength(0);
  });

  it("keeps inline text-only sharing to one post with reply context", async () => {
    const parent = tweet({ tweetId: "122", text: "Предыдущий пост", quotedTweet: null });
    const h = harness({
      data: tweet({ text: "Выбранный пост", repliedToTweet: parent, quotedTweet: null }),
    });
    await h.handle(chosen());
    const html = richHtml(h.lastCall("editMessageText"));
    expect(html).toContain("Выбранный пост");
    expect(html).toContain("Предыдущий пост");
    expect(html).toContain("Ответ на");
    expect(html).not.toContain("<hr/>");
    expect(html).not.toMatch(/<img|<video|tg-slideshow/);
  });

  it("keeps the original link when inline cannot carry the complete long text", async () => {
    const h = harness(
      { data: tweet({ text: "длинный текст ".repeat(500) }) },
      {
        failCall: (call) => call.payload.rich_message !== undefined,
      },
    );
    await h.handle(chosen());
    const call = h.lastCall("editMessageText");
    expect(String(call?.payload.text)).toContain("Не удалось отправить пост целиком");
    expect(JSON.stringify(call?.payload.reply_markup)).toContain(URL);
    expect(h.callsTo("editMessageMedia")).toHaveLength(0);
  });

  it("exposes /text through help and the command menu", async () => {
    const h = harness();
    await h.handle(privateText("/help"));
    expect(String(h.lastCall("sendMessage")?.payload.text)).toContain("/text");
    let registration: Promise<void> | undefined;
    const menu = createHarness({
      register: (bot) => {
        registration = registerBotCommands(bot, { ...SETTINGS, adminIds: new Set([100]) });
      },
    });
    await registration;
    for (const call of menu.callsTo("setMyCommands")) {
      expect(call.payload.commands).toContainEqual({
        command: "text",
        description: expect.any(String),
      });
    }
    expect(menu.callsTo("setMyCommands")).toHaveLength(2);
  });
});
