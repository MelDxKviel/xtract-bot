import type { Bot } from "grammy";
import type { BotCommand } from "grammy/types";

import type { Settings } from "@/config";
import type { AppContext } from "@/bot/context";
import { log } from "@/logging";

const PUBLIC_COMMANDS: BotCommand[] = [
  { command: "start", description: "Описание бота" },
  { command: "help", description: "Как пользоваться" },
  { command: "id", description: "Показать ваш Telegram ID" },
];

const ADMIN_COMMANDS: BotCommand[] = [
  { command: "panel", description: "Сводка по боту" },
  { command: "stats", description: "Статистика" },
  { command: "users", description: "Список whitelist" },
  { command: "allow", description: "Добавить в whitelist" },
  { command: "deny", description: "Удалить из whitelist" },
  { command: "whitelist", description: "Управление whitelist" },
  { command: "health", description: "Проверка БД и провайдера" },
];

export async function registerBotCommands(bot: Bot<AppContext>, settings: Settings): Promise<void> {
  await bot.api.setMyCommands(PUBLIC_COMMANDS, {
    scope: { type: "all_private_chats" },
  });
  for (const adminId of settings.adminIds) {
    try {
      await bot.api.setMyCommands([...PUBLIC_COMMANDS, ...ADMIN_COMMANDS], {
        scope: { type: "chat", chat_id: adminId },
      });
    } catch (error) {
      log.error(`failed to set admin commands for ${adminId}`, error);
    }
  }
}
