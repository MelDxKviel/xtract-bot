import type { Context } from "grammy";

import type { Settings } from "@/config";
import type { TweetProvider } from "@/providers/base";
import type { ProfileProvider } from "@/providers/profileBase";
import type { Repositories } from "@/repositories";
import type { AccessService } from "@/services/access";
import type { AvatarEmojiService } from "@/services/avatarEmoji";
import type { ProfileShareService } from "@/services/profileShare";
import type { StatsService } from "@/services/stats";
import type { Translator } from "@/services/translation";
import type { TweetShareService } from "@/services/tweetShare";

export interface AppServices {
  access: AccessService;
  stats: StatsService;
  tweetShare: TweetShareService;
  profileShare: ProfileShareService;
  /** Present only when AVATAR_EMOJI_ENABLED; turns avatars into custom emoji. */
  avatarEmoji?: AvatarEmojiService;
}

export interface RuntimeConfig {
  whitelistEnabled: boolean;
  russianTranslationEnabled: boolean;
  avatarEmojiEnabled: boolean;
}

export type AppContext = Context & {
  settings: Settings;
  provider: TweetProvider;
  profileProvider: ProfileProvider;
  translator: Translator;
  repositories: Repositories;
  services: AppServices;
  runtimeConfig: RuntimeConfig;
};
