from __future__ import annotations

from aiogram import F, Router
from aiogram.enums import ChatType
from aiogram.filters import Command, CommandObject
from aiogram.types import Message
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.providers.base import TweetProvider
from app.repositories import AdminActionsRepository
from app.services import AccessService, StatsService

router = Router(name="admin")
router.message.filter(F.chat.type == ChatType.PRIVATE)


@router.message(Command("allow"))
async def allow_user(
    message: Message,
    command: CommandObject,
    access_service: AccessService,
    admin_actions_repository: AdminActionsRepository,
) -> None:
    if not await _require_admin(message, access_service):
        return
    telegram_id = _parse_telegram_id(command.args)
    if telegram_id is None:
        await message.answer("ℹ️ Использование: /allow <telegram_id>")
        return
    await access_service.allow_user(telegram_id)
    await admin_actions_repository.create(
        admin_telegram_id=message.from_user.id,
        action="allow",
        target_telegram_id=telegram_id,
    )
    await message.answer(f"✅ Пользователь {telegram_id} добавлен в whitelist.")


@router.message(Command("deny"))
async def deny_user(
    message: Message,
    command: CommandObject,
    access_service: AccessService,
    admin_actions_repository: AdminActionsRepository,
) -> None:
    if not await _require_admin(message, access_service):
        return
    telegram_id = _parse_telegram_id(command.args)
    if telegram_id is None:
        await message.answer("ℹ️ Использование: /deny <telegram_id>")
        return
    await access_service.deny_user(telegram_id)
    await admin_actions_repository.create(
        admin_telegram_id=message.from_user.id,
        action="deny",
        target_telegram_id=telegram_id,
    )
    await message.answer(f"🚫 Пользователь {telegram_id} удален из whitelist.")


@router.message(Command("users"))
async def users(message: Message, access_service: AccessService) -> None:
    if not await _require_admin(message, access_service):
        return
    allowed_users = await access_service.list_allowed_users(limit=100)
    if not allowed_users:
        await message.answer("📭 Whitelist пуст.")
        return

    lines = ["👥 Разрешенные пользователи:"]
    for user in allowed_users:
        username = f" @{user.username}" if user.username else ""
        lines.append(f"• {user.telegram_id}{username}")
    await message.answer("\n".join(lines))


@router.message(Command("stats"))
async def stats(
    message: Message,
    command: CommandObject,
    access_service: AccessService,
    stats_service: StatsService,
) -> None:
    if not await _require_admin(message, access_service):
        return
    telegram_id = _parse_telegram_id(command.args) if command.args else None
    summary = await stats_service.render_summary(telegram_user_id=telegram_id)
    if telegram_id is None:
        summary = summary + "\n\n" + await stats_service.render_tops()
    await message.answer(summary)


@router.message(Command("health"))
async def health(
    message: Message,
    access_service: AccessService,
    session: AsyncSession,
    provider: TweetProvider,
) -> None:
    if not await _require_admin(message, access_service):
        return

    db_ok = False
    provider_ok = False
    try:
        await session.execute(text("select 1"))
        db_ok = True
    except Exception:
        db_ok = False

    try:
        provider_ok = await provider.health()
    except Exception:
        provider_ok = False

    await message.answer(
        "🏥 Health\n"
        f"🗄 DB: {'✅ ok' if db_ok else '❌ error'}\n"
        f"🔌 Provider: {'✅ ok' if provider_ok else '❌ error'}"
    )


async def _require_admin(message: Message, access_service: AccessService) -> bool:
    assert message.from_user is not None
    if access_service.is_admin(message.from_user.id):
        return True
    await message.answer("🔒 Команда доступна только администратору.")
    return False


def _parse_telegram_id(value: str | None) -> int | None:
    if not value:
        return None
    item = value.strip().split(maxsplit=1)[0]
    if not item or not item.lstrip("-").isdigit():
        return None
    return int(item)
