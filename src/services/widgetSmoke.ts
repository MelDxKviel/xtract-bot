import { Bot, GrammyError } from "grammy";

import { loadSettings } from "@/config";
import { originalPostButton } from "@/bot/ui";
import { formatTweet } from "@/formatters/telegram";
import { buildPostWidget } from "@/formatters/widget";
import { makeTweet } from "@/providers/base";

// Run only in the PR test bot, for its single configured administrator.
async function main(): Promise<void> {
  const settings = loadSettings();
  const expectedUsername = process.env["WIDGET_SMOKE_BOT_USERNAME"];
  if (!expectedUsername || !settings.postWidgetsEnabled || settings.adminIds.size !== 1) {
    throw new Error(
      "Widget smoke requires an explicit test-bot username and one test administrator",
    );
  }
  const bot = new Bot(settings.botToken);
  const me = await bot.api.getMe();
  if (me.username !== expectedUsername) throw new Error("Widget smoke bot identity mismatch");
  const tweet = makeTweet({
    tweetId: "20",
    url: "https://x.com/jack/status/20",
    authorName: "Xtract · проверка HTML",
    authorUsername: "xtract",
    authorUrl: "https://x.com",
    text: "Проверка настоящей HTML-карточки.\n\nЕсли вы видите это оформление, Telegram принял виджет. Фото и видео бот отправляет отдельными вложениями ниже.",
  });
  const html = buildPostWidget(formatTweet(tweet), tweet);
  if (!html) throw new Error("Smoke widget failed local validation");
  const chatId = [...settings.adminIds][0]!;
  const raw = bot.api.raw as unknown as {
    sendWidget(payload: Record<string, unknown>): Promise<{ message_id: number }>;
  };
  try {
    const result = await raw.sendWidget({
      chat_id: chatId,
      html,
      caption: "Проверка оформления тестового бота.",
      reply_markup: originalPostButton(tweet.url),
    });
    console.log(
      JSON.stringify({ event: "widget_smoke", sent: true, messageId: result.message_id }),
    );
  } catch (error) {
    if (error instanceof GrammyError) {
      // This request contains only the fixed public smoke fixture above.
      console.error(
        JSON.stringify({
          event: "widget_smoke",
          sent: false,
          errorCode: error.error_code,
          description: error.description.replaceAll(settings.botToken, "[redacted]").slice(0, 200),
        }),
      );
    }
    process.exitCode = 1;
  }
}

if (import.meta.main)
  main().catch(() => {
    console.error("widget_smoke failed before sending");
    process.exitCode = 1;
  });
