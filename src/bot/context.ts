import type { Context } from "grammy";

import type { Settings } from "@/config";
import type { TweetProvider } from "@/providers/base";
import type { Repositories } from "@/repositories";
import type { AccessService } from "@/services/access";
import type { StatsService } from "@/services/stats";
import type { Translator } from "@/services/translation";
import type { TweetShareService } from "@/services/tweetShare";

export interface AppServices {
  access: AccessService;
  stats: StatsService;
  tweetShare: TweetShareService;
}

export interface RuntimeConfig {
  whitelistEnabled: boolean;
  russianTranslationEnabled: boolean;
}

export type AppContext = Context & {
  settings: Settings;
  provider: TweetProvider;
  translator: Translator;
  repositories: Repositories;
  services: AppServices;
  runtimeConfig: RuntimeConfig;
};
