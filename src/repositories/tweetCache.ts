import { eq, sql as drizzleSql } from "drizzle-orm";

import type { DatabaseTx } from "@/db/client";
import { tweetCache } from "@/db/schema";
import {
  tweetFromPayload,
  tweetToPayload,
  type TweetData,
  type TweetDataPayload,
} from "@/providers/base";

export interface TweetCacheRepository {
  get(tweetId: string): Promise<TweetData | null>;
  set(tweet: TweetData, sourceUrl: string, options: { ttlSeconds: number }): Promise<void>;
}

export function createTweetCacheRepository(tx: DatabaseTx): TweetCacheRepository {
  return {
    async get(tweetId): Promise<TweetData | null> {
      const rows = await tx
        .select()
        .from(tweetCache)
        .where(eq(tweetCache.tweetId, tweetId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
      return tweetFromPayload(row.payload as TweetDataPayload);
    },

    async set(tweet, sourceUrl, { ttlSeconds }): Promise<void> {
      const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
      const payload = tweetToPayload(tweet);
      await tx
        .insert(tweetCache)
        .values({
          tweetId: tweet.tweetId,
          sourceUrl,
          payload,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: tweetCache.tweetId,
          set: {
            sourceUrl,
            payload,
            expiresAt,
            updatedAt: drizzleSql`now()`,
          },
        });
    },
  };
}
