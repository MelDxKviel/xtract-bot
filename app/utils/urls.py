from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

SUPPORTED_HOSTS = {"x.com", "twitter.com", "mobile.twitter.com", "vxtwitter.com"}
URL_RE = re.compile(
    r"https?://(?:www\.)?(?:x\.com|twitter\.com|mobile\.twitter\.com|vxtwitter\.com)/[^\s<>()]+",
    re.IGNORECASE,
)
TRAILING_PUNCTUATION = ".,;:!?)]}>'\""


@dataclass(frozen=True, slots=True)
class ParsedTweetUrl:
    tweet_id: str
    source_url: str
    normalized_url: str


def extract_first_tweet_url(text: str) -> ParsedTweetUrl | None:
    for match in URL_RE.finditer(text):
        parsed = parse_tweet_url(match.group(0))
        if parsed:
            return parsed
    return None


def parse_tweet_url(url: str) -> ParsedTweetUrl | None:
    source_url = url.strip().rstrip(TRAILING_PUNCTUATION)
    parsed = urlparse(source_url)
    host = _normalize_host(parsed.netloc)
    if parsed.scheme not in {"http", "https"} or host not in SUPPORTED_HOSTS:
        return None

    segments = [unquote(part) for part in parsed.path.split("/") if part]
    for index, segment in enumerate(segments):
        if segment not in {"status", "statuses"}:
            continue
        if index + 1 >= len(segments) or not segments[index + 1].isdigit():
            continue
        tweet_id = segments[index + 1]
        username = segments[0] if segments and segments[0] not in {"status", "statuses"} else "i"
        return ParsedTweetUrl(
            tweet_id=tweet_id,
            source_url=source_url,
            normalized_url=f"https://x.com/{username}/status/{tweet_id}",
        )
    return None


def _normalize_host(host: str) -> str:
    host = host.lower().split(":", 1)[0]
    if host.startswith("www."):
        return host[4:]
    return host
