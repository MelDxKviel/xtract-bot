import type { DatabaseTx } from "@/db/client";

import {
  createAdminActionsRepository,
  type AdminActionsRepository,
} from "@/repositories/adminActions";
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
}

export function createRepositories(tx: DatabaseTx): Repositories {
  return {
    users: createUserRepository(tx),
    tweetCache: createTweetCacheRepository(tx),
    profileCache: createProfileCacheRepository(tx),
    shareEvents: createShareEventRepository(tx),
    adminActions: createAdminActionsRepository(tx),
  };
}

export type {
  AdminActionsRepository,
  ProfileCacheRepository,
  ShareEventRepository,
  TweetCacheRepository,
  UserRepository,
};
