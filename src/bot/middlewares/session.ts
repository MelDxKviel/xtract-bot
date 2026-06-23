import type { MiddlewareFn } from "grammy";

import type { Settings } from "@/config";
import type { Database } from "@/db/client";
import type { TweetProvider } from "@/providers/base";
import type { ProfileProvider } from "@/providers/profileBase";
import { createRepositories } from "@/repositories";
import { createAccessService } from "@/services/access";
import { createProfileShareService } from "@/services/profileShare";
import { createStatsService } from "@/services/stats";
import type { Translator } from "@/services/translation";
import { createTweetShareService } from "@/services/tweetShare";

import type { AppContext, RuntimeConfig } from "@/bot/context";

interface Deps {
  db: Database;
  settings: Settings;
  provider: TweetProvider;
  profileProvider: ProfileProvider;
  translator: Translator;
  runtimeConfig: RuntimeConfig;
}

export function sessionMiddleware({
  db,
  settings,
  provider,
  profileProvider,
  translator,
  runtimeConfig,
}: Deps): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    await db.transaction(async (tx) => {
      const repositories = createRepositories(tx);
      ctx.settings = settings;
      ctx.provider = provider;
      ctx.profileProvider = profileProvider;
      ctx.translator = translator;
      ctx.repositories = repositories;
      ctx.runtimeConfig = runtimeConfig;
      ctx.services = {
        access: createAccessService(repositories.users, settings.adminIds, {
          whitelistEnabled: runtimeConfig.whitelistEnabled,
        }),
        stats: createStatsService(repositories.shareEvents),
        tweetShare: createTweetShareService({
          provider,
          cacheRepository: repositories.tweetCache,
          shareEventsRepository: repositories.shareEvents,
          cacheTtlSeconds: settings.tweetCacheTtlSeconds,
          negativeCacheTtlSeconds: settings.negativeCacheTtlSeconds,
          threadUnrollEnabled: settings.threadUnrollEnabled,
          threadMaxTweets: settings.threadMaxTweets,
        }),
        profileShare: createProfileShareService({
          provider: profileProvider,
          cacheRepository: repositories.profileCache,
          shareEventsRepository: repositories.shareEvents,
          cacheTtlSeconds: settings.profileCacheTtlSeconds,
          negativeCacheTtlSeconds: settings.negativeCacheTtlSeconds,
        }),
      };
      await next();
    });
  };
}
