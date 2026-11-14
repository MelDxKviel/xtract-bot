import { InputFile } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "@/bot/context";
import { privateComposer } from "@/bot/handlers/private";
import { formatProfile } from "@/formatters/profile";
import { formatThread, formatTweet } from "@/formatters/telegram";
import { loadSettings } from "@/config";
import { makeMedia, makeTweet, type TweetData } from "@/providers/base";
import { makeProfile, type ProfileData } from "@/providers/profileBase";
import type { ProfileShareResult, ProfileShareService } from "@/services/profileShare";
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

function profile(overrides: Partial<ProfileData> = {}): ProfileData {
  return makeProfile({
    username: "user",
    name: "User",
    url: "https://x.com/user",
    bio: "profile bio",
    ...overrides,
  });
}

function profileSuccess(overrides: Partial<ProfileShareResult> = {}): ProfileShareResult {
  const data = overrides.profile ?? profile();
  return {
    status: "success",
    ok: true,
    username: data.username,
    sourceUrl: data.url,
    normalizedUrl: data.url,
    profile: data,
    post: formatProfile(data),
    errorCode: null,
    elapsedMs: 1,
    cacheHit: false,
    ...overrides,
  };
}

interface InjectConfig {
  result?: ShareResult;
  profileResult?: ProfileShareResult;
  isAdmin?: boolean;
  widgets?: boolean;
  onProcess?: (text: string) => void;
}

function inject(config: InjectConfig = {}): (ctx: AppContext) => void {
  const runtimeConfig: AppContext["runtimeConfig"] = {
    whitelistEnabled: true,
    russianTranslationEnabled: false,
  };
  const tweetShare: Pick<TweetShareService, "processText" | "processUrl"> = {
    async processText(text: string, _options: ProcessOptions): Promise<ShareResult> {
      config.onProcess?.(text);
      return config.result ?? successResult();
    },
    async processUrl(): Promise<ShareResult> {
      return config.result ?? successResult();
    },
  };
  const profileShare: Pick<ProfileShareService, "processText" | "processUrl"> = {
    async processText(): Promise<ProfileShareResult> {
      return config.profileResult ?? profileSuccess();
    },
    async processUrl(): Promise<ProfileShareResult> {
      return config.profileResult ?? profileSuccess();
    },
  };
  return (ctx) => {
    ctx.settings = loadSettings({
      BOT_TOKEN: "12345:TEST",
      DATABASE_URL: "postgres://localhost/test",
      POST_WIDGETS_ENABLED: String(config.widgets ?? false),
    });
    ctx.services = {
      access: { isAdmin: () => config.isAdmin ?? false },
      stats: {},
      tweetShare,
      profileShare,
    } as unknown as AppContext["services"];
    ctx.runtimeConfig = runtimeConfig;
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
const PROFILE_URL = "https://x.com/user";

describe("private HTML widget delivery", () => {
  it("explains Telegram's widget block and backs off instead of silently repeating the failure", async () => {
    const h = harness(
      { widgets: true },
      {
        failMethods: ["sendWidget"],
        failDescriptions: { sendWidget: "Bad Request: INPUT_MEDIA_WIDGET_NOT_ALLOWED" },
      },
    );
    await h.handle(privateText(TWEET_URL));
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendWidget")).toHaveLength(1);
    expect(h.callsTo("sendRichMessage")).toHaveLength(2);
    expect(h.callsTo("sendMessage").map((call) => call.payload.text)).toEqual([
      expect.stringContaining("не разрешает HTML-карточки"),
      expect.stringContaining("не разрешает HTML-карточки"),
    ]);
  });
  it("reports a missing photo in a partially delivered album", async () => {
    const data = tweet({
      media: [
        makeMedia({ type: "photo", url: "https://cdn.test/ok.jpg" }),
        makeMedia({ type: "photo", url: "https://cdn.test/fail.jpg" }),
      ],
    });
    const h = harness(
      { widgets: true, result: successResult({ tweet: data }) },
      {
        failCall: (call) =>
          call.method === "sendMediaGroup" ||
          (call.method === "sendPhoto" && call.payload.photo === "https://cdn.test/fail.jpg"),
      },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendPhoto")).toHaveLength(2);
    expect(h.lastCall("sendMessage")!.payload.text).toContain("Не удалось отправить фото");
  });
  it("sends a widget instead of duplicating the post as a rich message", async () => {
    const h = harness({ widgets: true });
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendWidget")).toHaveLength(1);
    expect(h.callsTo("sendRichMessage")).toHaveLength(0);
    const payload = h.lastCall("sendWidget")!.payload;
    expect(payload.html).toContain("hello world");
    expect(JSON.stringify(payload.reply_markup)).toContain("retry:classic:123");
  });

  it.each(["photo", "video", "gif"] as const)("keeps %s as a native file", async (type) => {
    const data = tweet({ media: [makeMedia({ type, url: `https://cdn.test/${type}` })] });
    const h = harness({ widgets: true, result: successResult({ tweet: data }) });
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendWidget")).toHaveLength(1);
    expect(
      h.callsTo(type === "photo" ? "sendPhoto" : type === "gif" ? "sendAnimation" : "sendVideo"),
    ).toHaveLength(1);
  });

  it("preserves thread, quote and mixed-album media in order beyond ten files", async () => {
    const media = Array.from({ length: 12 }, (_, i) =>
      makeMedia({
        type: i === 1 ? "gif" : i === 2 ? "video" : "photo",
        url: `https://cdn.test/${i}`,
      }),
    );
    const data = tweet({
      media,
      quotedTweet: tweet({
        tweetId: "456",
        text: "quote",
        media: [makeMedia({ type: "video", url: "https://cdn.test/quote.mp4" })],
      }),
    });
    const post = formatThread([tweet(), data]);
    const h = harness({
      widgets: true,
      result: successResult({ tweet: data, post, threadSize: 2 }),
    });
    await h.handle(privateText(TWEET_URL));
    const albums = h
      .callsTo("sendMediaGroup")
      .map((call) => call.payload.media as Array<{ type: string; media: string }>);
    expect(albums.map((album) => album.length)).toEqual([10, 2]);
    expect(albums.flat().map((item) => item.media)).toEqual(media.map((item) => item.url));
    expect(albums[0]![1]!.type).toBe("video");
    expect(h.lastCall("sendVideo")!.payload.video).toBe("https://cdn.test/quote.mp4");
  });

  it("falls back to the full rich post when widgets are rejected", async () => {
    const h = harness({ widgets: true }, { failMethods: ["sendWidget"] });
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendWidget")).toHaveLength(1);
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("uses the full original post when widget text exceeds its byte limit", async () => {
    const data = tweet({ text: "длинный текст ".repeat(3000) + "FINAL WORD" });
    const h = harness({ widgets: true, result: successResult({ tweet: data }) });
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendWidget")).toHaveLength(0);
    expect(JSON.stringify(h.lastCall("sendRichMessage")!.payload)).toContain("FINAL WORD");
  });

  it("can request a forwardable ordinary post without another widget", async () => {
    const h = harness({ widgets: true });
    await h.handle({
      update_id: 2,
      callback_query: {
        id: "cb",
        from: { id: 100, is_bot: false, first_name: "U" },
        chat_instance: "chat",
        data: "retry:classic:123",
        message: { message_id: 1, date: 0, chat: { id: 100, type: "private" } },
      },
    });
    expect(h.callsTo("answerCallbackQuery")).toHaveLength(1);
    expect(h.callsTo("sendWidget")).toHaveLength(0);
    expect(h.callsTo("sendRichMessage")).toHaveLength(1);
  });

  it("keeps /text and its ordinary-post callback free of all media", async () => {
    const data = tweet({ media: [makeMedia({ type: "photo", url: "https://cdn.test/a.jpg" })] });
    const h = harness({ widgets: true, result: successResult({ tweet: data }) });
    await h.handle(privateText(`/text ${TWEET_URL}`, true));
    expect(JSON.stringify(h.lastCall("sendWidget")!.payload.reply_markup)).toContain(
      "retry:classictext:123",
    );
    expect(h.callsTo("sendPhoto")).toHaveLength(0);
    expect(h.callsTo("sendMediaGroup")).toHaveLength(0);
  });

  it("retries rejected video URLs by uploading the actual file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }),
      ),
    );
    const data = tweet({
      media: [makeMedia({ type: "video", url: "https://video.twimg.com/a.mp4" })],
    });
    const h = harness(
      { widgets: true, result: successResult({ tweet: data }) },
      { failCall: (call) => call.method === "sendVideo" && typeof call.payload.video === "string" },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendVideo")).toHaveLength(2);
    expect(h.lastCall("sendVideo")!.payload.video).toBeInstanceOf(InputFile);
    expect(h.callsTo("sendPhoto")).toHaveLength(0);
  });
});

afterEach(() => vi.unstubAllGlobals());

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

  it.each(["quotedTweet", "repliedToTweet"] as const)(
    "sends %s media with the context in a single rich message",
    async (relation) => {
      const data = tweet({
        media: [makeMedia({ type: "photo", url: "https://pbs.twimg.com/main.jpg" })],
        [relation]: tweet({
          tweetId: "456",
          text: "context text",
          media: [makeMedia({ type: "video", url: "https://video.twimg.com/context.mp4" })],
        }),
      });
      const h = harness({ result: successResult({ tweet: data }) });
      await h.handle(privateText(TWEET_URL));
      const call = h.lastCall("sendRichMessage")!;
      const html = (call.payload.rich_message as { html: string }).html;
      expect(html).toContain("hello world");
      expect(html).toContain("https://pbs.twimg.com/main.jpg");
      expect(html).toContain("context text");
      expect(html).toContain("https://video.twimg.com/context.mp4");
      expect(h.callsTo("sendRichMessage")).toHaveLength(1);
      expect(h.callsTo("sendMediaGroup")).toHaveLength(0);
    },
  );

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

  it.each(["video", "gif"] as const)("uploads %s when Telegram rejects its URL", async (type) => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "video/mp4" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const data = tweet({
      media: [
        makeMedia({
          type,
          url: "https://video.twimg.com/video.mp4",
          previewUrl: "https://pbs.twimg.com/preview.jpg",
        }),
      ],
    });
    const method = type === "video" ? "sendVideo" : "sendAnimation";
    const h = harness(
      { result: successResult({ tweet: data }) },
      {
        failMethods: ["sendRichMessage"],
        failCall: (call) =>
          call.method === method &&
          typeof call.payload[type === "video" ? "video" : "animation"] === "string",
      },
    );
    await h.handle(privateText(TWEET_URL));
    const calls = h.callsTo(method);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.payload[type === "video" ? "video" : "animation"]).toBeInstanceOf(InputFile);
    expect(calls[1]!.payload.caption).toContain("hello world");
    expect(calls[1]!.payload.reply_markup).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.callsTo("sendPhoto")).toHaveLength(0);
    expect(h.callsTo("sendMessage")).toHaveLength(0);
  });

  it("tries album videos individually instead of sending an album of posters", async () => {
    const data = tweet({
      media: ["a", "b"].map((name) =>
        makeMedia({
          type: "video",
          url: `https://video.twimg.com/${name}.mp4`,
          previewUrl: `https://pbs.twimg.com/${name}.jpg`,
        }),
      ),
    });
    const h = harness(
      { result: successResult({ tweet: data }) },
      {
        failMethods: ["sendRichMessage", "sendMediaGroup"],
      },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendMediaGroup")).toHaveLength(1);
    expect(h.callsTo("sendVideo")).toHaveLength(2);
    expect(h.callsTo("sendPhoto")).toHaveLength(0);
  });

  it("reports a missing video even when the photo in a mixed album succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    const data = tweet({
      media: [
        makeMedia({ type: "photo", url: "https://pbs.twimg.com/photo.jpg" }),
        makeMedia({
          type: "video",
          url: "https://video.twimg.com/video.mp4",
          previewUrl: "https://pbs.twimg.com/preview.jpg",
        }),
      ],
    });
    const h = harness(
      { result: successResult({ tweet: data }) },
      {
        failMethods: ["sendRichMessage", "sendMediaGroup", "sendVideo"],
      },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendMediaGroup")).toHaveLength(1);
    expect(h.callsTo("sendPhoto")).toHaveLength(1);
    expect(h.lastCall("sendPhoto")!.payload.photo).toBe("https://pbs.twimg.com/photo.jpg");
    expect(h.lastCall("sendMessage")!.payload.text).toContain("Не удалось отправить видео");
    expect(h.lastCall("sendMessage")!.payload.reply_markup).toBeDefined();
  });

  it("reports upload failure without sending the video's poster", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "video/mp4" },
          }),
      ),
    );
    const data = tweet({
      media: [
        makeMedia({
          type: "video",
          url: "https://video.twimg.com/video.mp4",
          previewUrl: "https://pbs.twimg.com/preview.jpg",
        }),
      ],
    });
    const h = harness(
      { result: successResult({ tweet: data }) },
      {
        failMethods: ["sendRichMessage", "sendVideo"],
      },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendVideo")).toHaveLength(2);
    expect(h.callsTo("sendPhoto")).toHaveLength(0);
    expect(h.lastCall("sendMessage")!.payload.text).toContain("Не удалось отправить видео");
  });

  it("still retries thumbnails for albums containing only photos", async () => {
    const data = tweet({
      media: ["a", "b"].map((name) =>
        makeMedia({
          type: "photo",
          url: `https://pbs.twimg.com/${name}.jpg`,
          previewUrl: `https://pbs.twimg.com/${name}-small.jpg`,
        }),
      ),
    });
    const h = harness(
      { result: successResult({ tweet: data }) },
      {
        failMethods: ["sendRichMessage"],
        failCall: (call) =>
          call.method === "sendMediaGroup" && JSON.stringify(call.payload).includes("a.jpg"),
      },
    );
    await h.handle(privateText(TWEET_URL));
    expect(h.callsTo("sendMediaGroup")).toHaveLength(2);
    expect(h.callsTo("sendPhoto")).toHaveLength(0);
  });

  it("shares a profile for a bare handle URL", async () => {
    const h = harness({ profileResult: profileSuccess() });
    await h.handle(privateText(PROFILE_URL));
    expect(h.callsTo("sendRichMessageDraft").length).toBe(1);
    expect(h.callsTo("sendRichMessage").length).toBe(1);
  });

  it("reports a profile fetch error", async () => {
    const h = harness({
      profileResult: {
        status: "error",
        ok: false,
        username: "user",
        sourceUrl: PROFILE_URL,
        normalizedUrl: PROFILE_URL,
        profile: null,
        post: null,
        errorCode: "not_found",
        elapsedMs: 1,
        cacheHit: false,
      },
    });
    await h.handle(privateText(PROFILE_URL));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain(
      "Не удалось получить профиль",
    );
  });
});
