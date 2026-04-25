import asyncio

from app.providers.base import TweetData, TweetProviderError
from app.services.tweet_share import TweetShareService


class FakeCache:
    def __init__(self, tweet: TweetData | None = None) -> None:
        self.tweet = tweet
        self.set_calls = 0

    async def get(self, tweet_id: str) -> TweetData | None:
        return self.tweet if self.tweet and self.tweet.tweet_id == tweet_id else None

    async def set(self, tweet: TweetData, source_url: str, *, ttl_seconds: int) -> None:
        self.tweet = tweet
        self.set_calls += 1


class FakeEvents:
    def __init__(self) -> None:
        self.items: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> None:
        self.items.append(kwargs)


class FakeProvider:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    async def get_tweet(self, tweet_id: str, source_url: str) -> TweetData:
        self.calls += 1
        if self.fail:
            raise TweetProviderError("failed", code="not_found")
        return make_tweet(tweet_id=tweet_id, url=source_url)


def make_tweet(tweet_id: str = "123", url: str = "https://x.com/user/status/123") -> TweetData:
    return TweetData(
        tweet_id=tweet_id,
        url=url,
        author_name="User",
        author_username="user",
        author_url="https://x.com/user",
        text="text",
    )


def test_process_text_fetches_provider_and_records_success() -> None:
    async def run() -> None:
        provider = FakeProvider()
        events = FakeEvents()
        service = TweetShareService(
            provider=provider,
            cache_repository=FakeCache(),
            share_events_repository=events,
            cache_ttl_seconds=60,
        )

        result = await service.process_text(
            "https://x.com/user/status/123",
            telegram_user_id=1,
            chat_id=10,
            mode="private",
        )

        assert result.ok is True
        assert provider.calls == 1
        assert events.items[0]["status"] == "success"

    asyncio.run(run())


def test_process_text_uses_cache() -> None:
    async def run() -> None:
        provider = FakeProvider()
        events = FakeEvents()
        service = TweetShareService(
            provider=provider,
            cache_repository=FakeCache(make_tweet()),
            share_events_repository=events,
            cache_ttl_seconds=60,
        )

        result = await service.process_text(
            "https://x.com/user/status/123",
            telegram_user_id=1,
            chat_id=10,
            mode="private",
        )

        assert result.ok is True
        assert result.cache_hit is True
        assert provider.calls == 0

    asyncio.run(run())


def test_process_text_records_provider_error() -> None:
    async def run() -> None:
        events = FakeEvents()
        service = TweetShareService(
            provider=FakeProvider(fail=True),
            cache_repository=FakeCache(),
            share_events_repository=events,
            cache_ttl_seconds=60,
        )

        result = await service.process_text(
            "https://x.com/user/status/123",
            telegram_user_id=1,
            chat_id=10,
            mode="private",
        )

        assert result.ok is False
        assert result.error_code == "not_found"
        assert events.items[0]["status"] == "error"

    asyncio.run(run())
