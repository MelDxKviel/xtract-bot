import type { Context } from "grammy";

import type { Settings } from "@/config";
import type { TweetProvider } from "@/providers/base";
import type { Repositories } from "@/repositories";
import type { AccessService } from "@/services/access";
import type { StatsService } from "@/services/stats";
import type { TweetShareService } from "@/services/tweetShare";

export interface AppServices {
  access: AccessService;
  stats: StatsService;
  tweetShare: TweetShareService;
}

export type AppContext = Context & {
  settings: Settings;
  provider: TweetProvider;
  repositories: Repositories;
  services: AppServices;
};
