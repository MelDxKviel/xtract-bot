import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCacheCleanup } from "@/services/cacheCleanup";

describe("startCacheCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the cleanup on each interval until stopped", async () => {
    let runs = 0;
    const handle = startCacheCleanup({
      intervalMs: 1000,
      run: async () => {
        runs += 1;
        return runs;
      },
    });

    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runs).toBe(3);

    handle.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(3);
  });

  it("keeps ticking even when a pass throws", async () => {
    let runs = 0;
    const handle = startCacheCleanup({
      intervalMs: 1000,
      run: async () => {
        runs += 1;
        throw new Error("boom");
      },
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    handle.stop();
  });

  it("runOnce returns the rows removed", async () => {
    const handle = startCacheCleanup({ intervalMs: 1000, run: async () => 42 });
    await expect(handle.runOnce()).resolves.toBe(42);
    handle.stop();
  });
});
