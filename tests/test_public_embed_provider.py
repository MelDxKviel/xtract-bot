import asyncio

import httpx

from app.providers.base import TweetProviderError
from app.providers.public_embed import PublicEmbedTweetProvider


def test_public_embed_provider_reads_syndication_payload() -> None:
    async def run() -> None:
        payload = {
            "id_str": "123",
            "text": "Hello &amp; world",
            "created_at": "2026-04-25T10:00:00Z",
            "lang": "en",
            "user": {"name": "Display Name", "screen_name": "user"},
            "photos": [
                {
                    "url": "https://pbs.twimg.com/media/photo.jpg",
                    "width": 640,
                    "height": 480,
                }
            ],
            "video": {
                "poster": "https://pbs.twimg.com/media/poster.jpg",
                "duration_ms": 1200,
                "variants": [
                    {
                        "content_type": "application/x-mpegURL",
                        "url": "https://video.twimg.com/video.m3u8",
                    },
                    {
                        "content_type": "video/mp4",
                        "bitrate": 256000,
                        "url": "https://video.twimg.com/low.mp4",
                    },
                    {
                        "content_type": "video/mp4",
                        "bitrate": 2176000,
                        "url": "https://video.twimg.com/high.mp4",
                    },
                ],
            },
            "quoted_tweet": {
                "id_str": "456",
                "text": "Quoted text",
                "user": {"name": "Quoted", "screen_name": "quoted"},
            },
        }
        client = _client(lambda request: httpx.Response(200, json=payload, request=request))
        provider = PublicEmbedTweetProvider(client=client)

        tweet = await provider.get_tweet("123", "https://x.com/user/status/123")

        assert tweet.tweet_id == "123"
        assert tweet.author_name == "Display Name"
        assert tweet.author_username == "user"
        assert tweet.text == "Hello & world"
        assert tweet.lang == "en"
        assert tweet.media[0].type == "photo"
        assert tweet.media[0].url == "https://pbs.twimg.com/media/photo.jpg"
        assert tweet.media[1].type == "video"
        assert tweet.media[1].url == "https://video.twimg.com/high.mp4"
        assert tweet.quoted_tweet is not None
        assert tweet.quoted_tweet.author_username == "quoted"

    asyncio.run(run())


def test_public_embed_provider_falls_back_to_oembed() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "cdn.syndication.twimg.com":
                return httpx.Response(503, request=request)
            return httpx.Response(
                200,
                json={
                    "author_name": "Display Name",
                    "author_url": "https://twitter.com/user",
                    "html": (
                        '<blockquote class="twitter-tweet">'
                        '<p lang="en" dir="ltr">Hello <a href="https://t.co/a">link</a>'
                        "<br>line 2</p>"
                        '<img src="https://pbs.twimg.com/media/photo.jpg">'
                        "&mdash; Display Name (@user)"
                        '<a href="https://twitter.com/user/status/123">Date</a>'
                        "</blockquote>"
                    ),
                },
                request=request,
            )

        provider = PublicEmbedTweetProvider(client=_client(handler))

        tweet = await provider.get_tweet("123", "https://x.com/user/status/123")

        assert tweet.tweet_id == "123"
        assert tweet.author_name == "Display Name"
        assert tweet.author_username == "user"
        assert tweet.text == "Hello link\nline 2"
        assert tweet.lang == "en"
        assert tweet.media[0].url == "https://pbs.twimg.com/media/photo.jpg"

    asyncio.run(run())


def test_public_embed_provider_keeps_rate_limit_error() -> None:
    async def run() -> None:
        provider = PublicEmbedTweetProvider(
            client=_client(lambda request: httpx.Response(429, request=request))
        )

        try:
            await provider.get_tweet("123", "https://x.com/user/status/123")
        except TweetProviderError as exc:
            assert exc.code == "provider_rate_limited"
        else:
            raise AssertionError("expected provider_rate_limited")

    asyncio.run(run())


def test_public_embed_provider_reports_unavailable_tweet() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "cdn.syndication.twimg.com":
                return httpx.Response(200, json={"__typename": "TweetTombstone"}, request=request)
            return httpx.Response(404, request=request)

        provider = PublicEmbedTweetProvider(client=_client(handler))

        try:
            await provider.get_tweet("123", "https://x.com/user/status/123")
        except TweetProviderError as exc:
            assert exc.code == "not_found"
        else:
            raise AssertionError("expected not_found")

    asyncio.run(run())


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))
