import { describe, expect, it } from "vitest";

import { loadSettings } from "@/config";

const BASE: Record<string, string> = {
  BOT_TOKEN: "token",
  DATABASE_URL: "postgres://localhost/x",
};

describe("loadSettings new options", () => {
  it("applies defaults", () => {
    const settings = loadSettings({ ...BASE });
    expect(settings.negativeCacheTtlSeconds).toBe(600);
    expect(settings.cacheCleanupEnabled).toBe(true);
    expect(settings.cacheCleanupIntervalSeconds).toBe(3600);
    expect(settings.threadUnrollEnabled).toBe(true);
    expect(settings.threadMaxTweets).toBe(10);
    expect(settings.rateLimitEnabled).toBe(true);
    expect(settings.rateLimitMaxRequests).toBe(20);
    expect(settings.rateLimitWindowSeconds).toBe(60);
    expect(settings.webhookPort).toBe(8080);
  });

  it("parses overrides", () => {
    const settings = loadSettings({
      ...BASE,
      NEGATIVE_CACHE_TTL_SECONDS: "30",
      CACHE_CLEANUP_ENABLED: "off",
      CACHE_CLEANUP_INTERVAL_SECONDS: "120",
      THREAD_UNROLL_ENABLED: "false",
      THREAD_MAX_TWEETS: "5",
      RATE_LIMIT_ENABLED: "off",
      RATE_LIMIT_MAX_REQUESTS: "3",
      RATE_LIMIT_WINDOW_SECONDS: "15",
      WEBHOOK_PORT: "9000",
    });
    expect(settings.negativeCacheTtlSeconds).toBe(30);
    expect(settings.cacheCleanupEnabled).toBe(false);
    expect(settings.cacheCleanupIntervalSeconds).toBe(120);
    expect(settings.threadUnrollEnabled).toBe(false);
    expect(settings.threadMaxTweets).toBe(5);
    expect(settings.rateLimitEnabled).toBe(false);
    expect(settings.rateLimitMaxRequests).toBe(3);
    expect(settings.rateLimitWindowSeconds).toBe(15);
    expect(settings.webhookPort).toBe(9000);
  });

  it("falls back to PORT for the webhook port", () => {
    expect(loadSettings({ ...BASE, PORT: "1234" }).webhookPort).toBe(1234);
    // WEBHOOK_PORT wins over PORT when both are set.
    expect(loadSettings({ ...BASE, PORT: "1234", WEBHOOK_PORT: "5678" }).webhookPort).toBe(5678);
  });

  it("clamps thread and rate-limit counts to at least 1", () => {
    const settings = loadSettings({
      ...BASE,
      THREAD_MAX_TWEETS: "0",
      RATE_LIMIT_MAX_REQUESTS: "0",
      RATE_LIMIT_WINDOW_SECONDS: "0",
    });
    expect(settings.threadMaxTweets).toBe(1);
    expect(settings.rateLimitMaxRequests).toBe(1);
    expect(settings.rateLimitWindowSeconds).toBe(1);
  });

  it("clamps the cache cleanup interval to a 60s floor", () => {
    expect(
      loadSettings({ ...BASE, CACHE_CLEANUP_INTERVAL_SECONDS: "5" }).cacheCleanupIntervalSeconds,
    ).toBe(60);
  });
});
