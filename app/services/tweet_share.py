from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Literal

from app.formatters.telegram import TelegramPost, format_tweet
from app.providers.base import TweetData, TweetProvider, TweetProviderError
from app.utils.urls import ParsedTweetUrl, extract_first_tweet_url

ShareMode = Literal["private", "inline"]
ShareStatus = Literal["success", "error", "invalid_url"]

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ShareResult:
    status: ShareStatus
    tweet_id: str | None = None
    source_url: str | None = None
    normalized_url: str | None = None
    tweet: TweetData | None = None
    post: TelegramPost | None = None
    error_code: str | None = None
    elapsed_ms: int | None = None
    cache_hit: bool = False

    @property
    def ok(self) -> bool:
        return self.status == "success"


class TweetShareService:
    def __init__(
        self,
        *,
        provider: TweetProvider,
        cache_repository: Any,
        share_events_repository: Any,
        cache_ttl_seconds: int,
    ) -> None:
        self._provider = provider
        self._cache = cache_repository
        self._share_events = share_events_repository
        self._cache_ttl_seconds = cache_ttl_seconds

    async def process_text(
        self,
        text: str,
        *,
        telegram_user_id: int,
        chat_id: int | None,
        mode: ShareMode,
    ) -> ShareResult:
        parsed = extract_first_tweet_url(text)
        if not parsed:
            return ShareResult(status="invalid_url", error_code="invalid_url")
        return await self.process_url(
            parsed,
            telegram_user_id=telegram_user_id,
            chat_id=chat_id,
            mode=mode,
        )

    async def process_url(
        self,
        parsed: ParsedTweetUrl,
        *,
        telegram_user_id: int,
        chat_id: int | None,
        mode: ShareMode,
    ) -> ShareResult:
        started = time.perf_counter()
        cache_hit = False
        try:
            tweet = await self._cache.get(parsed.tweet_id)
            if tweet is None:
                tweet = await self._provider.get_tweet(parsed.tweet_id, parsed.normalized_url)
                await self._cache.set(
                    tweet,
                    parsed.source_url,
                    ttl_seconds=self._cache_ttl_seconds,
                )
            else:
                cache_hit = True

            post = format_tweet(tweet)
            elapsed_ms = _elapsed_ms(started)
            await self._share_events.create(
                telegram_user_id=telegram_user_id,
                chat_id=chat_id,
                tweet_id=parsed.tweet_id,
                source_url=parsed.source_url,
                mode=mode,
                status="success",
            )
            logger.info(
                "tweet_share status=success telegram_user_id=%s chat_id=%s "
                "tweet_id=%s mode=%s cache_hit=%s elapsed_ms=%s",
                telegram_user_id,
                chat_id,
                parsed.tweet_id,
                mode,
                cache_hit,
                elapsed_ms,
            )
            return ShareResult(
                status="success",
                tweet_id=parsed.tweet_id,
                source_url=parsed.source_url,
                normalized_url=parsed.normalized_url,
                tweet=tweet,
                post=post,
                elapsed_ms=elapsed_ms,
                cache_hit=cache_hit,
            )
        except TweetProviderError as exc:
            return await self._record_error(
                parsed,
                telegram_user_id=telegram_user_id,
                chat_id=chat_id,
                mode=mode,
                code=exc.code,
                started=started,
            )
        except Exception:
            logger.exception(
                "tweet_share status=error telegram_user_id=%s chat_id=%s "
                "tweet_id=%s mode=%s error_code=unexpected_error",
                telegram_user_id,
                chat_id,
                parsed.tweet_id,
                mode,
            )
            return await self._record_error(
                parsed,
                telegram_user_id=telegram_user_id,
                chat_id=chat_id,
                mode=mode,
                code="unexpected_error",
                started=started,
            )

    async def _record_error(
        self,
        parsed: ParsedTweetUrl,
        *,
        telegram_user_id: int,
        chat_id: int | None,
        mode: ShareMode,
        code: str,
        started: float,
    ) -> ShareResult:
        elapsed_ms = _elapsed_ms(started)
        await self._share_events.create(
            telegram_user_id=telegram_user_id,
            chat_id=chat_id,
            tweet_id=parsed.tweet_id,
            source_url=parsed.source_url,
            mode=mode,
            status="error",
            error_code=code,
        )
        logger.info(
            "tweet_share status=error telegram_user_id=%s chat_id=%s "
            "tweet_id=%s mode=%s error_code=%s elapsed_ms=%s",
            telegram_user_id,
            chat_id,
            parsed.tweet_id,
            mode,
            code,
            elapsed_ms,
        )
        return ShareResult(
            status="error",
            tweet_id=parsed.tweet_id,
            source_url=parsed.source_url,
            normalized_url=parsed.normalized_url,
            error_code=code,
            elapsed_ms=elapsed_ms,
        )


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
