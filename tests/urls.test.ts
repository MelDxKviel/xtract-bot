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

  it("extracts first valid url from text", () => {
    const parsed = extractFirstTweetUrl(
      "ignore https://example.com/a then https://x.com/user/status/42?s=20",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.tweetId).toBe("42");
    expect(parsed!.normalizedUrl).toBe("https://x.com/user/status/42");
  });

  it("returns null for invalid urls", () => {
    expect(parseTweetUrl("https://example.com/user/status/123")).toBeNull();
    expect(parseTweetUrl("https://x.com/user/not-status/123")).toBeNull();
  });
});
