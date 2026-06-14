import { describe, expect, it } from "vitest";

import { extractFirstTweetUrl, parseTweetUrl } from "@/utils/urls";

describe("parseTweetUrl", () => {
  it("parses supported status URLs", () => {
    const samples = [
      "https://x.com/user/status/1234567890",
      "https://twitter.com/user/status/1234567890?s=20",
      "https://mobile.twitter.com/user/status/1234567890",
      "https://vxtwitter.com/user/statuses/1234567890",
    ];
    for (const sample of samples) {
      const parsed = parseTweetUrl(sample);
      expect(parsed).not.toBeNull();
      expect(parsed!.tweetId).toBe("1234567890");
      expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/1234567890");
    }
  });

  it("parses status URLs without an https prefix", () => {
    const samples = [
      "x.com/user/status/1234567890",
      "www.twitter.com/user/status/1234567890?s=20",
      "mobile.twitter.com/user/status/1234567890",
      "vxtwitter.com/user/statuses/1234567890",
    ];
    for (const sample of samples) {
      const parsed = parseTweetUrl(sample);
      expect(parsed).not.toBeNull();
      expect(parsed!.tweetId).toBe("1234567890");
      expect(parsed!.sourceUrl).toBe(sample);
      expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/1234567890");
    }
  });

  it("extracts first valid url from text", () => {
    const parsed = extractFirstTweetUrl(
      "ignore https://example.com/a then https://x.com/user/status/42?s=20",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.tweetId).toBe("42");
    expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/42");
  });

  it("extracts a protocol-less url from text", () => {
    const parsed = extractFirstTweetUrl("check this out x.com/user/status/99 it's great");
    expect(parsed).not.toBeNull();
    expect(parsed!.tweetId).toBe("99");
    expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/99");
  });

  it("does not match supported hosts embedded inside a larger word", () => {
    expect(extractFirstTweetUrl("visit notx.com/user/status/123")).toBeNull();
  });

  it("rejects supported hosts behind an unsupported scheme", () => {
    expect(parseTweetUrl("ftp://x.com/user/status/123")).toBeNull();
    expect(extractFirstTweetUrl("link ftp://x.com/user/status/123 here")).toBeNull();
  });

  it("still extracts a supported host nested in another url path", () => {
    const parsed = extractFirstTweetUrl("https://example.com/https://x.com/user/status/7");
    expect(parsed).not.toBeNull();
    expect(parsed!.tweetId).toBe("7");
  });

  it("returns null for invalid urls", () => {
    expect(parseTweetUrl("https://example.com/user/status/123")).toBeNull();
    expect(parseTweetUrl("https://x.com/user/not-status/123")).toBeNull();
  });

  it("does not throw on malformed percent-escapes", () => {
    expect(parseTweetUrl("https://x.com/user/status/%E0%A4%A")).toBeNull();
    expect(() =>
      extractFirstTweetUrl("look at https://x.com/user/status/%E0%A4%A please"),
    ).not.toThrow();
    const parsed = extractFirstTweetUrl(
      "broken https://x.com/%E0%A4%A then https://x.com/user/status/42",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.tweetId).toBe("42");
  });
});
