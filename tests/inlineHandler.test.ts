import { describe, expect, it } from "vitest";

import type { AppContext } from "@/bot/context";
import { inlineComposer } from "@/bot/handlers/inline";
import { formatProfile } from "@/formatters/profile";
import { formatTweet } from "@/formatters/telegram";
import { makeTweet, type TweetData } from "@/providers/base";
import { makeProfile, type ProfileData } from "@/providers/profileBase";
import type { ProfileShareResult } from "@/services/profileShare";
import type { ShareResult } from "@/services/tweetShare";
import type { Translator } from "@/services/translation";

import { createHarness, type RecordedCall } from "./support/botHarness";

const TWEET_URL = "https://x.com/user/status/123";

function tweet(overrides: Partial<TweetData> = {}): TweetData {
  return makeTweet({
    tweetId: "123",
    url: TWEET_URL,
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

function failureResult(): ShareResult {
  return {
    status: "error",
    ok: false,
    tweetId: "123",
    sourceUrl: TWEET_URL,
    normalizedUrl: TWEET_URL,
    tweet: null,
    post: null,
    errorCode: "not_found",
    elapsedMs: 1,
    cacheHit: false,
    threadSize: 0,
  };
}

function profileData(overrides: Partial<ProfileData> = {}): ProfileData {
  return makeProfile({
    username: "user",
    name: "User",
    url: "https://x.com/user",
    bio: "profile bio",
    ...overrides,
  });
}

function profileSuccess(overrides: Partial<ProfileShareResult> = {}): ProfileShareResult {
  const data = overrides.profile ?? profileData();
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
  translationEnabled?: boolean;
  threadUnrollEnabled?: boolean;
  translator?: Translator;
  onProcess?: (options: { unrollThread?: boolean }) => void;
}

function inject(config: InjectConfig = {}): (ctx: AppContext) => void {
  const tweetShare = {
    async processUrl(_parsed: unknown, options: { unrollThread?: boolean }): Promise<ShareResult> {
      config.onProcess?.(options);
      return config.result ?? successResult();
    },
    async processText(): Promise<ShareResult> {
      return config.result ?? successResult();
    },
  };
  const profileShare = {
    async processUrl(): Promise<ProfileShareResult> {
      return config.profileResult ?? profileSuccess();
    },
    async processText(): Promise<ProfileShareResult> {
      return config.profileResult ?? profileSuccess();
    },
  };
  const translator: Translator = config.translator ?? {
    async translate() {
      return { text: "переведено", sourceLang: "en" };
    },
  };
  return (ctx) => {
    ctx.settings = {
      threadUnrollEnabled: config.threadUnrollEnabled ?? true,
    } as unknown as AppContext["settings"];
    ctx.services = {
      access: { isAdmin: () => false },
      stats: {},
      tweetShare,
      profileShare,
    } as unknown as AppContext["services"];
    ctx.runtimeConfig = {
      whitelistEnabled: true,
      russianTranslationEnabled: config.translationEnabled ?? false,
    };
    ctx.translator = translator;
  };
}

function harness(config: InjectConfig = {}): ReturnType<typeof createHarness> {
  return createHarness({
    register: (bot) => bot.use(inlineComposer),
    inject: inject(config),
  });
}

function inlineQuery(query: string): Record<string, unknown> {
  return {
    update_id: 1,
    inline_query: {
      id: "q1",
      from: { id: 100, is_bot: false, first_name: "U" },
      query,
      offset: "",
    },
  };
}

function chosenResult(
  query: string,
  resultId = "tweet-123",
  inlineMessageId: string | null = "MID",
): Record<string, unknown> {
  const chosen: Record<string, unknown> = {
    result_id: resultId,
    from: { id: 100, is_bot: false, first_name: "U" },
    query,
  };
  if (inlineMessageId !== null) chosen.inline_message_id = inlineMessageId;
  return { update_id: 1, chosen_inline_result: chosen };
}

function results(call: RecordedCall | undefined): Array<Record<string, unknown>> {
  return (call?.payload.results ?? []) as Array<Record<string, unknown>>;
}

describe("inline query", () => {
  it("returns a hint when there is no tweet URL", async () => {
    const h = harness();
    await h.handle(inlineQuery("hello"));
    const list = results(h.lastCall("answerInlineQuery"));
    expect(list[0]!.id).toBe("invalid-link");
  });

  it("offers a single-post and a whole-thread result by default", async () => {
    const h = harness();
    await h.handle(inlineQuery(TWEET_URL));
    const list = results(h.lastCall("answerInlineQuery"));
    const ids = list.map((item) => String(item.id));
    expect(ids).toEqual(["tweet-123", "tweet-thread-123"]);
  });

  it("omits the thread result when unrolling is disabled", async () => {
    const h = harness({ threadUnrollEnabled: false });
    await h.handle(inlineQuery(TWEET_URL));
    const ids = results(h.lastCall("answerInlineQuery")).map((item) => String(item.id));
    expect(ids).toEqual(["tweet-123"]);
  });

  it("offers a translation result when enabled", async () => {
    const h = harness({ translationEnabled: true });
    await h.handle(inlineQuery(TWEET_URL));
    const ids = results(h.lastCall("answerInlineQuery")).map((item) => String(item.id));
    expect(ids).toContain("tweet-ru-123");
  });

  it("offers a profile result for a bare handle URL", async () => {
    const h = harness();
    await h.handle(inlineQuery("https://x.com/user"));
    const ids = results(h.lastCall("answerInlineQuery")).map((item) => String(item.id));
    expect(ids).toEqual(["profile-user"]);
  });
});

describe("chosen inline result", () => {
  it("edits the placeholder into a rich message on success", async () => {
    const h = harness({ result: successResult() });
    await h.handle(chosenResult(TWEET_URL));
    expect(h.callsTo("editMessageText").length).toBe(1);
  });

  it("does nothing without an inline_message_id", async () => {
    const h = harness({ result: successResult() });
    await h.handle(chosenResult(TWEET_URL, "tweet-123", null));
    expect(h.calls.length).toBe(0);
  });

  it("does not unroll for the single-post result", async () => {
    let seen: { unrollThread?: boolean } | undefined;
    const h = harness({ result: successResult(), onProcess: (options) => (seen = options) });
    await h.handle(chosenResult(TWEET_URL, "tweet-123"));
    expect(seen!.unrollThread).toBe(false);
  });

  it("unrolls for the whole-thread result", async () => {
    let seen: { unrollThread?: boolean } | undefined;
    const h = harness({ result: successResult(), onProcess: (options) => (seen = options) });
    await h.handle(chosenResult(TWEET_URL, "tweet-thread-123"));
    expect(seen!.unrollThread).toBe(true);
    expect(h.callsTo("editMessageText").length).toBe(1);
  });

  it("reports a fetch error", async () => {
    const h = harness({ result: failureResult() });
    await h.handle(chosenResult(TWEET_URL));
    const edit = h.lastCall("editMessageText");
    expect(String(edit!.payload.text)).toContain("Не удалось получить пост");
  });

  it("reports an unrecognised link", async () => {
    const h = harness();
    await h.handle(chosenResult("not a link"));
    const edit = h.lastCall("editMessageText");
    expect(String(edit!.payload.text)).toContain("Не удалось распознать");
  });

  it("edits the placeholder into a profile rich message", async () => {
    const h = harness({ profileResult: profileSuccess() });
    await h.handle(chosenResult("https://x.com/user", "profile-user"));
    expect(h.callsTo("editMessageText").length).toBe(1);
  });

  it("reports a profile fetch error", async () => {
    const h = harness({
      profileResult: {
        status: "error",
        ok: false,
        username: "user",
        sourceUrl: "https://x.com/user",
        normalizedUrl: "https://x.com/user",
        profile: null,
        post: null,
        errorCode: "not_found",
        elapsedMs: 1,
        cacheHit: false,
      },
    });
    await h.handle(chosenResult("https://x.com/user", "profile-user"));
    const edit = h.lastCall("editMessageText");
    expect(String(edit!.payload.text)).toContain("Не удалось получить профиль");
  });

  it("translates when the translation result is chosen", async () => {
    let translateCalls = 0;
    const translator: Translator = {
      async translate() {
        translateCalls += 1;
        return { text: "переведено", sourceLang: "en" };
      },
    };
    const h = harness({ result: successResult(), translationEnabled: true, translator });
    await h.handle(chosenResult(TWEET_URL, "tweet-ru-123"));
    expect(translateCalls).toBeGreaterThan(0);
    expect(h.callsTo("editMessageText").length).toBe(1);
  });
});
