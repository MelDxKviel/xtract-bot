from datetime import UTC, datetime

from app.providers.base import TweetData, TweetProvider


class FakeTweetProvider(TweetProvider):
    async def get_tweet(self, tweet_id: str, source_url: str) -> TweetData:
        return TweetData(
            tweet_id=tweet_id,
            url=source_url,
            author_name="Xtract Demo",
            author_username="xtract_demo",
            author_url="https://x.com/xtract_demo",
            text=f"Demo tweet {tweet_id}. Replace TWEET_PROVIDER to fetch real X/Twitter posts.",
            created_at=datetime.now(UTC),
            media=[],
            lang="en",
        )
