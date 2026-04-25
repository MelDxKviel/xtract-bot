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

**Private chat**: Message → `AccessMiddleware` (registers user, enforces whitelist) → `DatabaseSessionMiddleware` (injects repos/services) → `private.py` handler → `TweetShareService` → provider → `TweetCacheRepository` → formatter → Telegram message.

**Inline query**: `@bot <url>` → `inline.py` shows loading result → user selects → `chosen_inline_result` runs same share flow → edits message in-place.

### Key Layers

| Layer | Path | Role |
|---|---|---|
| Entry point | `app/main.py` | Init DB, bot, provider; start polling |
| Dispatcher | `app/bot/dispatcher.py` | Register middlewares and 3 routers |
| Handlers | `app/bot/handlers/` | `private.py`, `admin.py`, `inline.py` |
| Middlewares | `app/bot/middlewares/` | `DatabaseSessionMiddleware`, `AccessMiddleware` |
| Services | `app/services/` | `TweetShareService`, `AccessService`, `StatsService` |
| Repositories | `app/repositories/` | Data access for each DB model |
| Providers | `app/providers/` | Pluggable tweet fetching strategies |
| Formatters | `app/formatters/` | Convert `TweetData` → HTML `TelegramPost` |
| Utils | `app/utils/urls.py` | Parse X/Twitter/VxTwitter URLs |

### Providers

Selected via `TWEET_PROVIDER` env var. All implement `TweetProvider` base class and return `TweetData`.

- `fake` — deterministic mock, for dev/testing
- `public_embed` — FxTwitter/VxTwitter + oEmbed fallback (default for public use)
- `external_http` — delegates to an external HTTP API
- `x_api` — official X API v2

### Database Models (`app/db/models.py`)

- `users` — Telegram user + `is_allowed` whitelist flag
- `tweet_cache` — JSONB payload with TTL (`expires_at`)
- `share_events` — per-share audit log (mode: private/inline, status, error_code)
- `admin_actions` — admin allow/deny audit log

### Configuration (`app/config.py`)

Pydantic Settings loaded from `.env`. Key settings: `BOT_TOKEN`, `DATABASE_URL`, `ADMIN_IDS` (frozenset), `TWEET_PROVIDER`, `ACCESS_WHITELIST_ENABLED`, cache TTL, provider timeouts. See `.env.example` for full reference.

### Middlewares Dependency Injection

`DatabaseSessionMiddleware` creates the async session and injects repositories and services into handler `data` dict. Handlers receive them as keyword arguments. `AccessMiddleware` runs after and performs user registration + access enforcement.
