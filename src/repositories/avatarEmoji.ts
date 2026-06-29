import { asc, eq, lt, sql as drizzleSql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { avatarEmoji, emojiStickerSets } from "@/db/schema";

export interface OpenStickerSet {
  name: string;
  setIndex: number;
}

export interface AvatarEmojiEntry {
  avatarUrl: string;
  customEmojiId: string;
  stickerFileId: string;
  setName: string;
}

export interface NewAvatarEmoji extends AvatarEmojiEntry {
  username: string;
}

export interface AvatarEmojiRepository {
  /** The emoji currently mapped to this X user, if any. */
  getByUsername(username: string): Promise<AvatarEmojiEntry | null>;
  /** A bot-owned custom-emoji set with room left (lowest index first). */
  pickOpenSet(capacity: number): Promise<OpenStickerSet | null>;
  /** Index to use for the next new set (max existing index + 1, else 0). */
  nextSetIndex(): Promise<number>;
  /** Record a freshly created, still-empty sticker set. */
  registerSet(name: string, setIndex: number): Promise<void>;
  /**
   * Store the mapping for a user seen for the first time and bump the owning
   * set's fill count. Idempotent on `username`: a concurrent duplicate leaves
   * both the row and the count untouched.
   */
  insertEmoji(entry: NewAvatarEmoji): Promise<void>;
  /**
   * Repoint a user to a replacement emoji after their avatar changed. The set
   * is unchanged (the old sticker was deleted and a new one added in place), so
   * the fill count is left alone.
   */
  updateEmoji(
    username: string,
    avatarUrl: string,
    customEmojiId: string,
    stickerFileId: string,
  ): Promise<void>;
}

export function createAvatarEmojiRepository(db: Database): AvatarEmojiRepository {
  return {
    async getByUsername(username): Promise<AvatarEmojiEntry | null> {
      const rows = await db
        .select({
          avatarUrl: avatarEmoji.avatarUrl,
          customEmojiId: avatarEmoji.customEmojiId,
          stickerFileId: avatarEmoji.stickerFileId,
          setName: avatarEmoji.setName,
        })
        .from(avatarEmoji)
        .where(eq(avatarEmoji.username, username))
        .limit(1);
      return rows[0] ?? null;
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

    async insertEmoji(entry): Promise<void> {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(avatarEmoji)
          .values({
            username: entry.username,
            avatarUrl: entry.avatarUrl,
            customEmojiId: entry.customEmojiId,
            stickerFileId: entry.stickerFileId,
            setName: entry.setName,
          })
          .onConflictDoNothing({ target: avatarEmoji.username })
          .returning({ id: avatarEmoji.id });
        // Only count the sticker if we actually stored a new mapping.
        if (inserted.length > 0) {
          await tx
            .update(emojiStickerSets)
            .set({
              stickerCount: drizzleSql`${emojiStickerSets.stickerCount} + 1`,
              updatedAt: drizzleSql`now()`,
            })
            .where(eq(emojiStickerSets.name, entry.setName));
        }
      });
    },

    async updateEmoji(username, avatarUrl, customEmojiId, stickerFileId): Promise<void> {
      await db
        .update(avatarEmoji)
        .set({ avatarUrl, customEmojiId, stickerFileId, updatedAt: drizzleSql`now()` })
        .where(eq(avatarEmoji.username, username));
    },
  };
}
