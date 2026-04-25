from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class StatsSummary:
    total: int
    success: int
    errors: int
    private: int
    inline: int
    users: int


class StatsService:
    def __init__(self, share_events_repository: Any) -> None:
        self._share_events = share_events_repository

    async def get_summary(self, *, telegram_user_id: int | None = None) -> StatsSummary:
        data = await self._share_events.summary(telegram_user_id=telegram_user_id)
        return StatsSummary(
            total=data["total"],
            success=data["success"],
            errors=data["errors"],
            private=data["private"],
            inline=data["inline"],
            users=data["users"],
        )

    async def render_summary(self, *, telegram_user_id: int | None = None) -> str:
        summary = await self.get_summary(telegram_user_id=telegram_user_id)
        prefix = (
            f"Статистика пользователя {telegram_user_id}\n" if telegram_user_id is not None else ""
        )
        return (
            f"{prefix}"
            f"Всего ссылок: {summary.total}\n"
            f"Успешно: {summary.success}\n"
            f"Ошибки: {summary.errors}\n"
            f"Личный чат: {summary.private}\n"
            f"Inline: {summary.inline}\n"
            f"Пользователей: {summary.users}"
        )

    async def render_tops(self) -> str:
        top_users = await self._share_events.top_users(limit=5)
        top_tweets = await self._share_events.top_tweets(limit=5)
        user_lines = [f"{telegram_id}: {count}" for telegram_id, count in top_users] or [
            "Нет данных"
        ]
        tweet_lines = [f"{tweet_id}: {count}" for tweet_id, count in top_tweets] or ["Нет данных"]
        return (
            "Топ пользователей:\n"
            + "\n".join(user_lines)
            + "\n\nТоп постов:\n"
            + "\n".join(tweet_lines)
        )
