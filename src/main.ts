import { buildBot } from "@/bot/dispatcher";
import { loadSettings } from "@/config";
import { closeDatabase, createDatabase } from "@/db/client";
import { configureLogging, log } from "@/logging";
import { createTweetProvider } from "@/providers/factory";

async function main(): Promise<void> {
  const settings = loadSettings();
  configureLogging(settings.logLevel);

  const dbHandle = createDatabase(settings.databaseUrl);
  const provider = createTweetProvider(settings);
  const bot = buildBot({ settings, db: dbHandle.db, provider });

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

  const shutdown = async (): Promise<void> => {
    log.info("shutting down");
    try {
      await bot.stop();
    } catch (error) {
      log.error("error stopping bot", error);
    }
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
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  log.info("starting bot in polling mode");
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
