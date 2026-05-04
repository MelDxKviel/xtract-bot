# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Xtract Bot** is an async Python Telegram bot that lets users share X/Twitter posts inside Telegram. It extracts tweet content (text, media, metadata) via pluggable providers and formats it for Telegram.

Stack: Python 3.12+, aiogram 3, SQLAlchemy 2 (async), PostgreSQL 17, Alembic, Pydantic Settings, uv.

## Commands

```bash
# Install dependencies (including dev)
uv sync --extra dev

# Lint
uv run ruff check .

# Format
uv run ruff format .

# Run tests
uv run pytest

# Run a single test file
uv run pytest tests/test_urls.py

# Run tests matching a name pattern
uv run pytest -k "test_name"

# Database migrations
uv run alembic upgrade head

# Run bot locally (requires .env)
uv run python -m app.main

# Docker (local: builds from source)
docker compose -f docker-compose.local.yml up --build
```

CI runs `ruff check .`, `ruff format --check .`, and `pytest` on every PR.

## Architecture

### Request Flow

**Private chat**: Message → `DatabaseSessionMiddleware` (injects repos/services) → `AccessMiddleware` (registers user, enforces whitelist) → `private.py` handler → `TweetShareService` → provider → `TweetCacheRepository` → formatter → Telegram message.

**Inline query**: `@bot <url>` → `inline_query` handler immediately responds with a "⏳ Loading…" placeholder (no fetch yet) → user selects result → `chosen_inline_result` handler runs the full share flow and edits the message in-place.

### Key Layers

| Layer | Path | Role |
|---|---|---|
| Entry point | `app/main.py` | Init DB, bot, provider; start polling |
| Dispatcher | `app/bot/dispatcher.py` | Register middlewares and 3 routers |
| Handlers | `app/bot/handlers/` | `private.py`, `admin.py`, `inline.py` |
| Middlewares | `app/bot/middlewares/access.py` | `DatabaseSessionMiddleware`, `AccessMiddleware` |
| Services | `app/services/` | `TweetShareService`, `AccessService`, `StatsService` |
| Repositories | `app/repositories/` | Data access for each DB model |
| Providers | `app/providers/` | Pluggable tweet fetching strategies |
| Formatters | `app/formatters/telegram.py` | Convert `TweetData` → HTML `TelegramPost` |
| Utils | `app/utils/urls.py` | Parse X/Twitter/VxTwitter URLs |

### Middleware & Dependency Injection

Both middlewares are applied to `message`, `inline_query`, and `chosen_inline_result` observers. `DatabaseSessionMiddleware` runs first (outermost): it opens an async SQLAlchemy session, constructs all repositories and services, injects them into the handler `data` dict, then commits on success or rolls back on exception. `AccessMiddleware` runs second: it reads `access_service` from `data`, upserts the user, then blocks access unless the user is an admin, is whitelisted, or is using a public command (`/start`, `/help`, `/id`).

Handlers declare injected objects as keyword arguments (e.g. `tweet_share_service: TweetShareService`).

### Providers

Selected via `TWEET_PROVIDER` env var. All implement `TweetProvider` (`get_tweet`, `health`, `close`).

- `fake` — deterministic mock, for dev/testing
- `public_embed` — tries FxTwitter → VxTwitter → Syndication API → oEmbed in sequence; uses the first that returns usable content (default for public use)
- `external_http` — delegates to an external HTTP API (requires `TWEET_PROVIDER_BASE_URL`)
- `x_api` — official X API v2 (requires `X_BEARER_TOKEN`)

`TweetData` and `TweetMedia` are the shared domain types defined in `app/providers/base.py`. They have `to_payload()` / `from_payload()` for JSONB serialisation used by the cache.

### Database Models (`app/db/models.py`)

- `users` — Telegram user + `is_allowed` whitelist flag
- `tweet_cache` — JSONB payload with TTL (`expires_at`); keyed by `tweet_id`
- `share_events` — per-share audit log (mode: private/inline, status, error_code)
- `admin_actions` — admin allow/deny audit log

### Configuration (`app/config.py`)

Pydantic Settings loaded from `.env`. `get_settings()` is `@lru_cache`-wrapped — tests that need custom settings must patch it or construct `Settings` directly. See `.env.example` for all vars.

### Media Sending Strategy (private chat)

`private.py` tries to send media in this fallback order: `answer_media_group` with direct URLs → `answer_media_group` with preview thumbnails → individual items one by one → plain text fallback. Each step catches `TelegramBadRequest` and falls through. The bot uses HTML parse mode globally (set in `DefaultBotProperties`).

### Tests

Tests are plain Python files under `tests/`. `asyncio_mode = "auto"` is configured, but most tests wrap coroutines in `asyncio.run()` manually. Use simple in-module fakes (e.g. `FakeProvider`, `FakeCache`) rather than mocking frameworks.
