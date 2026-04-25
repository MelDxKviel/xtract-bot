from app.config import Settings
from app.providers.base import TweetData, TweetMedia, TweetProvider, TweetProviderError
from app.providers.external_http import ExternalHttpTweetProvider
from app.providers.fake import FakeTweetProvider
from app.providers.public_embed import PublicEmbedTweetProvider
from app.providers.x_api import XApiTweetProvider

__all__ = [
    "TweetData",
    "TweetMedia",
    "TweetProvider",
    "TweetProviderError",
    "create_tweet_provider",
]


def create_tweet_provider(settings: Settings) -> TweetProvider:
    if settings.tweet_provider == "fake":
        return FakeTweetProvider()

    if settings.tweet_provider == "public_embed":
        return PublicEmbedTweetProvider(timeout=settings.tweet_provider_timeout_seconds)

    if settings.tweet_provider == "external_http":
        if not settings.tweet_provider_base_url:
            msg = "TWEET_PROVIDER_BASE_URL is required for external_http provider"
            raise ValueError(msg)
        api_key = (
            settings.tweet_provider_api_key.get_secret_value()
            if settings.tweet_provider_api_key
            else None
        )
        return ExternalHttpTweetProvider(
            settings.tweet_provider_base_url,
            api_key=api_key,
            timeout=settings.tweet_provider_timeout_seconds,
        )

    if settings.tweet_provider == "x_api":
        if not settings.x_bearer_token:
            msg = "X_BEARER_TOKEN is required for x_api provider"
            raise ValueError(msg)
        return XApiTweetProvider(
            settings.x_bearer_token.get_secret_value(),
            timeout=settings.tweet_provider_timeout_seconds,
        )

    msg = f"unsupported tweet provider: {settings.tweet_provider}"
    raise ValueError(msg)
