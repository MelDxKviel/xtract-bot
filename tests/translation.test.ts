import { describe, expect, it } from "vitest";

import { makeTweet, type TweetData } from "@/providers/base";
import type { FetchLike } from "@/providers/http";
import {
  createTranslator,
  languageNameInRussian,
  translateTweet,
  TranslationError,
} from "@/services/translation";

type Handler = (input: string, init?: RequestInit) => Response | Promise<Response>;

function fetchFromHandler(handler: Handler): FetchLike {
  return async (input, init) => {
    const result = await handler(input, init);
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  };
}

function googleResponse(sentences: string[][], sourceLang: string): unknown {
  return [
    sentences.map(([translated, original]) => [translated, original, null, null, 0]),
    null,
    sourceLang,
  ];
}

describe("createTranslator", () => {
  it("returns translated text and detected source language", async () => {
    let receivedUrl: string | null = null;
    const handler: Handler = (input) => {
      receivedUrl = input;
      return new Response(JSON.stringify(googleResponse([["Привет, мир", "Hello, world"]], "en")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });
    const result = await translator.translate("Hello, world");
    expect(result.text).toBe("Привет, мир");
    expect(result.sourceLang).toBe("en");
    expect(receivedUrl).toContain("tl=ru");
    expect(receivedUrl).toContain("sl=auto");
  });

  it("joins multi-sentence translations", async () => {
    const handler: Handler = () =>
      new Response(
        JSON.stringify(
          googleResponse(
            [
              ["Первое предложение. ", "First sentence. "],
              ["Второе предложение.", "Second sentence."],
            ],
            "en",
          ),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });
    const result = await translator.translate("First sentence. Second sentence.");
    expect(result.text).toBe("Первое предложение. Второе предложение.");
  });

  it("throws TranslationError on HTTP errors", async () => {
    const handler: Handler = () => new Response("", { status: 503 });
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });
    await expect(translator.translate("hi")).rejects.toBeInstanceOf(TranslationError);
  });

  it("throws TranslationError on rate limit", async () => {
    const handler: Handler = () => new Response("", { status: 429 });
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });
    await expect(translator.translate("hi")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("returns empty result for blank input without calling fetch", async () => {
    let called = false;
    const handler: Handler = () => {
      called = true;
      return new Response("[]", { status: 200 });
    };
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });
    const result = await translator.translate("   ");
    expect(result.text).toBe("");
    expect(called).toBe(false);
  });
});

describe("translateTweet", () => {
  function tweet(overrides: Partial<TweetData> = {}): TweetData {
    return makeTweet({
      tweetId: "1",
      url: "https://x.com/u/status/1",
      authorName: "User",
      authorUsername: "u",
      authorUrl: "https://x.com/u",
      text: "Hello",
      lang: "en",
      ...overrides,
    });
  }

  it("translates main text and quoted/replied tweets", async () => {
    const replies = new Map<string, string>([
      ["Hello", "Привет"],
      ["Quoted text", "Цитата текст"],
      ["Replied text", "Ответ текст"],
    ]);
    const handler: Handler = (input) => {
      const url = new URL(input);
      const original = url.searchParams.get("q") ?? "";
      const translated = replies.get(original) ?? "?";
      return new Response(JSON.stringify(googleResponse([[translated, original]], "en")), {
        status: 200,
      });
    };
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });

    const source = tweet({
      quotedTweet: tweet({ tweetId: "2", text: "Quoted text" }),
      repliedToTweet: tweet({ tweetId: "3", text: "Replied text" }),
    });
    const result = await translateTweet(source, translator);

    expect(result.tweet.text).toBe("Привет");
    expect(result.tweet.quotedTweet?.text).toBe("Цитата текст");
    expect(result.tweet.repliedToTweet?.text).toBe("Ответ текст");
    expect(result.sourceLang).toBe("en");
  });

  it("falls back to tweet.lang when source detection is missing", async () => {
    const handler: Handler = () =>
      new Response(JSON.stringify([[["перевод", "translation"]], null, null]), { status: 200 });
    const translator = createTranslator({ fetch: fetchFromHandler(handler) });
    const result = await translateTweet(tweet({ lang: "ja" }), translator);
    expect(result.sourceLang).toBe("ja");
  });
});

describe("languageNameInRussian", () => {
  it("maps known codes to Russian names", () => {
    expect(languageNameInRussian("en")).toBe("английский");
    expect(languageNameInRussian("ja")).toBe("японский");
    expect(languageNameInRussian("zh-CN")).toBe("китайский");
  });

  it("falls back to the code for unknown languages", () => {
    expect(languageNameInRussian("xx")).toBe("xx");
  });

  it("handles null", () => {
    expect(languageNameInRussian(null)).toBe("не определён");
  });
});
