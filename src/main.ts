import { registerBotCommands } from "@/bot/commands";
import { buildBot } from "@/bot/dispatcher";
import { loadSettings } from "@/config";
import { closeDatabase, createDatabase } from "@/db/client";
import { configureLogging, log } from "@/logging";
import { createTweetProvider } from "@/providers/factory";
import { createTranslator } from "@/services/translation";

async function main(): Promise<void> {
  const settings = loadSettings();
  configureLogging(settings.logLevel);

  const dbHandle = createDatabase(settings.databaseUrl);
  const provider = createTweetProvider(settings);
  const translator = createTranslator({ timeoutSeconds: settings.translationTimeoutSeconds });
  const bot = buildBot({ settings, db: dbHandle.db, provider, translator });

  // Apply HTML parse mode and disabled link preview as Bot API defaults.
  bot.api.config.use((prev, method, payload, signal) => {
    if (
      method === "sendMessage" ||
      method === "editMessageText" ||
      method === "editMessageCaption"
    ) {
      const p = payload as Record<string, unknown>;
      if (p.parse_mode === undefined) p.parse_mode = "HTML";
    }
    return prev(method, payload, signal);
  });

  if (!settings.pollingEnabled) {
    throw new Error("Webhook mode is not implemented in MVP. Set POLLING_ENABLED=true.");
  }

  // Track in-flight handler invocations so shutdown can wait for them.
  // grammY's `bot.stop()` does not wait for the middleware stack to finish,
  // and closing the DB or provider while a transaction is still running would
  // drop share/admin events mid-write.
  const inFlight = new Set<Promise<unknown>>();
  bot.use(async (_ctx, next) => {
    const task = next();
    inFlight.add(task);
    try {
      await task;
    } finally {
      inFlight.delete(task);
    }
  });

  const stopBot = async (): Promise<void> => {
    try {
      await bot.stop();
    } catch (error) {
      log.error("error stopping bot", error);
    }
  };

  process.once("SIGINT", () => void stopBot());
  process.once("SIGTERM", () => void stopBot());

  log.info("starting bot in polling mode");
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  try {
    await registerBotCommands(bot, settings);
  } catch (error) {
    log.error("failed to register bot commands", error);
  }
  try {
    await bot.start({ onStart: () => log.info("bot is running") });
  } finally {
    log.info("draining in-flight handlers");
    await Promise.allSettled(inFlight);
    try {
      await provider.close();
    } catch (error) {
      log.error("error closing provider", error);
    }
    try {
      await closeDatabase(dbHandle);
    } catch (error) {
      log.error("error closing database", error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
