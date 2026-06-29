import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { TweetDataPayload } from "@/providers/base";
import type { ProfileDataPayload } from "@/providers/profileBase";

export const users = pgTable(
  "users",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    isAllowed: boolean("is_allowed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    telegramIdUnique: uniqueIndex("users_telegram_id_key").on(table.telegramId),
    telegramIdIdx: index("ix_users_telegram_id").on(table.telegramId),
  }),
);

export const tweetCache = pgTable("tweet_cache", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tweetId: text("tweet_id").notNull().unique(),
  sourceUrl: text("source_url").notNull(),
  // Null for negative cache entries (deleted/not-found tweets), which instead
  // carry an `errorCode` so we don't re-hit providers for known-bad tweets.
  payload: jsonb("payload").$type<TweetDataPayload>(),
  errorCode: text("error_code"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const profileCache = pgTable("profile_cache", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  // Lower-cased handle; X usernames are case-insensitive.
  username: text("username").notNull().unique(),
  sourceUrl: text("source_url").notNull(),
  // Null for negative cache entries (deleted/not-found profiles), which instead
  // carry an `errorCode` so we don't re-hit providers for known-bad handles.
  payload: jsonb("payload").$type<ProfileDataPayload>(),
  errorCode: text("error_code"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Maps a unique source avatar URL to the custom emoji we created from it. Keyed
// by URL so a changed avatar (new image URL) transparently gets a fresh emoji.
export const avatarEmoji = pgTable("avatar_emoji", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  avatarUrl: text("avatar_url").notNull().unique(),
  customEmojiId: text("custom_emoji_id").notNull(),
  setName: text("set_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// The custom-emoji sticker sets the bot owns. Avatars are pooled into these
// (Telegram caps a set at 200 emoji); `stickerCount` tracks fill so we can pick
// a set with room and roll over to a new one when it is full.
export const emojiStickerSets = pgTable("emoji_sticker_sets", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  setIndex: integer("set_index").notNull(),
  stickerCount: integer("sticker_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const shareEvents = pgTable(
  "share_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    chatId: bigint("chat_id", { mode: "number" }),
    tweetId: text("tweet_id"),
    sourceUrl: text("source_url").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    telegramUserIdIdx: index("ix_share_events_telegram_user_id").on(table.telegramUserId),
    tweetIdIdx: index("ix_share_events_tweet_id").on(table.tweetId),
    createdAtIdx: index("ix_share_events_created_at").on(table.createdAt),
  }),
);

export const adminActions = pgTable(
  "admin_actions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    adminTelegramId: bigint("admin_telegram_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    targetTelegramId: bigint("target_telegram_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    adminTelegramIdIdx: index("ix_admin_actions_admin_telegram_id").on(table.adminTelegramId),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type TweetCacheRow = typeof tweetCache.$inferSelect;
export type ProfileCacheRow = typeof profileCache.$inferSelect;
export type AvatarEmojiRow = typeof avatarEmoji.$inferSelect;
export type EmojiStickerSetRow = typeof emojiStickerSets.$inferSelect;
export type ShareEventRow = typeof shareEvents.$inferSelect;
export type AdminActionRow = typeof adminActions.$inferSelect;
