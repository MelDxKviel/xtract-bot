from __future__ import annotations

from dataclasses import dataclass
from html import escape

from app.providers.base import TweetData, TweetMedia

MESSAGE_LIMIT = 4096
CAPTION_LIMIT = 1024
MAX_MEDIA = 10


@dataclass(frozen=True, slots=True)
class TelegramPost:
    html: str
    caption_html: str
    media: tuple[TweetMedia, ...]
    extra_media_count: int = 0


def format_tweet(tweet: TweetData) -> TelegramPost:
    media = tuple(tweet.media[:MAX_MEDIA])
    return TelegramPost(
        html=render_tweet_html(tweet, limit=MESSAGE_LIMIT),
        caption_html=render_tweet_html(tweet, limit=CAPTION_LIMIT),
        media=media,
        extra_media_count=max(0, len(tweet.media) - MAX_MEDIA),
    )


def render_tweet_html(tweet: TweetData, *, limit: int = MESSAGE_LIMIT) -> str:
    raw_text = (tweet.text or "Пост без текста.").strip() or "Пост без текста."

    def build(text: str) -> str:
        parts = [
            _author_html(tweet),
            "",
            escape(text),
        ]
        related = _related_html(tweet)
        if related:
            parts.extend(["", f"<blockquote>{related}</blockquote>"])
        if len(tweet.media) > MAX_MEDIA:
            parts.extend(["", f"Показаны первые {MAX_MEDIA} медиа из {len(tweet.media)}."])
        parts.extend(["", _original_html(tweet.url)])
        return "\n".join(parts)

    rendered = build(raw_text)
    if len(rendered) <= limit:
        return rendered

    max_raw_len = len(raw_text)
    while max_raw_len > 0:
        max_raw_len -= max(1, (len(rendered) - limit) // 2)
        clipped = _truncate_raw(raw_text, max_raw_len)
        rendered = build(clipped)
        if len(rendered) <= limit:
            return rendered

    fallback = f"{_author_html(tweet)}\n\n...\n\n{_original_html(tweet.url)}"
    return fallback if len(fallback) <= limit else _original_html(tweet.url)


def _author_html(tweet: TweetData) -> str:
    label = f"{tweet.author_name} (@{tweet.author_username})"
    return f'<a href="{escape(tweet.author_url, quote=True)}">{escape(label)}</a>'


def _original_html(url: str) -> str:
    escaped_url = escape(url, quote=True)
    return f'Оригинал: <a href="{escaped_url}">{escape(url)}</a>'


def _related_html(tweet: TweetData) -> str | None:
    related = tweet.quoted_tweet or tweet.replied_to_tweet
    if not related:
        return None
    text = (related.text or "Пост без текста.").strip() or "Пост без текста."
    label = f"{related.author_name} (@{related.author_username}): "
    return escape(label + _truncate_raw(text, 500))


def _truncate_raw(value: str, max_length: int) -> str:
    if len(value) <= max_length:
        return value
    if max_length <= 3:
        return "..."[:max_length]
    return value[: max_length - 3].rstrip() + "..."
