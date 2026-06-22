import { Bot } from "grammy";

import type { Settings } from "@/config";
import type { Database } from "@/db/client";
import type { TweetProvider } from "@/providers/base";
import type { Translator } from "@/services/translation";

import { createRateLimiter } from "@/services/rateLimit";

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
  translator: Translator;
}

export function buildBot({ settings, db, provider, translator }: BuildBotDeps): Bot<AppContext> {
  const bot = new Bot<AppContext>(settings.botToken);

  const runtimeConfig: RuntimeConfig = {
    whitelistEnabled: settings.accessWhitelistEnabled,
    russianTranslationEnabled: settings.russianTranslationEnabled,
  };
  bot.use(sessionMiddleware({ db, settings, provider, translator, runtimeConfig }));
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
