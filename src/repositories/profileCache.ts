import { and, eq, isNotNull, lte, sql as drizzleSql } from "drizzle-orm";

import type { DatabaseTx } from "@/db/client";
import { profileCache } from "@/db/schema";
import {
  profileFromPayload,
  profileToPayload,
  type ProfileData,
  type ProfileDataPayload,
} from "@/providers/profileBase";

export type ProfileCacheEntry =
  | { kind: "hit"; profile: ProfileData }
  | { kind: "negative"; errorCode: string };

export interface ProfileCacheRepository {
  getEntry(username: string): Promise<ProfileCacheEntry | null>;
  set(profile: ProfileData, sourceUrl: string, options: { ttlSeconds: number }): Promise<void>;
  setNegative(
    username: string,
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

// X usernames are case-insensitive, so normalise before storing/looking up.
function normalize(username: string): string {
  return username.replace(/^@+/, "").toLowerCase();
}

export function createProfileCacheRepository(tx: DatabaseTx): ProfileCacheRepository {
  return {
    async getEntry(username): Promise<ProfileCacheEntry | null> {
      const key = normalize(username);
      const rows = await tx
        .select()
        .from(profileCache)
        .where(eq(profileCache.username, key))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
      if (row.payload === null) {
        return { kind: "negative", errorCode: row.errorCode ?? "not_found" };
      }
      return { kind: "hit", profile: profileFromPayload(row.payload as ProfileDataPayload) };
    },

    async set(profile, sourceUrl, { ttlSeconds }): Promise<void> {
      const expiresAt = expiry(ttlSeconds);
      const payload = profileToPayload(profile);
      const key = normalize(profile.username);
      await tx
        .insert(profileCache)
        .values({ username: key, sourceUrl, payload, errorCode: null, expiresAt })
        .onConflictDoUpdate({
          target: profileCache.username,
          set: {
            sourceUrl,
            payload,
            errorCode: null,
            expiresAt,
            updatedAt: drizzleSql`now()`,
          },
        });
    },

    async setNegative(username, sourceUrl, errorCode, { ttlSeconds }): Promise<void> {
      const expiresAt = expiry(ttlSeconds);
      const key = normalize(username);
      await tx
        .insert(profileCache)
        .values({ username: key, sourceUrl, payload: null, errorCode, expiresAt })
        .onConflictDoUpdate({
          target: profileCache.username,
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
      const rows = await tx.select({ count: drizzleSql<number>`count(*)::int` }).from(profileCache);
      return rows[0]?.count ?? 0;
    },

    async clearAll(): Promise<number> {
      const deleted = await tx.delete(profileCache).returning({ id: profileCache.id });
      return deleted.length;
    },

    async clearExpired(now = new Date()): Promise<number> {
      const deleted = await tx
        .delete(profileCache)
        .where(and(isNotNull(profileCache.expiresAt), lte(profileCache.expiresAt, now)))
        .returning({ id: profileCache.id });
      return deleted.length;
    },
  };
}
