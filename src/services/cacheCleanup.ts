import type { Database } from "@/db/client";
import { log } from "@/logging";
import { createProfileCacheRepository } from "@/repositories/profileCache";
import { createTweetCacheRepository } from "@/repositories/tweetCache";

export interface CacheCleanupHandle {
  /** Stop the periodic timer. Safe to call multiple times. */
  stop(): void;
  /** Run a single cleanup pass immediately. Returns rows removed. */
  runOnce(): Promise<number>;
}

interface StartCacheCleanupOptions {
  intervalMs: number;
  /** Performs one cleanup pass and resolves with the number of rows removed. */
  run: () => Promise<number>;
}

/**
 * Delete expired tweet- and profile-cache rows in a dedicated transaction. Used
 * both by the scheduled cleanup loop and as a building block for tests.
 */
export function cleanupExpiredCache(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    const tweets = await createTweetCacheRepository(tx).clearExpired();
    const profiles = await createProfileCacheRepository(tx).clearExpired();
    return tweets + profiles;
  });
}

/**
 * Run `run` on a fixed interval. The timer is unref'd so it never keeps the
 * process alive on its own, and failures are logged without crashing the loop.
 */
export function startCacheCleanup({
  intervalMs,
  run,
}: StartCacheCleanupOptions): CacheCleanupHandle {
  const runOnce = async (): Promise<number> => {
    const removed = await run();
    if (removed > 0) log.info(`cache cleanup removed ${removed} expired entries`);
    return removed;
  };

  const tick = async (): Promise<void> => {
    try {
      await runOnce();
    } catch (error) {
      log.error("cache cleanup failed", error);
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // Don't let the cleanup timer keep the process alive during shutdown.
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    stop: () => clearInterval(timer),
    runOnce,
  };
}
