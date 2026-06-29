import { Bot } from "grammy";

import type { Settings } from "@/config";
import type { Database } from "@/db/client";
import type { TweetProvider } from "@/providers/base";
import type { ProfileProvider } from "@/providers/profileBase";
import type { Translator } from "@/services/translation";

import {
  createAvatarEmojiService,
  createGrammyStickerClient,
  type AvatarEmojiService,
} from "@/services/avatarEmoji";
import { createRateLimiter } from "@/services/rateLimit";
import { createAvatarEmojiRepository } from "@/repositories/avatarEmoji";
import { log } from "@/logging";

import type { AppContext, RuntimeConfig } from "@/bot/context";
import { adminComposer } from "@/bot/handlers/admin";
import { inlineComposer } from "@/bot/handlers/inline";
import { privateComposer } from "@/bot/handlers/private";
import { accessMiddleware } from "@/bot/middlewares/access";
import { rateLimitMiddleware } from "@/bot/middlewares/rateLimit";
import { sessionMiddleware } from "@/bot/middlewares/session";

interface BuildBotDeps {
  settings: Settings;
  db: Database;
  provider: TweetProvider;
  profileProvider: ProfileProvider;
  translator: Translator;
}

export function buildBot({
  settings,
  db,
  provider,
  profileProvider,
  translator,
}: BuildBotDeps): Bot<AppContext> {
  const bot = new Bot<AppContext>(settings.botToken);

  // Build the avatar-emoji service whenever it *can* run (an owner id exists),
  // so an admin can toggle it on at runtime; AVATAR_EMOJI_ENABLED only sets the
  // initial state. If the service can't be built, the feature stays off.
  const avatarEmoji = buildAvatarEmojiService(bot, settings, db);

  const runtimeConfig: RuntimeConfig = {
    whitelistEnabled: settings.accessWhitelistEnabled,
    russianTranslationEnabled: settings.russianTranslationEnabled,
    avatarEmojiEnabled: settings.avatarEmojiEnabled && avatarEmoji !== undefined,
  };

  bot.use(
    sessionMiddleware({
      db,
      settings,
      provider,
      profileProvider,
      translator,
      runtimeConfig,
      avatarEmoji,
    }),
  );
  bot.use(accessMiddleware);

  if (settings.rateLimitEnabled) {
    const limiter = createRateLimiter({
      maxRequests: settings.rateLimitMaxRequests,
      windowMs: settings.rateLimitWindowSeconds * 1000,
    });
    bot.use(rateLimitMiddleware(limiter));
  }

  bot.use(adminComposer);
  bot.use(privateComposer);
  bot.use(inlineComposer);

  return bot;
}

// Build the avatar→custom-emoji service. Sets created by the bot are attributed
// to a Telegram user, so an owner id is required; fall back to the first admin.
// Returns undefined (feature unavailable) only when no owner id can be resolved.
function buildAvatarEmojiService(
  bot: Bot<AppContext>,
  settings: Settings,
  db: Database,
): AvatarEmojiService | undefined {
  const ownerId = settings.avatarEmojiOwnerId ?? [...settings.adminIds][0] ?? null;
  if (ownerId === null) {
    log.warn("avatar emoji unavailable: set AVATAR_EMOJI_OWNER_ID or ADMIN_IDS to enable");
    return undefined;
  }
  return createAvatarEmojiService({
    client: createGrammyStickerClient(bot.api, ownerId),
    repository: createAvatarEmojiRepository(db),
    titlePrefix: settings.avatarEmojiTitlePrefix,
  });
}
