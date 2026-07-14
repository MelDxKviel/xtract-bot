import { describe, expect, it } from "vitest";

import {
  extractFirstProfileUrl,
  extractFirstTweetUrl,
  parseProfileUrl,
  parseTweetUrl,
} from "@/utils/urls";

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

  it("parses status URLs on embed-fixer mirror hosts", () => {
    const hosts = [
      "vxtwitter.com",
      "fixvx.com",
      "fxtwitter.com",
      "fixupx.com",
      "twittpr.com",
      "xfixup.com",
      "pxtwitter.com",
      "twitterez.com",
    ];
    for (const host of hosts) {
      const parsed = parseTweetUrl(`https://${host}/user/status/1234567890`);
      expect(parsed, host).not.toBeNull();
      expect(parsed!.tweetId).toBe("1234567890");
      expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/1234567890");
    }
  });

  it("accepts arbitrary subdomains of supported hosts", () => {
    const urls = [
      "https://mobile.twitter.com/user/status/55",
      "https://www.fixupx.com/user/status/55",
      "https://g.fxtwitter.com/user/status/55",
      "https://d.fixupx.com/user/status/55",
    ];
    for (const url of urls) {
      const parsed = parseTweetUrl(url);
      expect(parsed, url).not.toBeNull();
      expect(parsed!.tweetId).toBe("55");
      expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/55");
    }
  });

  it("extracts a fixer-mirror url from surrounding text", () => {
    const parsed = extractFirstTweetUrl("look at fixupx.com/user/status/321 nice one");
    expect(parsed).not.toBeNull();
    expect(parsed!.tweetId).toBe("321");
    expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/321");
  });

  it("rejects lookalike hosts that merely embed a supported apex", () => {
    expect(parseTweetUrl("https://notfixupx.com/user/status/1")).toBeNull();
    expect(parseTweetUrl("https://fixupx.com.evil.com/user/status/1")).toBeNull();
    expect(extractFirstTweetUrl("see notfxtwitter.com/user/status/1")).toBeNull();
    expect(extractFirstTweetUrl("see fixupx.com.evil.com/user/status/1")).toBeNull();
  });
});

describe("parseProfileUrl", () => {
  it("parses bare handle URLs on supported hosts", () => {
    const samples = [
      "https://x.com/jack",
      "https://twitter.com/jack",
      "https://mobile.twitter.com/jack",
      "https://vxtwitter.com/jack",
      "x.com/jack",
      "www.twitter.com/jack",
    ];
    for (const sample of samples) {
      const parsed = parseProfileUrl(sample);
      expect(parsed, sample).not.toBeNull();
      expect(parsed!.username).toBe("jack");
      expect(parsed!.normalizedUrl).toBe("https://x.com/jack");
    }
  });

  it("accepts known profile sub-tabs", () => {
    for (const tab of ["with_replies", "media", "likes", "following", "followers"]) {
      const parsed = parseProfileUrl(`https://x.com/jack/${tab}`);
      expect(parsed, tab).not.toBeNull();
      expect(parsed!.username).toBe("jack");
    }
  });

  it("rejects status (tweet) URLs", () => {
    expect(parseProfileUrl("https://x.com/jack/status/123")).toBeNull();
    expect(parseProfileUrl("https://vxtwitter.com/jack/statuses/123")).toBeNull();
  });

  it("rejects reserved routes and deep links", () => {
    expect(parseProfileUrl("https://x.com/home")).toBeNull();
    expect(parseProfileUrl("https://x.com/search")).toBeNull();
    expect(parseProfileUrl("https://x.com/i/lists/1")).toBeNull();
    expect(parseProfileUrl("https://x.com/jack/lists/123")).toBeNull();
  });

  it("rejects handles that are too long or use bad characters", () => {
    expect(parseProfileUrl("https://x.com/this_handle_is_way_too_long")).toBeNull();
    expect(parseProfileUrl("https://x.com/bad-handle")).toBeNull();
  });

  it("rejects unsupported hosts", () => {
    expect(parseProfileUrl("https://example.com/jack")).toBeNull();
    expect(parseProfileUrl("https://x.com")).toBeNull();
  });

  it("extracts a profile URL from surrounding text", () => {
    const parsed = extractFirstProfileUrl("check out https://x.com/Jack_2 please");
    expect(parsed).not.toBeNull();
    expect(parsed!.username).toBe("Jack_2");
    expect(parsed!.normalizedUrl).toBe("https://x.com/Jack_2");
  });

  it("does not treat a tweet URL as a profile when extracting", () => {
    expect(extractFirstProfileUrl("look https://x.com/user/status/42")).toBeNull();
  });

  it("parses profile URLs on embed-fixer mirror hosts", () => {
    const hosts = [
      "vxtwitter.com",
      "fixvx.com",
      "fxtwitter.com",
      "fixupx.com",
      "twittpr.com",
      "xfixup.com",
      "pxtwitter.com",
      "twitterez.com",
    ];
    for (const host of hosts) {
      const parsed = parseProfileUrl(`https://${host}/jack`);
      expect(parsed, host).not.toBeNull();
      expect(parsed!.username).toBe("jack");
      expect(parsed!.normalizedUrl).toBe("https://x.com/jack");
    }
  });

  it("accepts arbitrary subdomains of supported hosts for profiles", () => {
    for (const url of ["https://mobile.twitter.com/jack", "https://www.fixupx.com/jack"]) {
      const parsed = parseProfileUrl(url);
      expect(parsed, url).not.toBeNull();
      expect(parsed!.username).toBe("jack");
      expect(parsed!.normalizedUrl).toBe("https://x.com/jack");
    }
  });

  it("rejects profile lookalike hosts", () => {
    expect(parseProfileUrl("https://notfixupx.com/jack")).toBeNull();
    expect(parseProfileUrl("https://fixupx.com.evil.com/jack")).toBeNull();
  });
});
