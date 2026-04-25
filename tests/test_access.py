import asyncio
from types import SimpleNamespace

from app.services.access import AccessService


class FakeUsers:
    def __init__(self) -> None:
        self.allowed: set[int] = set()
        self.saved: list[int] = []

    async def upsert(self, telegram_id: int, **_: object) -> None:
        self.saved.append(telegram_id)

    async def is_allowed(self, telegram_id: int) -> bool:
        return telegram_id in self.allowed

    async def set_allowed(self, telegram_id: int, allowed: bool) -> None:
        if allowed:
            self.allowed.add(telegram_id)
        else:
            self.allowed.discard(telegram_id)

    async def list_allowed(self, *, limit: int = 100) -> list[int]:
        return list(self.allowed)[:limit]


def test_admin_always_has_access() -> None:
    async def run() -> None:
        service = AccessService(FakeUsers(), frozenset({1}))
        assert await service.has_access(1) is True

    asyncio.run(run())


def test_allow_and_deny_user() -> None:
    async def run() -> None:
        users = FakeUsers()
        service = AccessService(users, frozenset())
        assert await service.has_access(2) is False
        await service.allow_user(2)
        assert await service.has_access(2) is True
        await service.deny_user(2)
        assert await service.has_access(2) is False

    asyncio.run(run())


def test_disabled_whitelist_allows_regular_user() -> None:
    async def run() -> None:
        service = AccessService(FakeUsers(), frozenset(), whitelist_enabled=False)
        assert await service.has_access(2) is True

    asyncio.run(run())


def test_enabled_whitelist_denies_regular_user_by_default() -> None:
    async def run() -> None:
        service = AccessService(FakeUsers(), frozenset(), whitelist_enabled=True)
        assert await service.has_access(2) is False

    asyncio.run(run())


def test_register_user_delegates_to_repository() -> None:
    async def run() -> None:
        users = FakeUsers()
        service = AccessService(users, frozenset())
        await service.register_user(
            SimpleNamespace(id=42, username="u", first_name="F", last_name="L")
        )
        assert users.saved == [42]

    asyncio.run(run())
