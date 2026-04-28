from __future__ import annotations

import re
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx

from app.providers.base import TweetData, TweetMedia, TweetProvider, TweetProviderError

SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result"
OEMBED_URL = "https://publish.twitter.com/oembed"
FXTWITTER_URL = "https://api.fxtwitter.com/status/{tweet_id}"
VXTWITTER_URL = "https://api.vxtwitter.com/Twitter/status/{tweet_id}"
USER_AGENT = "xtract-bot/0.1 (+https://github.com/)"
TWITTER_DATE_FORMAT = "%a %b %d %H:%M:%S %z %Y"
WHITESPACE_RE = re.compile(r"[ \t\r\f\v]+")


class PublicEmbedTweetProvider(TweetProvider):
    """Fetch public tweet data from unauthenticated public endpoints.

    This provider intentionally does not use accounts, cookies, browser automation,
    or private API tokens. It only reads data exposed for public cards/embeds.
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
        errors: list[TweetProviderError] = []
        for getter in (
            self._get_from_fxtwitter,
            self._get_from_vxtwitter,
            self._get_from_syndication,
            self._get_from_oembed,
        ):
            try:
                tweet = await getter(tweet_id, source_url)
                _ensure_usable_tweet(tweet)
                return tweet
            except TweetProviderError as exc:
                errors.append(exc)

        raise _select_provider_error(errors)

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

    async def _get_from_fxtwitter(self, tweet_id: str, source_url: str) -> TweetData:
        return await self._fetch_public_api_tweet(FXTWITTER_URL, tweet_id, source_url)

    async def _get_from_vxtwitter(self, tweet_id: str, source_url: str) -> TweetData:
        return await self._fetch_public_api_tweet(VXTWITTER_URL, tweet_id, source_url)

    async def _get_from_syndication(self, tweet_id: str, source_url: str) -> TweetData:
        payload = await self._get_json(
            SYNDICATION_URL,
            params={"id": tweet_id, "lang": "en"},
        )
        if _is_tombstone(payload):
            raise TweetProviderError("tweet is unavailable", code="private_or_deleted")
        tweet = _tweet_from_syndication(payload, source_url, requested_tweet_id=tweet_id)
        replied_to_id = _first_str(payload, "in_reply_to_status_id_str", "in_reply_to_status_id")
        if replied_to_id and replied_to_id != tweet_id:
            try:
                parent_payload = await self._get_json(
                    SYNDICATION_URL,
                    params={"id": replied_to_id, "lang": "en"},
                )
                if not _is_tombstone(parent_payload):
                    tweet.replied_to_tweet = _tweet_from_syndication(
                        parent_payload,
                        f"https://x.com/i/status/{replied_to_id}",
                        requested_tweet_id=replied_to_id,
                    )
            except TweetProviderError:
                pass
        return tweet

    async def _fetch_public_api_tweet(
        self, url_template: str, tweet_id: str, source_url: str
    ) -> TweetData:
        payload = await self._get_json(url_template.format(tweet_id=tweet_id))
        tweet = _tweet_from_public_api(payload, source_url, requested_tweet_id=tweet_id)
        data = payload.get("tweet") if isinstance(payload.get("tweet"), dict) else payload
        replied_to_id = _replied_to_id_from_public_api(data)
        if replied_to_id and replied_to_id != tweet_id:
            try:
                parent_payload = await self._get_json(url_template.format(tweet_id=replied_to_id))
                tweet.replied_to_tweet = _tweet_from_public_api(
                    parent_payload,
                    f"https://x.com/i/status/{replied_to_id}",
                    requested_tweet_id=replied_to_id,
                )
            except TweetProviderError:
                pass
        return tweet

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
        tweet_url = _canonicalize_tweet_url(str(payload.get("url") or source_url))
        return TweetData(
            tweet_id=tweet_id,
            url=tweet_url,
            author_name=str(payload.get("author_name") or username),
            author_username=username,
            author_url=author_url,
            text=text,
            media=media,
            lang=parser.lang,
        )

    async def _get_json(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
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


def _tweet_from_public_api(
    payload: dict[str, Any],
    source_url: str,
    *,
    requested_tweet_id: str,
    seen_ids: frozenset[str] = frozenset(),
) -> TweetData:
    _raise_for_public_api_error(payload)
    data = payload.get("tweet") if isinstance(payload.get("tweet"), dict) else payload
    if not isinstance(data, dict):
        raise TweetProviderError(
            "public API returned no tweet object",
            code="provider_bad_response",
        )

    tweet_id = _first_str(data, "id", "tweetID", "id_str", "conversationID") or requested_tweet_id
    username = _public_api_username(data)
    author_name = _public_api_author_name(data, username=username)
    tweet_url = _public_api_tweet_url(
        data,
        username=username,
        tweet_id=tweet_id,
        fallback=source_url,
    )

    quoted_tweet = None
    quoted_payload = _first_dict(
        data,
        "qrt",
        "quote",
        "quoted",
        "quoted_tweet",
        "quotedTweet",
        "quoted_status",
        "quotedStatus",
    )
    if isinstance(quoted_payload, dict):
        quoted_id = _first_str(quoted_payload, "id", "tweetID", "id_str", "conversationID")
        if quoted_id and quoted_id not in seen_ids | {tweet_id}:
            quoted_tweet = _tweet_from_public_api(
                quoted_payload,
                _public_api_tweet_url(
                    quoted_payload,
                    username=_public_api_username(quoted_payload),
                    tweet_id=quoted_id,
                    fallback=tweet_url,
                ),
                requested_tweet_id=quoted_id,
                seen_ids=seen_ids | {tweet_id},
            )

    return TweetData(
        tweet_id=tweet_id,
        url=tweet_url,
        author_name=author_name,
        author_username=username,
        author_url=_public_api_author_url(data, username=username),
        text=_public_api_text(data),
        created_at=_public_api_datetime(data),
        media=_media_from_public_api(data),
        quoted_tweet=quoted_tweet,
        lang=data.get("lang") if isinstance(data.get("lang"), str) else None,
    )


def _raise_for_public_api_error(payload: dict[str, Any]) -> None:
    code = payload.get("code")
    if code in (None, 200, "200"):
        return

    message = str(payload.get("message") or payload.get("error") or "public API error")
    if code in (403, "403"):
        raise TweetProviderError(message, code="private_or_deleted")
    if code in (404, "404"):
        raise TweetProviderError(message, code="not_found")
    if code in (429, "429"):
        raise TweetProviderError(message, code="provider_rate_limited")
    raise TweetProviderError(message, code="provider_http_error")


def _public_api_text(data: dict[str, Any]) -> str | None:
    value = data.get("text")
    if not isinstance(value, str):
        raw_text = data.get("raw_text")
        value = raw_text.get("text") if isinstance(raw_text, dict) else None
    if not isinstance(value, str):
        return None
    return _normalize_text(unescape(value)) or None


def _public_api_username(data: dict[str, Any]) -> str:
    author = data.get("author") if isinstance(data.get("author"), dict) else {}
    value = (
        author.get("screen_name")
        or author.get("username")
        or data.get("user_screen_name")
        or _username_from_url(str(data.get("url") or data.get("tweetURL") or ""))
    )
    if isinstance(value, str) and value.strip():
        return value.strip().lstrip("@")
    return "unknown"


def _public_api_author_name(data: dict[str, Any], *, username: str) -> str:
    author = data.get("author") if isinstance(data.get("author"), dict) else {}
    value = author.get("name") or data.get("user_name") or username
    return str(value or username)


def _public_api_author_url(data: dict[str, Any], *, username: str) -> str:
    author = data.get("author") if isinstance(data.get("author"), dict) else {}
    value = author.get("url")
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return _canonicalize_author_url(value)
    return _canonical_author_url(username)


def _public_api_tweet_url(
    data: dict[str, Any],
    *,
    username: str,
    tweet_id: str,
    fallback: str,
) -> str:
    if username != "unknown" and tweet_id:
        return _canonical_tweet_url(username, tweet_id, fallback=fallback)
    value = data.get("url") or data.get("tweetURL")
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return _canonicalize_tweet_url(value)
    return _canonicalize_tweet_url(fallback)


def _public_api_datetime(data: dict[str, Any]) -> datetime | None:
    value = data.get("created_at") or data.get("date")
    parsed = _parse_datetime(value)
    if parsed is not None:
        return parsed
    timestamp = _int_or_none(data.get("created_timestamp") or data.get("date_epoch"))
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=UTC)


def _media_from_public_api(data: dict[str, Any]) -> list[TweetMedia]:
    media: list[TweetMedia] = []
    seen_urls: set[str] = set()

    def add(item: TweetMedia | None) -> None:
        if item is None or item.url in seen_urls:
            return
        seen_urls.add(item.url)
        media.append(item)

    media_payload = data.get("media") if isinstance(data.get("media"), dict) else {}
    all_media = media_payload.get("all") if isinstance(media_payload, dict) else None
    if isinstance(all_media, list):
        for item in all_media:
            if isinstance(item, dict):
                add(_media_from_public_item(item))
    else:
        for key in ("photos", "videos", "gifs"):
            items = media_payload.get(key) if isinstance(media_payload, dict) else None
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        add(_media_from_public_item(item))

    media_extended = data.get("media_extended")
    if isinstance(media_extended, list):
        for item in media_extended:
            if isinstance(item, dict):
                add(_media_from_public_item(item))

    media_urls = data.get("mediaURLs")
    if isinstance(media_urls, list):
        for url in media_urls:
            if isinstance(url, str):
                add(TweetMedia(type="photo", url=url))

    return media


def _media_from_public_item(item: dict[str, Any]) -> TweetMedia | None:
    media_type = str(item.get("type") or "").lower()
    url = _media_url(item) or _first_str(item, "video_url", "download_url")
    if not url:
        return None

    if media_type in {"photo", "image"}:
        normalized_type = "photo"
    elif media_type in {"gif", "animated_gif"}:
        normalized_type = "gif"
    elif media_type == "video":
        normalized_type = "video"
    elif _looks_like_twitter_media(url):
        normalized_type = "photo"
    else:
        return None

    return TweetMedia(
        type=normalized_type,
        url=url,
        preview_url=_first_str(item, "thumbnail_url", "preview_url", "poster"),
        width=_int_or_none(item.get("width")) or _nested_int(item, "size", "width"),
        height=_int_or_none(item.get("height")) or _nested_int(item, "size", "height"),
        duration_ms=_int_or_none(item.get("duration_ms") or item.get("duration_millis")),
    )


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
    quoted_payload = _first_dict(
        payload,
        "quoted_tweet",
        "quotedTweet",
        "quoted_status",
        "quotedStatus",
        "quote",
        "quoted",
        "qrt",
    )
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
        url=_canonical_tweet_url(username, tweet_id, fallback=source_url),
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


def _ensure_usable_tweet(tweet: TweetData) -> None:
    has_content = bool(tweet.text or tweet.media or tweet.quoted_tweet or tweet.replied_to_tweet)
    if not has_content:
        raise TweetProviderError(
            "provider returned tweet without content",
            code="provider_bad_response",
        )
    if tweet.author_username == "unknown":
        raise TweetProviderError(
            "provider returned tweet without author",
            code="provider_bad_response",
        )


def _select_provider_error(errors: list[TweetProviderError]) -> TweetProviderError:
    if not errors:
        return TweetProviderError("tweet provider failed", code="provider_error")
    for code in ("not_found", "private_or_deleted", "provider_rate_limited"):
        if any(error.code == code for error in errors):
            return next(error for error in reversed(errors) if error.code == code)
    return errors[-1]


def _canonical_tweet_url(username: str, tweet_id: str, *, fallback: str) -> str:
    if username and username != "unknown" and tweet_id:
        return f"https://x.com/{username.lstrip('@')}/status/{tweet_id}"
    return _canonicalize_tweet_url(fallback)


def _canonicalize_tweet_url(url: str) -> str:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    for index, part in enumerate(parts):
        if part not in {"status", "statuses"} or index + 1 >= len(parts):
            continue
        tweet_id = parts[index + 1]
        username = parts[index - 1] if index > 0 else ""
        if username and username not in {"i", "intent", "share"}:
            return f"https://x.com/{username}/status/{tweet_id}"
    return url


def _canonicalize_author_url(url: str) -> str:
    username = _username_from_url(url)
    return _canonical_author_url(username) if username else url


def _first_str(payload: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, int):
            return str(value)
    return None


def _replied_to_id_from_public_api(data: dict[str, Any]) -> str | None:
    # FxTwitter: { "replying_to": { "status": "<id>", "screen_name": "..." } }
    replying_to = data.get("replying_to")
    if isinstance(replying_to, dict):
        value = _first_str(replying_to, "status")
        if value:
            return value
    # VxTwitter: { "replyingToID": "<id>" }
    return _first_str(data, "replyingToID")


def _first_dict(payload: dict[str, Any], *keys: str) -> dict[str, Any] | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            nested = value.get("tweet") if isinstance(value.get("tweet"), dict) else None
            return nested or value
    return None


def _nested_int(payload: dict[str, Any], object_key: str, value_key: str) -> int | None:
    nested = payload.get(object_key)
    if not isinstance(nested, dict):
        return None
    return _int_or_none(nested.get(value_key))


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
    return (
        host == "twimg.com"
        or host.endswith(".twimg.com")
        or host == "twitter.com"
        or host.endswith(".twitter.com")
        or host == "x.com"
        or host.endswith(".x.com")
    )


def _normalize_text(value: str) -> str:
    value = value.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [WHITESPACE_RE.sub(" ", line).strip() for line in value.split("\n")]
    return "\n".join(lines).strip()


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
