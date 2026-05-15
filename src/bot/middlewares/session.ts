import type { MiddlewareFn } from "grammy";

import type { Settings } from "@/config";
import type { Database } from "@/db/client";
import type { TweetProvider } from "@/providers/base";
import { createRepositories } from "@/repositories";
import { createAccessService } from "@/services/access";
import { createStatsService } from "@/services/stats";
import { createTweetShareService } from "@/services/tweetShare";

import type { AppContext, RuntimeConfig } from "@/bot/context";

interface Deps {
  db: Database;
  settings: Settings;
  provider: TweetProvider;
  runtimeConfig: RuntimeConfig;
}

export function sessionMiddleware({
  db,
  settings,
  provider,
  runtimeConfig,
}: Deps): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    await db.transaction(async (tx) => {
      const repositories = createRepositories(tx);
      ctx.settings = settings;
      ctx.provider = provider;
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
        }),
      };
      await next();
    });
  };
}
