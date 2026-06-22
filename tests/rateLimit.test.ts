import { describe, expect, it } from "vitest";

import { createRateLimiter } from "@/services/rateLimit";

describe("createRateLimiter", () => {
  it("allows up to the capacity, then blocks", () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    const now = 1000;
    expect(limiter.check(1, now).allowed).toBe(true);
    expect(limiter.check(1, now).allowed).toBe(true);
    expect(limiter.check(1, now).allowed).toBe(true);

    const blocked = limiter.check(1, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1000 });
    expect(limiter.check(1, 0).allowed).toBe(true);
    expect(limiter.check(2, 0).allowed).toBe(true);
    expect(limiter.check(1, 0).allowed).toBe(false);
  });

  it("refills tokens as time passes", () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1000 });
    expect(limiter.check(1, 0).allowed).toBe(true);
    expect(limiter.check(1, 0).allowed).toBe(true);
    expect(limiter.check(1, 0).allowed).toBe(false);

    // Half a window later one token (2 per 1000ms × 500ms) has refilled.
    expect(limiter.check(1, 500).allowed).toBe(true);
    expect(limiter.check(1, 500).allowed).toBe(false);
  });

  it("never refills beyond the capacity", () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1000 });
    limiter.check(1, 0);
    limiter.check(1, 0);

    // A long idle period must not grant more than `maxRequests` tokens.
    expect(limiter.check(1, 10_000).allowed).toBe(true);
    expect(limiter.check(1, 10_000).allowed).toBe(true);
    expect(limiter.check(1, 10_000).allowed).toBe(false);
  });

  it("reports a shrinking retry delay as tokens recover", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1000 });
    expect(limiter.check(1, 0).allowed).toBe(true);
    const soon = limiter.check(1, 0).retryAfterMs;
    const later = limiter.check(1, 500).retryAfterMs;
    expect(later).toBeLessThan(soon);
  });
});
