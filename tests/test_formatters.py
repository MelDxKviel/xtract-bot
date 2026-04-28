from app.formatters.telegram import CAPTION_LIMIT, MESSAGE_LIMIT, format_tweet, render_tweet_html
from app.providers.base import TweetData, TweetMedia


def make_tweet(**overrides) -> TweetData:
    data = {
        "tweet_id": "123",
        "url": "https://x.com/user/status/123",
        "author_name": "Display <Name>",
        "author_username": "user",
        "author_url": "https://x.com/user",
        "text": "Hello <b>& world",
        "media": [],
    }
    data.update(overrides)
    return TweetData(**data)


def test_render_tweet_html_escapes_user_text() -> None:
    html = render_tweet_html(make_tweet())

    assert "Display &lt;Name&gt;" in html
    assert "Hello &lt;b&gt;&amp; world" in html
    assert "<b>" not in html


def test_render_tweet_html_truncates_to_message_limit() -> None:
    html = render_tweet_html(make_tweet(text="x" * 10_000))

    assert len(html) <= MESSAGE_LIMIT
    assert "https://x.com/user/status/123" not in html


def test_render_tweet_html_does_not_include_original_link() -> None:
    html = render_tweet_html(make_tweet())

    assert "https://x.com/user/status/123" not in html
    assert "Открыть оригинал" not in html


def test_render_tweet_html_renders_quoted_tweet_as_blockquote() -> None:
    html = render_tweet_html(
        make_tweet(
            quoted_tweet=make_tweet(
                tweet_id="456",
                url="https://x.com/quoted/status/456",
                author_name="Quoted Author",
                author_username="quoted",
                author_url="https://x.com/quoted",
                text="Quoted <text>",
            )
        )
    )

    assert '<a href="https://x.com/quoted/status/456">Цитируемый пост</a>:' in html
    assert "<blockquote>" in html
    assert "Quoted Author (@quoted):" in html
    assert "Quoted &lt;text&gt;" in html


def test_render_tweet_html_strips_leading_mentions_for_replies() -> None:
    html = render_tweet_html(
        make_tweet(
            text="@someone @other Hello world",
            replied_to_tweet=make_tweet(tweet_id="789"),
        )
    )

    assert "Hello world" in html
    assert "@someone" not in html
    assert "@other" not in html


def test_render_tweet_html_keeps_mentions_for_non_replies() -> None:
    html = render_tweet_html(make_tweet(text="@someone Hello world"))

    assert "@someone" in html


def test_render_tweet_html_does_not_strip_cyrillic_at_sign_text() -> None:
    html = render_tweet_html(
        make_tweet(
            text="@привет это не хэндл",
            replied_to_tweet=make_tweet(tweet_id="789"),
        )
    )

    assert "@привет" in html


def test_render_tweet_html_does_not_strip_mention_without_delimiter() -> None:
    html = render_tweet_html(
        make_tweet(
            text="@user-continuation text",
            replied_to_tweet=make_tweet(tweet_id="789"),
        )
    )

    assert "@user" in html


def test_render_tweet_html_renders_replied_to_tweet_as_blockquote() -> None:
    html = render_tweet_html(
        make_tweet(
            replied_to_tweet=make_tweet(
                tweet_id="789",
                url="https://x.com/other/status/789",
                author_name="Other Author",
                author_username="other",
                author_url="https://x.com/other",
                text="Original <text>",
            )
        )
    )

    assert '<a href="https://x.com/other/status/789">Ответ на</a>:' in html
    assert "<blockquote>" in html
    assert "Other Author (@other):" in html
    assert "Original &lt;text&gt;" in html


def test_format_tweet_limits_caption_and_media() -> None:
    media = [
        TweetMedia(type="photo", url=f"https://example.com/{index}.jpg") for index in range(12)
    ]
    post = format_tweet(make_tweet(text="x" * 5000, media=media))

    assert len(post.caption_html) <= CAPTION_LIMIT
    assert len(post.media) == 10
    assert post.extra_media_count == 2
