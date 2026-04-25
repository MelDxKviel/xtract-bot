from __future__ import annotations

from typing import Any


class AccessService:
    def __init__(
        self,
        user_repository: Any,
        admin_ids: frozenset[int],
        *,
        whitelist_enabled: bool = True,
    ) -> None:
        self._users = user_repository
        self._admin_ids = admin_ids
        self._whitelist_enabled = whitelist_enabled

    def is_admin(self, telegram_id: int) -> bool:
        return telegram_id in self._admin_ids

    async def register_user(self, telegram_user: Any) -> None:
        await self._users.upsert(
            telegram_user.id,
            username=getattr(telegram_user, "username", None),
            first_name=getattr(telegram_user, "first_name", None),
            last_name=getattr(telegram_user, "last_name", None),
        )

    async def has_access(self, telegram_id: int) -> bool:
        if self.is_admin(telegram_id):
            return True
        if not self._whitelist_enabled:
            return True
        return await self._users.is_allowed(telegram_id)

    async def allow_user(self, telegram_id: int) -> None:
        await self._users.set_allowed(telegram_id, True)

    async def deny_user(self, telegram_id: int) -> None:
        await self._users.set_allowed(telegram_id, False)

    async def list_allowed_users(self, *, limit: int = 100) -> list[Any]:
        return await self._users.list_allowed(limit=limit)
