import { webhookCallback, type Bot } from "grammy";

import { registerBotCommands } from "@/bot/commands";
import { buildBot } from "@/bot/dispatcher";
import { loadSettings, type Settings } from "@/config";
import { closeDatabase, createDatabase } from "@/db/client";
import { configureLogging, log } from "@/logging";
import { createTweetProvider } from "@/providers/factory";
import { cleanupExpiredCache, startCacheCleanup } from "@/services/cacheCleanup";
import { createTranslator } from "@/services/translation";

import type { AppContext } from "@/bot/context";

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
      // Rich messages carry their own formatting; parse_mode only applies to
      // plain text/caption payloads and would be rejected alongside rich_message.
      if (p.parse_mode === undefined && p.rich_message === undefined) p.parse_mode = "HTML";
    }
    return prev(method, payload, signal);
  });

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

  // Periodically purge expired cache rows so the table doesn't grow unbounded.
  const cacheCleanup = settings.cacheCleanupEnabled
    ? startCacheCleanup({
        intervalMs: settings.cacheCleanupIntervalSeconds * 1000,
        run: () => cleanupExpiredCache(dbHandle.db),
      })
    : null;
  if (cacheCleanup) {
    log.info(`cache cleanup enabled (every ${settings.cacheCleanupIntervalSeconds}s)`);
  }

  const drainAndClose = async (): Promise<void> => {
    log.info("draining in-flight handlers");
    cacheCleanup?.stop();
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
  };

  try {
    await registerBotCommands(bot, settings);
  } catch (error) {
    log.error("failed to register bot commands", error);
  }

  if (settings.pollingEnabled) {
    await runPolling(bot, drainAndClose);
  } else {
    await runWebhook(bot, settings, drainAndClose);
  }
}

async function runPolling(bot: Bot<AppContext>, drainAndClose: () => Promise<void>): Promise<void> {
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
    await bot.start({ onStart: () => log.info("bot is running") });
  } finally {
    await drainAndClose();
  }
}

async function runWebhook(
  bot: Bot<AppContext>,
  settings: Settings,
  drainAndClose: () => Promise<void>,
): Promise<void> {
  if (!settings.webhookUrl) {
    throw new Error("WEBHOOK_URL is required when POLLING_ENABLED=false");
  }

  // grammY needs bot.botInfo before it can dispatch updates; polling does this
  // inside bot.start(), but the webhook path must initialise explicitly.
  await bot.init();

  const expectedPath = webhookPath(settings.webhookUrl);
  const handleUpdate = webhookCallback(bot, "bun", {
    secretToken: settings.webhookSecret ?? undefined,
  });

  const server = Bun.serve({
    port: settings.webhookPort,
    fetch: (request) => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === expectedPath) {
        return handleUpdate(request);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return new Response("ok");
      }
      return new Response("not found", { status: 404 });
    },
  });

  await bot.api.setWebhook(settings.webhookUrl, {
    secret_token: settings.webhookSecret ?? undefined,
    drop_pending_updates: true,
  });
  log.info(`bot is running (webhook on :${settings.webhookPort}${expectedPath})`);

  try {
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
  } finally {
    log.info("stopping webhook server");
    // Graceful stop: let in-flight webhook requests (and their DB transactions)
    // finish before we tear down the provider and database.
    await server.stop();
    await drainAndClose();
  }
}

function webhookPath(webhookUrl: string): string {
  try {
    const path = new URL(webhookUrl).pathname;
    return path.length > 0 ? path : "/";
  } catch {
    return "/";
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
