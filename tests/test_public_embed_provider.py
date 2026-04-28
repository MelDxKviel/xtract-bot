import asyncio

import httpx

from app.providers.base import TweetProviderError
from app.providers.public_embed import PublicEmbedTweetProvider


def test_public_embed_provider_reads_fxtwitter_payload_first() -> None:
    async def run() -> None:
        calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url.host))
            return httpx.Response(
                200,
                json={
                    "code": 200,
                    "message": "OK",
                    "tweet": {
                        "url": "https://x.com/fillpackart/status/2047970725802242311",
                        "id": "2047970725802242311",
                        "text": (
                            "А твиттер тем временем всё лучше и лучше становится\n\n"
                            "Маску следует разыскать этих чмошников, которых он тогда "
                            "поувольнял нахуй, и уволить их ещё раз"
                        ),
                        "author": {
                            "screen_name": "fillpackart",
                            "url": "https://x.com/fillpackart",
                            "name": "Фил Ранжин",
                        },
                        "created_at": "Sat Apr 25 09:27:25 +0000 2026",
                        "lang": "ru",
                        "media": {
                            "all": [
                                {
                                    "type": "photo",
                                    "url": "https://pbs.twimg.com/media/HGvaTpqXsAAPE9w.jpg?name=orig",
                                    "width": 937,
                                    "height": 445,
                                }
                            ]
                        },
                        "quote": {
                            "id": "2047000000000000000",
                            "text": "Quoted tweet text",
                            "author": {
                                "screen_name": "quoted_user",
                                "name": "Quoted User",
                            },
                        },
                    },
                },
                request=request,
            )

        provider = PublicEmbedTweetProvider(client=_client(handler))

        tweet = await provider.get_tweet(
            "2047970725802242311",
            "https://x.com/i/status/2047970725802242311",
        )

        assert calls == ["api.fxtwitter.com"]
        assert tweet.tweet_id == "2047970725802242311"
        assert tweet.url == "https://x.com/fillpackart/status/2047970725802242311"
        assert tweet.author_name == "Фил Ранжин"
        assert tweet.author_username == "fillpackart"
        assert tweet.text is not None
        assert "А твиттер тем временем" in tweet.text
        assert "\n\n" in tweet.text
        assert tweet.lang == "ru"
        assert tweet.media[0].type == "photo"
        assert tweet.media[0].width == 937
        assert tweet.quoted_tweet is not None
        assert tweet.quoted_tweet.author_username == "quoted_user"
        assert tweet.quoted_tweet.text == "Quoted tweet text"

    asyncio.run(run())


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


def test_public_embed_provider_fetches_replied_to_tweet_from_fxtwitter() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "2047970725802242311" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "code": 200,
                        "tweet": {
                            "id": "2047970725802242311",
                            "text": "This is a reply",
                            "author": {"screen_name": "replier", "name": "Replier"},
                            "replying_to": {
                                "screen_name": "original_user",
                                "status": "1000000000000000001",
                            },
                        },
                    },
                    request=request,
                )
            return httpx.Response(
                200,
                json={
                    "code": 200,
                    "tweet": {
                        "id": "1000000000000000001",
                        "text": "Original tweet text",
                        "author": {"screen_name": "original_user", "name": "Original User"},
                    },
                },
                request=request,
            )

        provider = PublicEmbedTweetProvider(client=_client(handler))
        tweet = await provider.get_tweet(
            "2047970725802242311",
            "https://x.com/replier/status/2047970725802242311",
        )

        assert tweet.replied_to_tweet is not None
        assert tweet.replied_to_tweet.author_username == "original_user"
        assert tweet.replied_to_tweet.text == "Original tweet text"

    asyncio.run(run())


def test_public_embed_provider_fetches_replied_to_tweet_from_syndication() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host != "cdn.syndication.twimg.com":
                return httpx.Response(503, request=request)
            tweet_id = request.url.params.get("id", "")
            if tweet_id == "222":
                return httpx.Response(
                    200,
                    json={
                        "id_str": "222",
                        "text": "Reply tweet",
                        "user": {"name": "Replier", "screen_name": "replier"},
                        "in_reply_to_status_id_str": "111",
                    },
                    request=request,
                )
            return httpx.Response(
                200,
                json={
                    "id_str": "111",
                    "text": "Parent tweet",
                    "user": {"name": "Parent User", "screen_name": "parent_user"},
                },
                request=request,
            )

        provider = PublicEmbedTweetProvider(client=_client(handler))
        tweet = await provider.get_tweet("222", "https://x.com/replier/status/222")

        assert tweet.replied_to_tweet is not None
        assert tweet.replied_to_tweet.author_username == "parent_user"
        assert tweet.replied_to_tweet.text == "Parent tweet"

    asyncio.run(run())


def test_public_embed_provider_silently_skips_unavailable_replied_to_tweet() -> None:
    async def run() -> None:
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return httpx.Response(
                    200,
                    json={
                        "code": 200,
                        "tweet": {
                            "id": "2047970725802242311",
                            "text": "This is a reply",
                            "author": {"screen_name": "replier", "name": "Replier"},
                            "replying_to": {
                                "screen_name": "gone_user",
                                "status": "999",
                            },
                        },
                    },
                    request=request,
                )
            return httpx.Response(404, request=request)

        provider = PublicEmbedTweetProvider(client=_client(handler))
        tweet = await provider.get_tweet(
            "2047970725802242311",
            "https://x.com/replier/status/2047970725802242311",
        )

        assert tweet.text == "This is a reply"
        assert tweet.replied_to_tweet is None

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


def test_public_embed_provider_skips_empty_syndication_payload() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host in {"api.fxtwitter.com", "api.vxtwitter.com"}:
                return httpx.Response(503, request=request)
            if request.url.host == "cdn.syndication.twimg.com":
                return httpx.Response(200, json={}, request=request)
            return httpx.Response(
                200,
                json={
                    "url": "https://twitter.com/fillpackart/status/2047970725802242311",
                    "author_name": "Фил Ранжин",
                    "author_url": "https://twitter.com/fillpackart",
                    "html": (
                        '<blockquote class="twitter-tweet">'
                        '<p lang="ru" dir="ltr">А твиттер тем временем всё лучше</p>'
                        "&mdash; Фил Ранжин (@fillpackart)"
                        '<a href="https://twitter.com/fillpackart/status/2047970725802242311">'
                        "Date</a></blockquote>"
                    ),
                },
                request=request,
            )

        provider = PublicEmbedTweetProvider(client=_client(handler))

        tweet = await provider.get_tweet(
            "2047970725802242311",
            "https://x.com/i/status/2047970725802242311",
        )

        assert tweet.author_username == "fillpackart"
        assert tweet.author_name == "Фил Ранжин"
        assert tweet.text == "А твиттер тем временем всё лучше"
        assert tweet.url == "https://x.com/fillpackart/status/2047970725802242311"

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
