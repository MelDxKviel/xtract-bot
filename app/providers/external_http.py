from __future__ import annotations

import httpx

from app.providers.base import TweetData, TweetProvider, TweetProviderError


class ExternalHttpTweetProvider(TweetProvider):
    def __init__(self, base_url: str, *, api_key: str | None = None, timeout: float = 10.0) -> None:
        self._api_key = api_key
        self._client = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)

    async def get_tweet(self, tweet_id: str, source_url: str) -> TweetData:
        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        try:
            response = await self._client.get(
                f"/tweets/{tweet_id}",
                params={"url": source_url},
                headers=headers,
            )
            if response.status_code == 404:
                raise TweetProviderError("tweet not found", code="not_found")
            if response.status_code == 401:
                raise TweetProviderError("provider authentication failed", code="provider_auth")
            if response.status_code == 429:
                raise TweetProviderError(
                    "provider rate limit exceeded", code="provider_rate_limited"
                )
            response.raise_for_status()
        except TweetProviderError:
            raise
        except httpx.HTTPError as exc:
            raise TweetProviderError(str(exc), code="provider_http_error") from exc

        payload = response.json()
        return TweetData.from_payload(payload.get("tweet", payload))

    async def health(self) -> bool:
        try:
            response = await self._client.get("/health")
            return response.status_code < 500
        except httpx.HTTPError:
            return False

    async def close(self) -> None:
        await self._client.aclose()
