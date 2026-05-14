import type { ShareEventRepository, ShareEventSummary } from "@/repositories/shareEvents";

export interface StatsService {
  getSummary(options?: { telegramUserId?: number | null }): Promise<ShareEventSummary>;
  renderSummary(options?: { telegramUserId?: number | null }): Promise<string>;
}

export function createStatsService(
  shareEvents: Pick<ShareEventRepository, "summary">,
): StatsService {
  return {
    async getSummary({ telegramUserId } = {}): Promise<ShareEventSummary> {
      return shareEvents.summary({ telegramUserId: telegramUserId ?? null });
    },
    async renderSummary({ telegramUserId } = {}): Promise<string> {
      const summary = await this.getSummary({ telegramUserId });
      const prefix =
        telegramUserId !== undefined && telegramUserId !== null
          ? `📊 Статистика пользователя ${telegramUserId}\n`
          : "📊 Общая статистика\n";
      return (
        prefix +
        `🔢 Всего ссылок: ${summary.total}\n` +
        `✅ Успешно: ${summary.success}\n` +
        `❌ Ошибки: ${summary.errors}\n` +
        `💬 Личный чат: ${summary.private}\n` +
        `🔍 Inline: ${summary.inline}\n` +
        `👥 Пользователей: ${summary.users}`
      );
    },
  };
}
