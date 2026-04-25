from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TweetCache
from app.providers.base import TweetData


class TweetCacheRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, tweet_id: str) -> TweetData | None:
        row = await self.session.scalar(select(TweetCache).where(TweetCache.tweet_id == tweet_id))
        if row is None:
            return None
        if row.expires_at and row.expires_at <= datetime.now(UTC):
            return None
        return TweetData.from_payload(row.payload)

    async def set(self, tweet: TweetData, source_url: str, *, ttl_seconds: int) -> None:
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=ttl_seconds) if ttl_seconds > 0 else None
        row = await self.session.scalar(
            select(TweetCache).where(TweetCache.tweet_id == tweet.tweet_id)
        )
        if row is None:
            self.session.add(
                TweetCache(
                    tweet_id=tweet.tweet_id,
                    source_url=source_url,
                    payload=tweet.to_payload(),
                    expires_at=expires_at,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            row.source_url = source_url
            row.payload = tweet.to_payload()
            row.expires_at = expires_at
            row.updated_at = now
        await self.session.flush()
