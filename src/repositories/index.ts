import type { DatabaseTx } from "@/db/client";

import {
  createAdminActionsRepository,
  type AdminActionsRepository,
} from "@/repositories/adminActions";
import { createShareEventRepository, type ShareEventRepository } from "@/repositories/shareEvents";
import { createTweetCacheRepository, type TweetCacheRepository } from "@/repositories/tweetCache";
import { createUserRepository, type UserRepository } from "@/repositories/users";

export interface Repositories {
  users: UserRepository;
  tweetCache: TweetCacheRepository;
  shareEvents: ShareEventRepository;
  adminActions: AdminActionsRepository;
}

export function createRepositories(tx: DatabaseTx): Repositories {
  return {
    users: createUserRepository(tx),
    tweetCache: createTweetCacheRepository(tx),
    shareEvents: createShareEventRepository(tx),
    adminActions: createAdminActionsRepository(tx),
  };
}

export type { AdminActionsRepository, ShareEventRepository, TweetCacheRepository, UserRepository };
