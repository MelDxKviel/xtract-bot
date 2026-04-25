from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

MediaType = Literal["photo", "video", "gif"]


class TweetProviderError(Exception):
    def __init__(self, message: str, *, code: str = "provider_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass(slots=True)
class TweetMedia:
    type: MediaType
    url: str
    preview_url: str | None = None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "url": self.url,
            "preview_url": self.preview_url,
            "width": self.width,
            "height": self.height,
            "duration_ms": self.duration_ms,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> TweetMedia:
        media_type = payload.get("type")
        if media_type not in {"photo", "video", "gif"}:
            raise ValueError(f"unsupported media type: {media_type}")
        return cls(
            type=media_type,
            url=str(payload["url"]),
            preview_url=payload.get("preview_url"),
            width=payload.get("width"),
            height=payload.get("height"),
            duration_ms=payload.get("duration_ms"),
        )


@dataclass(slots=True)
class TweetData:
    tweet_id: str
    url: str
    author_name: str
    author_username: str
    author_url: str
    text: str | None = None
    created_at: datetime | None = None
    media: list[TweetMedia] = field(default_factory=list)
    quoted_tweet: TweetData | None = None
    replied_to_tweet: TweetData | None = None
    lang: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "tweet_id": self.tweet_id,
            "url": self.url,
            "author_name": self.author_name,
            "author_username": self.author_username,
            "author_url": self.author_url,
            "text": self.text,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "media": [item.to_payload() for item in self.media],
            "quoted_tweet": self.quoted_tweet.to_payload() if self.quoted_tweet else None,
            "replied_to_tweet": self.replied_to_tweet.to_payload()
            if self.replied_to_tweet
            else None,
            "lang": self.lang,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> TweetData:
        return cls(
            tweet_id=str(payload["tweet_id"]),
            url=str(payload["url"]),
            author_name=str(payload["author_name"]),
            author_username=str(payload["author_username"]),
            author_url=str(payload["author_url"]),
            text=payload.get("text"),
            created_at=_parse_datetime(payload.get("created_at")),
            media=[TweetMedia.from_payload(item) for item in payload.get("media", [])],
            quoted_tweet=(
                cls.from_payload(payload["quoted_tweet"]) if payload.get("quoted_tweet") else None
            ),
            replied_to_tweet=(
                cls.from_payload(payload["replied_to_tweet"])
                if payload.get("replied_to_tweet")
                else None
            ),
            lang=payload.get("lang"),
        )


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        raise ValueError(f"invalid datetime value: {value!r}")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class TweetProvider(ABC):
    @abstractmethod
    async def get_tweet(self, tweet_id: str, source_url: str) -> TweetData:
        raise NotImplementedError

    async def health(self) -> bool:
        return True

    async def close(self) -> None:
        return None
