from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AdminAction


class AdminActionsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        admin_telegram_id: int,
        action: str,
        target_telegram_id: int | None = None,
    ) -> AdminAction:
        item = AdminAction(
            admin_telegram_id=admin_telegram_id,
            action=action,
            target_telegram_id=target_telegram_id,
        )
        self.session.add(item)
        await self.session.flush()
        return item
