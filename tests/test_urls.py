from app.utils.urls import extract_first_tweet_url, parse_tweet_url


def test_parse_supported_status_urls() -> None:
    samples = [
        "https://x.com/user/status/1234567890",
        "https://twitter.com/user/status/1234567890?s=20",
        "https://mobile.twitter.com/user/status/1234567890",
        "https://vxtwitter.com/user/statuses/1234567890",
    ]

    for sample in samples:
        parsed = parse_tweet_url(sample)
        assert parsed is not None
        assert parsed.tweet_id == "1234567890"
        assert parsed.normalized_url == "https://x.com/user/status/1234567890"


def test_extract_first_valid_url_from_text() -> None:
    parsed = extract_first_tweet_url(
        "ignore https://example.com/a then https://x.com/user/status/42?s=20"
    )

    assert parsed is not None
    assert parsed.tweet_id == "42"
    assert parsed.normalized_url == "https://x.com/user/status/42"


def test_invalid_url_returns_none() -> None:
    assert parse_tweet_url("https://example.com/user/status/123") is None
    assert parse_tweet_url("https://x.com/user/not-status/123") is None
