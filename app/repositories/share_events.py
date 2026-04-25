from sqlalchemy import desc, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ShareEvent


class ShareEventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        telegram_user_id: int,
        chat_id: int | None,
        tweet_id: str | None,
        source_url: str,
        mode: str,
        status: str,
        error_code: str | None = None,
    ) -> ShareEvent:
        event = ShareEvent(
            telegram_user_id=telegram_user_id,
            chat_id=chat_id,
            tweet_id=tweet_id,
            source_url=source_url,
            mode=mode,
            status=status,
            error_code=error_code,
        )
        self.session.add(event)
        await self.session.flush()
        return event

    async def summary(self, *, telegram_user_id: int | None = None) -> dict[str, int]:
        stmt = select(
            func.count(ShareEvent.id),
            func.count(ShareEvent.id).filter(ShareEvent.status == "success"),
            func.count(ShareEvent.id).filter(ShareEvent.status == "error"),
            func.count(ShareEvent.id).filter(ShareEvent.mode == "private"),
            func.count(ShareEvent.id).filter(ShareEvent.mode == "inline"),
            func.count(distinct(ShareEvent.telegram_user_id)),
        )
        if telegram_user_id is not None:
            stmt = stmt.where(ShareEvent.telegram_user_id == telegram_user_id)
        row = (await self.session.execute(stmt)).one()
        return {
            "total": int(row[0] or 0),
            "success": int(row[1] or 0),
            "errors": int(row[2] or 0),
            "private": int(row[3] or 0),
            "inline": int(row[4] or 0),
            "users": int(row[5] or 0),
        }

    async def top_users(self, *, limit: int = 5) -> list[tuple[int, int]]:
        shares = func.count(ShareEvent.id).label("shares")
        result = await self.session.execute(
            select(ShareEvent.telegram_user_id, shares)
            .where(ShareEvent.status == "success")
            .group_by(ShareEvent.telegram_user_id)
            .order_by(desc(shares))
            .limit(limit)
        )
        return [(int(user_id), int(count)) for user_id, count in result]

    async def top_tweets(self, *, limit: int = 5) -> list[tuple[str, int]]:
        shares = func.count(ShareEvent.id).label("shares")
        result = await self.session.execute(
            select(ShareEvent.tweet_id, shares)
            .where(ShareEvent.status == "success", ShareEvent.tweet_id.is_not(None))
            .group_by(ShareEvent.tweet_id)
            .order_by(desc(shares))
            .limit(limit)
        )
        return [(str(tweet_id), int(count)) for tweet_id, count in result]
