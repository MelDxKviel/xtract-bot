from __future__ import annotations

import re
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx

from app.providers.base import TweetData, TweetMedia, TweetProvider, TweetProviderError

SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result"
OEMBED_URL = "https://publish.twitter.com/oembed"
USER_AGENT = "xtract-bot/0.1 (+https://github.com/)"
TWITTER_DATE_FORMAT = "%a %b %d %H:%M:%S %z %Y"
WHITESPACE_RE = re.compile(r"[ \t\r\f\v]+")


class PublicEmbedTweetProvider(TweetProvider):
    """Fetch public tweet data from unauthenticated Twitter embed endpoints.

    This provider intentionally does not use accounts, cookies, browser automation,
    or private API tokens. It only reads data that Twitter exposes for public embeds.
    """

    def __init__(self, *, timeout: float = 10.0, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers={
                "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
                "User-Agent": USER_AGENT,
            },
        )
        self._owns_client = client is None

    async def get_tweet(self, tweet_id: str, source_url: str) -> TweetData:
        first_error: TweetProviderError | None = None
        try:
            return await self._get_from_syndication(tweet_id, source_url)
        except TweetProviderError as exc:
            first_error = exc
            if exc.code == "provider_rate_limited":
                raise

        try:
            return await self._get_from_oembed(tweet_id, source_url)
        except TweetProviderError as exc:
            if exc.code in {"not_found", "private_or_deleted", "provider_rate_limited"}:
                raise
            if first_error is not None:
                raise first_error from exc
            raise

    async def health(self) -> bool:
        try:
            response = await self._client.get(
                OEMBED_URL,
                params={
                    "url": "https://twitter.com/jack/status/20",
                    "omit_script": "1",
                    "dnt": "1",
                },
            )
            return response.status_code < 500
        except httpx.HTTPError:
            return False

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get_from_syndication(self, tweet_id: str, source_url: str) -> TweetData:
        payload = await self._get_json(
            SYNDICATION_URL,
            params={"id": tweet_id, "lang": "en"},
        )
        if _is_tombstone(payload):
            raise TweetProviderError("tweet is unavailable", code="private_or_deleted")
        return _tweet_from_syndication(payload, source_url, requested_tweet_id=tweet_id)

    async def _get_from_oembed(self, tweet_id: str, source_url: str) -> TweetData:
        payload = await self._get_json(
            OEMBED_URL,
            params={
                "url": _oembed_tweet_url(source_url),
                "omit_script": "1",
                "dnt": "1",
            },
        )
        html = str(payload.get("html") or "")
        if not html:
            raise TweetProviderError("embed response has no html", code="provider_bad_response")

        parser = _TweetEmbedParser()
        parser.feed(html)

        author_url = str(payload.get("author_url") or "")
        username = _username_from_url(author_url) or _username_from_url(source_url) or "unknown"
        author_url = _canonical_author_url(username)
        text = parser.tweet_text
        if not text:
            raise TweetProviderError(
                "embed response has no tweet text",
                code="provider_bad_response",
            )

        media = [
            TweetMedia(type="photo", url=url)
            for url in parser.image_urls
            if _looks_like_twitter_media(url)
        ]
        return TweetData(
            tweet_id=tweet_id,
            url=source_url,
            author_name=str(payload.get("author_name") or username),
            author_username=username,
            author_url=author_url,
            text=text,
            media=media,
            lang=parser.lang,
        )

    async def _get_json(self, url: str, *, params: dict[str, str]) -> dict[str, Any]:
        try:
            response = await self._client.get(url, params=params)
        except httpx.TimeoutException as exc:
            raise TweetProviderError(str(exc), code="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise TweetProviderError(str(exc), code="provider_http_error") from exc

        if response.status_code == 404:
            raise TweetProviderError("tweet not found", code="not_found")
        if response.status_code == 403:
            raise TweetProviderError("tweet is private or unavailable", code="private_or_deleted")
        if response.status_code == 429:
            raise TweetProviderError(
                "embed endpoint rate limit exceeded",
                code="provider_rate_limited",
            )
        if response.status_code >= 400:
            raise TweetProviderError(
                f"embed endpoint returned HTTP {response.status_code}",
                code="provider_http_error",
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise TweetProviderError(
                "embed endpoint returned invalid JSON",
                code="provider_bad_response",
            ) from exc
        if not isinstance(payload, dict):
            raise TweetProviderError(
                "embed endpoint returned non-object JSON",
                code="provider_bad_response",
            )
        return payload


class _TweetEmbedParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._blockquote_depth = 0
        self._paragraph_depth = 0
        self._paragraph_parts: list[str] = []
        self._blockquote_parts: list[str] = []
        self.image_urls: list[str] = []
        self.lang: str | None = None

    @property
    def tweet_text(self) -> str:
        text = _normalize_text("".join(self._paragraph_parts))
        if text:
            return text
        fallback = _normalize_text("".join(self._blockquote_parts))
        return fallback.split("—", 1)[0].strip()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        if tag == "blockquote":
            self._blockquote_depth += 1
        elif tag == "p" and self._blockquote_depth and self._paragraph_depth == 0:
            self._paragraph_depth = 1
            self.lang = attr_map.get("lang") or self.lang
        elif tag == "br" and self._paragraph_depth:
            self._paragraph_parts.append("\n")

        if tag == "img" and (src := attr_map.get("src")):
            self.image_urls.append(src)

    def handle_endtag(self, tag: str) -> None:
        if tag == "p" and self._paragraph_depth:
            self._paragraph_depth = 0
        elif tag == "blockquote" and self._blockquote_depth:
            self._blockquote_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._blockquote_depth:
            self._blockquote_parts.append(data)
        if self._paragraph_depth:
            self._paragraph_parts.append(data)


def _tweet_from_syndication(
    payload: dict[str, Any],
    source_url: str,
    *,
    requested_tweet_id: str,
    seen_ids: frozenset[str] = frozenset(),
) -> TweetData:
    if _is_tombstone(payload):
        raise TweetProviderError("tweet is unavailable", code="private_or_deleted")

    tweet_id = str(payload.get("id_str") or payload.get("id") or requested_tweet_id)
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    username = _username_from_user(user) or _username_from_url(source_url) or "unknown"
    author_name = str(user.get("name") or user.get("display_name") or username)

    quoted_tweet = None
    quoted_payload = payload.get("quoted_tweet") or payload.get("quotedTweet")
    if isinstance(quoted_payload, dict):
        quoted_id = str(quoted_payload.get("id_str") or quoted_payload.get("id") or "")
        if quoted_id and quoted_id not in seen_ids | {tweet_id}:
            quoted_tweet = _tweet_from_syndication(
                quoted_payload,
                _tweet_url_from_payload(quoted_payload, fallback=source_url),
                requested_tweet_id=quoted_id,
                seen_ids=seen_ids | {tweet_id},
            )

    return TweetData(
        tweet_id=tweet_id,
        url=source_url,
        author_name=author_name,
        author_username=username,
        author_url=_canonical_author_url(username),
        text=_text_from_syndication(payload),
        created_at=_parse_datetime(payload.get("created_at")),
        media=_media_from_syndication(payload),
        quoted_tweet=quoted_tweet,
        lang=payload.get("lang") if isinstance(payload.get("lang"), str) else None,
    )


def _text_from_syndication(payload: dict[str, Any]) -> str | None:
    value = payload.get("text") or payload.get("full_text") or payload.get("description")
    if not isinstance(value, str):
        return None
    return _normalize_text(unescape(value)) or None


def _media_from_syndication(payload: dict[str, Any]) -> list[TweetMedia]:
    media: list[TweetMedia] = []
    seen_urls: set[str] = set()

    def add(item: TweetMedia | None) -> None:
        if item is None or item.url in seen_urls:
            return
        seen_urls.add(item.url)
        media.append(item)

    photos = payload.get("photos")
    if isinstance(photos, list):
        for photo in photos:
            if isinstance(photo, dict):
                add(_photo_from_payload(photo))

    for details_key in ("mediaDetails", "media_details"):
        details = payload.get(details_key)
        if isinstance(details, list):
            for item in details:
                if isinstance(item, dict):
                    add(_media_from_detail(item))

    entities = payload.get("entities")
    entity_media = entities.get("media") if isinstance(entities, dict) else None
    if isinstance(entity_media, list):
        for item in entity_media:
            if isinstance(item, dict):
                add(_media_from_detail(item))

    video = payload.get("video")
    if isinstance(video, dict):
        add(_video_from_payload(video))

    return media


def _photo_from_payload(payload: dict[str, Any]) -> TweetMedia | None:
    url = _media_url(payload)
    if not url:
        return None
    return TweetMedia(
        type="photo",
        url=url,
        width=_int_or_none(payload.get("width")),
        height=_int_or_none(payload.get("height")),
    )


def _media_from_detail(payload: dict[str, Any]) -> TweetMedia | None:
    media_type = payload.get("type")
    if media_type == "photo":
        return _photo_from_payload(payload)
    if media_type not in {"video", "animated_gif"}:
        return None

    video_info = payload.get("video_info") if isinstance(payload.get("video_info"), dict) else {}
    url = _best_variant_url(video_info.get("variants"))
    preview_url = _media_url(payload)
    if not url:
        return None
    return TweetMedia(
        type="gif" if media_type == "animated_gif" else "video",
        url=url,
        preview_url=preview_url,
        width=_size_value(payload, "w") or _int_or_none(payload.get("width")),
        height=_size_value(payload, "h") or _int_or_none(payload.get("height")),
        duration_ms=_int_or_none(video_info.get("duration_millis")),
    )


def _video_from_payload(payload: dict[str, Any]) -> TweetMedia | None:
    url = _best_variant_url(payload.get("variants"))
    preview_url = str(
        payload.get("poster") or payload.get("thumbnail") or payload.get("preview_image_url") or ""
    )
    if not url:
        return None
    media_type = "gif" if payload.get("type") == "animated_gif" else "video"
    return TweetMedia(
        type=media_type,
        url=url,
        preview_url=preview_url or None,
        width=_int_or_none(payload.get("width")),
        height=_int_or_none(payload.get("height")),
        duration_ms=_int_or_none(payload.get("duration_ms") or payload.get("duration_millis")),
    )


def _best_variant_url(value: Any) -> str | None:
    if not isinstance(value, list):
        return None
    variants = [
        item
        for item in value
        if isinstance(item, dict)
        and item.get("url")
        and str(item.get("content_type") or "").lower() == "video/mp4"
    ]
    if not variants:
        return None
    variants.sort(key=lambda item: _int_or_none(item.get("bitrate") or item.get("bit_rate")) or 0)
    return str(variants[-1]["url"])


def _media_url(payload: dict[str, Any]) -> str | None:
    value = (
        payload.get("url")
        or payload.get("media_url_https")
        or payload.get("media_url")
        or payload.get("mediaUrl")
    )
    if not isinstance(value, str) or not value.startswith(("http://", "https://")):
        return None
    return value


def _tweet_url_from_payload(payload: dict[str, Any], *, fallback: str) -> str:
    tweet_id = str(payload.get("id_str") or payload.get("id") or "")
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    username = _username_from_user(user)
    if tweet_id and username:
        return f"https://x.com/{username}/status/{tweet_id}"
    return fallback


def _oembed_tweet_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.path:
        return url
    return f"https://twitter.com{parsed.path}"


def _username_from_user(user: dict[str, Any]) -> str | None:
    value = user.get("screen_name") or user.get("username")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip().lstrip("@")


def _username_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.netloc.lower().removeprefix("www.") not in {
        "x.com",
        "twitter.com",
        "mobile.twitter.com",
        "vxtwitter.com",
    }:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if not parts or parts[0] in {"i", "intent", "share"}:
        return None
    return parts[0].lstrip("@")


def _canonical_author_url(username: str) -> str:
    return f"https://x.com/{username.lstrip('@')}"


def _looks_like_twitter_media(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host.endswith("twimg.com") or host.endswith("twitter.com") or host.endswith("x.com")


def _normalize_text(value: str) -> str:
    value = value.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [WHITESPACE_RE.sub(" ", line).strip() for line in value.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            return datetime.strptime(value, TWITTER_DATE_FORMAT)
        except ValueError:
            return None


def _is_tombstone(payload: dict[str, Any]) -> bool:
    typename = str(payload.get("__typename") or "").lower()
    return bool(payload.get("tombstone") or "tombstone" in typename)


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _size_value(payload: dict[str, Any], key: str) -> int | None:
    sizes = payload.get("sizes")
    if not isinstance(sizes, dict):
        return None
    large = sizes.get("large") if isinstance(sizes.get("large"), dict) else None
    if not large:
        return None
    return _int_or_none(large.get(key))
