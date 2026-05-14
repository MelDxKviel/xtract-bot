import { Bot } from "grammy";

import type { Settings } from "@/config";
import type { Database } from "@/db/client";
import type { TweetProvider } from "@/providers/base";

import type { AppContext } from "@/bot/context";
import { adminComposer } from "@/bot/handlers/admin";
import { inlineComposer } from "@/bot/handlers/inline";
import { privateComposer } from "@/bot/handlers/private";
import { accessMiddleware } from "@/bot/middlewares/access";
import { sessionMiddleware } from "@/bot/middlewares/session";

interface BuildBotDeps {
  settings: Settings;
  db: Database;
  provider: TweetProvider;
}

export function buildBot({ settings, db, provider }: BuildBotDeps): Bot<AppContext> {
  const bot = new Bot<AppContext>(settings.botToken);

  bot.use(sessionMiddleware({ db, settings, provider }));
  bot.use(accessMiddleware);

  bot.use(adminComposer);
  bot.use(privateComposer);
  bot.use(inlineComposer);

  return bot;
}
