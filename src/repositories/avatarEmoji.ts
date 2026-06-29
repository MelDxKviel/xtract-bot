import { asc, eq, lt, sql as drizzleSql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { avatarEmoji, emojiStickerSets } from "@/db/schema";

export interface OpenStickerSet {
  name: string;
  setIndex: number;
}

export interface AvatarEmojiRepository {
  /** Custom emoji id previously created for this exact avatar URL, if any. */
  getEmojiId(avatarUrl: string): Promise<string | null>;
  /** A bot-owned custom-emoji set with room left (lowest index first). */
  pickOpenSet(capacity: number): Promise<OpenStickerSet | null>;
  /** Index to use for the next new set (max existing index + 1, else 0). */
  nextSetIndex(): Promise<number>;
  /** Record a freshly created, still-empty sticker set. */
  registerSet(name: string, setIndex: number): Promise<void>;
  /**
   * Persist the avatar → emoji mapping and bump the owning set's fill count.
   * Idempotent on `avatarUrl`: a concurrent duplicate leaves the count untouched.
   */
  recordEmoji(avatarUrl: string, customEmojiId: string, setName: string): Promise<void>;
}

export function createAvatarEmojiRepository(db: Database): AvatarEmojiRepository {
  return {
    async getEmojiId(avatarUrl): Promise<string | null> {
      const rows = await db
        .select({ customEmojiId: avatarEmoji.customEmojiId })
        .from(avatarEmoji)
        .where(eq(avatarEmoji.avatarUrl, avatarUrl))
        .limit(1);
      return rows[0]?.customEmojiId ?? null;
    },

    async pickOpenSet(capacity): Promise<OpenStickerSet | null> {
      const rows = await db
        .select({ name: emojiStickerSets.name, setIndex: emojiStickerSets.setIndex })
        .from(emojiStickerSets)
        .where(lt(emojiStickerSets.stickerCount, capacity))
        .orderBy(asc(emojiStickerSets.setIndex))
        .limit(1);
      return rows[0] ?? null;
    },

    async nextSetIndex(): Promise<number> {
      const rows = await db
        .select({ max: drizzleSql<number | null>`max(${emojiStickerSets.setIndex})` })
        .from(emojiStickerSets);
      const max = rows[0]?.max;
      return max === null || max === undefined ? 0 : max + 1;
    },

    async registerSet(name, setIndex): Promise<void> {
      await db
        .insert(emojiStickerSets)
        .values({ name, setIndex, stickerCount: 0 })
        .onConflictDoNothing({ target: emojiStickerSets.name });
    },

    async recordEmoji(avatarUrl, customEmojiId, setName): Promise<void> {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(avatarEmoji)
          .values({ avatarUrl, customEmojiId, setName })
          .onConflictDoNothing({ target: avatarEmoji.avatarUrl })
          .returning({ id: avatarEmoji.id });
        // Only count the sticker if we actually stored a new mapping.
        if (inserted.length > 0) {
          await tx
            .update(emojiStickerSets)
            .set({
              stickerCount: drizzleSql`${emojiStickerSets.stickerCount} + 1`,
              updatedAt: drizzleSql`now()`,
            })
            .where(eq(emojiStickerSets.name, setName));
        }
      });
    },
  };
}
