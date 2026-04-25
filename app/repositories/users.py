from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def upsert(
        self,
        telegram_id: int,
        *,
        username: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
    ) -> User:
        user = await self.get_by_telegram_id(telegram_id)
        now = datetime.now(UTC)
        if user is None:
            user = User(
                telegram_id=telegram_id,
                username=username,
                first_name=first_name,
                last_name=last_name,
                is_allowed=False,
                created_at=now,
                updated_at=now,
            )
            self.session.add(user)
        else:
            user.username = username
            user.first_name = first_name
            user.last_name = last_name
            user.updated_at = now
        await self.session.flush()
        return user

    async def get_by_telegram_id(self, telegram_id: int) -> User | None:
        return await self.session.scalar(select(User).where(User.telegram_id == telegram_id))

    async def is_allowed(self, telegram_id: int) -> bool:
        value = await self.session.scalar(
            select(User.is_allowed).where(User.telegram_id == telegram_id)
        )
        return bool(value)

    async def set_allowed(self, telegram_id: int, allowed: bool) -> User:
        user = await self.get_by_telegram_id(telegram_id)
        now = datetime.now(UTC)
        if user is None:
            user = User(
                telegram_id=telegram_id,
                is_allowed=allowed,
                created_at=now,
                updated_at=now,
            )
            self.session.add(user)
        else:
            user.is_allowed = allowed
            user.updated_at = now
        await self.session.flush()
        return user

    async def list_allowed(self, *, limit: int = 100) -> list[User]:
        result = await self.session.scalars(
            select(User)
            .where(User.is_allowed.is_(True))
            .order_by(User.created_at.desc())
            .limit(limit)
        )
        return list(result)

    async def count_allowed(self) -> int:
        return int(
            await self.session.scalar(select(func.count(User.id)).where(User.is_allowed.is_(True)))
            or 0
        )
