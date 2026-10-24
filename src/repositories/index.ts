import type { Database, DatabaseTx } from "@/db/client";

import {
  createAdminActionsRepository,
  type AdminActionsRepository,
} from "@/repositories/adminActions";
import {
  createBotSettingsRepository,
  type BotSettingsRepository,
} from "@/repositories/botSettings";
import {
  createProfileCacheRepository,
  type ProfileCacheRepository,
} from "@/repositories/profileCache";
import { createShareEventRepository, type ShareEventRepository } from "@/repositories/shareEvents";
import { createTweetCacheRepository, type TweetCacheRepository } from "@/repositories/tweetCache";
import { createUserRepository, type UserRepository } from "@/repositories/users";

export interface Repositories {
  users: UserRepository;
  tweetCache: TweetCacheRepository;
  profileCache: ProfileCacheRepository;
  shareEvents: ShareEventRepository;
  adminActions: AdminActionsRepository;
  botSettings: BotSettingsRepository;
}

export interface CreateRepositoriesOptions {
  /** When set (typically the root db), bot_settings writes commit outside the
   * request transaction so a failed Telegram reply cannot roll them back. */
  botSettingsDb?: Database | DatabaseTx;
}

export function createRepositories(
  tx: DatabaseTx,
  options: CreateRepositoriesOptions = {},
): Repositories {
  return {
    users: createUserRepository(tx),
    tweetCache: createTweetCacheRepository(tx),
    profileCache: createProfileCacheRepository(tx),
    shareEvents: createShareEventRepository(tx),
    adminActions: createAdminActionsRepository(tx),
    botSettings: createBotSettingsRepository(options.botSettingsDb ?? tx),
  };
}

export type {
  AdminActionsRepository,
  BotSettingsRepository,
  ProfileCacheRepository,
  ShareEventRepository,
  TweetCacheRepository,
  UserRepository,
};
