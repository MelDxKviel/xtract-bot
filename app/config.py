from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_id_list(value: str) -> frozenset[int]:
    ids: set[int] = set()
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        ids.add(int(item))
    return frozenset(ids)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    bot_token: SecretStr = Field(alias="BOT_TOKEN")
    database_url: str = Field(alias="DATABASE_URL")
    admin_ids: str = Field(default="", alias="ADMIN_IDS")
    access_whitelist_enabled: bool = Field(default=True, alias="ACCESS_WHITELIST_ENABLED")
    tweet_provider: Literal["fake", "public_embed", "external_http", "x_api"] = Field(
        default="fake",
        alias="TWEET_PROVIDER",
    )
    tweet_cache_ttl_seconds: int = Field(default=86_400, alias="TWEET_CACHE_TTL_SECONDS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    webhook_url: str | None = Field(default=None, alias="WEBHOOK_URL")
    webhook_secret: str | None = Field(default=None, alias="WEBHOOK_SECRET")
    polling_enabled: bool = Field(default=True, alias="POLLING_ENABLED")

    tweet_provider_base_url: str | None = Field(default=None, alias="TWEET_PROVIDER_BASE_URL")
    tweet_provider_api_key: SecretStr | None = Field(default=None, alias="TWEET_PROVIDER_API_KEY")
    tweet_provider_timeout_seconds: float = Field(
        default=10.0, alias="TWEET_PROVIDER_TIMEOUT_SECONDS"
    )
    x_bearer_token: SecretStr | None = Field(default=None, alias="X_BEARER_TOKEN")

    @property
    def admin_id_set(self) -> frozenset[int]:
        return parse_id_list(self.admin_ids)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
