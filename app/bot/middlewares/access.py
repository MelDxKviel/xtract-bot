from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.enums import ParseMode
from aiogram.types import (
    ChosenInlineResult,
    InlineQuery,
    InlineQueryResultArticle,
    InputTextMessageContent,
    Message,
    TelegramObject,
)

from app.config import Settings
from app.providers.base import TweetProvider
from app.repositories import (
    AdminActionsRepository,
    ShareEventRepository,
    TweetCacheRepository,
    UserRepository,
)
from app.services import AccessService, StatsService, TweetShareService

PUBLIC_COMMANDS = {"/start", "/help", "/id"}


class DatabaseSessionMiddleware(BaseMiddleware):
    def __init__(self, *, session_factory, settings: Settings, provider: TweetProvider) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self._provider = provider

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        async with self._session_factory() as session:
            users = UserRepository(session)
            tweet_cache = TweetCacheRepository(session)
            share_events = ShareEventRepository(session)
            admin_actions = AdminActionsRepository(session)
            access_service = AccessService(
                users,
                self._settings.admin_id_set,
                whitelist_enabled=self._settings.access_whitelist_enabled,
            )

            data.update(
                {
                    "session": session,
                    "settings": self._settings,
                    "provider": self._provider,
                    "users_repository": users,
                    "tweet_cache_repository": tweet_cache,
                    "share_events_repository": share_events,
                    "admin_actions_repository": admin_actions,
                    "access_service": access_service,
                    "stats_service": StatsService(share_events),
                    "tweet_share_service": TweetShareService(
                        provider=self._provider,
                        cache_repository=tweet_cache,
                        share_events_repository=share_events,
                        cache_ttl_seconds=self._settings.tweet_cache_ttl_seconds,
                    ),
                }
            )
            try:
                result = await handler(event, data)
            except Exception:
                await session.rollback()
                raise
            await session.commit()
            return result


class AccessMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = _get_user(event)
        if user is None:
            return None

        access_service: AccessService = data["access_service"]
        await access_service.register_user(user)

        if _is_public_command(event) or await access_service.has_access(user.id):
            return await handler(event, data)

        if isinstance(event, Message):
            await event.answer(
                f"Доступ закрыт. Отправьте администратору ваш Telegram ID: <code>{user.id}</code>",
                parse_mode=ParseMode.HTML,
            )
        elif isinstance(event, InlineQuery):
            await event.answer(
                [
                    InlineQueryResultArticle(
                        id="access-denied",
                        title="Доступ закрыт",
                        description="Попросите администратора добавить ваш Telegram ID",
                        input_message_content=InputTextMessageContent(
                            message_text=f"Доступ закрыт. Telegram ID: {user.id}",
                        ),
                    )
                ],
                cache_time=1,
                is_personal=True,
            )
        return None


def _get_user(event: TelegramObject) -> Any | None:
    if isinstance(event, Message):
        return event.from_user
    if isinstance(event, InlineQuery | ChosenInlineResult):
        return event.from_user
    return None


def _is_public_command(event: TelegramObject) -> bool:
    if not isinstance(event, Message) or not event.text:
        return False
    command = event.text.split(maxsplit=1)[0].split("@", 1)[0].lower()
    return command in PUBLIC_COMMANDS
