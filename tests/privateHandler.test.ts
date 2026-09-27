import { InputFile } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "@/bot/context";
import { privateComposer } from "@/bot/handlers/private";
import { formatProfile } from "@/formatters/profile";
import { formatTweet } from "@/formatters/telegram";
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
  const profileShare: Pick<ProfileShareService, "processText" | "processUrl"> = {
    async processText(): Promise<ProfileShareResult> {
      return config.profileResult ?? profileSuccess();
    },
    async processUrl(): Promise<ProfileShareResult> {
      return config.profileResult ?? profileSuccess();
    },
  };
  return (ctx) => {
    ctx.services = {
      access: { isAdmin: () => config.isAdmin ?? false },
      stats: {},
      tweetShare,
      profileShare,
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
const PROFILE_URL = "https://x.com/user";

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
