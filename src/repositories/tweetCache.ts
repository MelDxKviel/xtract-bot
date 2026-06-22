import { and, eq, isNotNull, lte, sql as drizzleSql } from "drizzle-orm";

import type { DatabaseTx } from "@/db/client";
import { tweetCache } from "@/db/schema";
import {
  tweetFromPayload,
  tweetToPayload,
  type TweetData,
  type TweetDataPayload,
} from "@/providers/base";

export type CacheEntry =
  | { kind: "hit"; tweet: TweetData }
  | { kind: "negative"; errorCode: string };

export interface TweetCacheRepository {
  getEntry(tweetId: string): Promise<CacheEntry | null>;
  set(tweet: TweetData, sourceUrl: string, options: { ttlSeconds: number }): Promise<void>;
  setNegative(
    tweetId: string,
    sourceUrl: string,
    errorCode: string,
    options: { ttlSeconds: number },
  ): Promise<void>;
  /** Number of rows currently in the cache (positive + negative entries). */
  count(): Promise<number>;
  /** Delete every cache row. Returns how many rows were removed. */
  clearAll(): Promise<number>;
  /** Delete rows whose TTL has elapsed. Returns how many rows were removed. */
  clearExpired(now?: Date): Promise<number>;
}

function expiry(ttlSeconds: number): Date | null {
  return ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
}

export function createTweetCacheRepository(tx: DatabaseTx): TweetCacheRepository {
  return {
    async getEntry(tweetId): Promise<CacheEntry | null> {
      const rows = await tx
        .select()
        .from(tweetCache)
        .where(eq(tweetCache.tweetId, tweetId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
      if (row.payload === null) {
        return { kind: "negative", errorCode: row.errorCode ?? "not_found" };
      }
      return { kind: "hit", tweet: tweetFromPayload(row.payload as TweetDataPayload) };
    },

    async set(tweet, sourceUrl, { ttlSeconds }): Promise<void> {
      const expiresAt = expiry(ttlSeconds);
      const payload = tweetToPayload(tweet);
      await tx
        .insert(tweetCache)
        .values({ tweetId: tweet.tweetId, sourceUrl, payload, errorCode: null, expiresAt })
        .onConflictDoUpdate({
          target: tweetCache.tweetId,
          set: {
            sourceUrl,
            payload,
            errorCode: null,
            expiresAt,
            updatedAt: drizzleSql`now()`,
          },
        });
    },

    async setNegative(tweetId, sourceUrl, errorCode, { ttlSeconds }): Promise<void> {
      const expiresAt = expiry(ttlSeconds);
      await tx
        .insert(tweetCache)
        .values({ tweetId, sourceUrl, payload: null, errorCode, expiresAt })
        .onConflictDoUpdate({
          target: tweetCache.tweetId,
          set: {
            sourceUrl,
            payload: null,
            errorCode,
            expiresAt,
            updatedAt: drizzleSql`now()`,
          },
        });
    },

    async count(): Promise<number> {
      const rows = await tx.select({ count: drizzleSql<number>`count(*)::int` }).from(tweetCache);
      return rows[0]?.count ?? 0;
    },

    async clearAll(): Promise<number> {
      const deleted = await tx.delete(tweetCache).returning({ id: tweetCache.id });
      return deleted.length;
    },

    async clearExpired(now = new Date()): Promise<number> {
      const deleted = await tx
        .delete(tweetCache)
        .where(and(isNotNull(tweetCache.expiresAt), lte(tweetCache.expiresAt, now)))
        .returning({ id: tweetCache.id });
      return deleted.length;
    },
  };
}
