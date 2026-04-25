from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.providers.base import TweetData, TweetMedia, TweetProvider, TweetProviderError


class XApiTweetProvider(TweetProvider):
    def __init__(self, bearer_token: str, *, timeout: float = 10.0) -> None:
        self._client = httpx.AsyncClient(
            base_url="https://api.twitter.com/2",
            timeout=timeout,
            headers={"Authorization": f"Bearer {bearer_token}"},
        )

    async def get_tweet(self, tweet_id: str, source_url: str) -> TweetData:
        params = {
            "tweet.fields": "attachments,author_id,created_at,lang,referenced_tweets",
            "expansions": (
                "author_id,attachments.media_keys,"
                "referenced_tweets.id,referenced_tweets.id.author_id"
            ),
            "user.fields": "name,username,url",
            "media.fields": "duration_ms,height,preview_image_url,type,url,variants,width",
        }
        try:
            response = await self._client.get(f"/tweets/{tweet_id}", params=params)
            if response.status_code == 404:
                raise TweetProviderError("tweet not found", code="not_found")
            if response.status_code == 401:
                raise TweetProviderError("X API authentication failed", code="provider_auth")
            if response.status_code == 429:
                raise TweetProviderError("X API rate limit exceeded", code="provider_rate_limited")
            response.raise_for_status()
        except TweetProviderError:
            raise
        except httpx.HTTPError as exc:
            raise TweetProviderError(str(exc), code="provider_http_error") from exc

        payload = response.json()
        if "data" not in payload:
            raise TweetProviderError("X API returned empty response", code="not_found")
        return self._parse_response(payload, source_url)

    async def health(self) -> bool:
        return True

    async def close(self) -> None:
        await self._client.aclose()

    def _parse_response(self, payload: dict[str, Any], source_url: str) -> TweetData:
        includes = payload.get("includes", {})
        users_by_id = {item["id"]: item for item in includes.get("users", [])}
        tweets_by_id = {item["id"]: item for item in includes.get("tweets", [])}
        media_by_key = {item["media_key"]: item for item in includes.get("media", [])}

        def build(tweet: dict[str, Any], seen: set[str]) -> TweetData:
            current_id = str(tweet["id"])
            seen.add(current_id)
            user = users_by_id.get(tweet.get("author_id"), {})
            username = user.get("username") or "unknown"
            author_url = f"https://x.com/{username}"
            media = [
                parsed
                for media_key in tweet.get("attachments", {}).get("media_keys", [])
                if (parsed := self._parse_media(media_by_key.get(media_key))) is not None
            ]

            quoted_tweet = None
            replied_to_tweet = None
            for ref in tweet.get("referenced_tweets", []) or []:
                ref_id = str(ref.get("id"))
                if ref_id in seen or ref_id not in tweets_by_id:
                    continue
                if ref.get("type") == "quoted" and quoted_tweet is None:
                    quoted_tweet = build(tweets_by_id[ref_id], seen.copy())
                if ref.get("type") == "replied_to" and replied_to_tweet is None:
                    replied_to_tweet = build(tweets_by_id[ref_id], seen.copy())

            return TweetData(
                tweet_id=current_id,
                url=source_url
                if current_id == str(payload["data"]["id"])
                else f"{author_url}/status/{current_id}",
                author_name=user.get("name") or username,
                author_username=username,
                author_url=author_url,
                text=tweet.get("text"),
                created_at=self._parse_datetime(tweet.get("created_at")),
                media=media,
                quoted_tweet=quoted_tweet,
                replied_to_tweet=replied_to_tweet,
                lang=tweet.get("lang"),
            )

        return build(payload["data"], set())

    def _parse_media(self, payload: dict[str, Any] | None) -> TweetMedia | None:
        if not payload:
            return None

        media_type = payload.get("type")
        if media_type == "photo":
            url = payload.get("url") or payload.get("preview_image_url")
            return (
                TweetMedia(
                    type="photo",
                    url=url,
                    width=payload.get("width"),
                    height=payload.get("height"),
                )
                if url
                else None
            )
        if media_type in {"video", "animated_gif"}:
            url = self._best_variant_url(payload) or payload.get("preview_image_url")
            return (
                TweetMedia(
                    type="gif" if media_type == "animated_gif" else "video",
                    url=url,
                    preview_url=payload.get("preview_image_url"),
                    width=payload.get("width"),
                    height=payload.get("height"),
                    duration_ms=payload.get("duration_ms"),
                )
                if url
                else None
            )
        return None

    @staticmethod
    def _best_variant_url(payload: dict[str, Any]) -> str | None:
        variants = [
            item
            for item in payload.get("variants", [])
            if item.get("content_type") == "video/mp4" and item.get("url")
        ]
        if not variants:
            return None
        variants.sort(key=lambda item: item.get("bit_rate") or 0, reverse=True)
        return variants[0]["url"]

    @staticmethod
    def _parse_datetime(value: str | None) -> datetime | None:
        if not value:
            return None
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
