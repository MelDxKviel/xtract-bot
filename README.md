<div align="center">

# 🐦 Xtract Bot

**A Telegram bot for sharing X / Twitter posts directly in Telegram**

Send a post link — the bot extracts text and media via an isolated `TweetProvider`,
caches the result in PostgreSQL, and returns a neatly formatted message.

[![CI](https://img.shields.io/github/actions/workflow/status/MelDxKviel/xtract-bot/ci.yml?branch=main&label=CI&logo=github&style=for-the-badge)](https://github.com/MelDxKviel/xtract-bot/actions/workflows/ci.yml)
[![CD](https://img.shields.io/github/actions/workflow/status/MelDxKviel/xtract-bot/cd.yml?branch=main&label=CD&logo=github&style=for-the-badge)](https://github.com/MelDxKviel/xtract-bot/actions/workflows/cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12%2B-blue?logo=python&logoColor=white&style=for-the-badge)](https://www.python.org/)

[![aiogram](https://img.shields.io/badge/aiogram-3.17-2CA5E0?logo=telegram&logoColor=white&style=flat-square)](https://docs.aiogram.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white&style=flat-square)](https://www.postgresql.org/)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00?logo=sqlalchemy&logoColor=white&style=flat-square)](https://www.sqlalchemy.org/)
[![Alembic](https://img.shields.io/badge/Alembic-1.14-6BA539?style=flat-square)](https://alembic.sqlalchemy.org/)
[![Pydantic](https://img.shields.io/badge/Pydantic-Settings-E92063?logo=pydantic&logoColor=white&style=flat-square)](https://docs.pydantic.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white&style=flat-square)](https://docs.docker.com/compose/)
[![uv](https://img.shields.io/badge/packaging-uv-DE5FE9?style=flat-square)](https://github.com/astral-sh/uv)
[![Ruff](https://img.shields.io/badge/lint-ruff-FCC21B?logo=ruff&logoColor=black&style=flat-square)](https://docs.astral.sh/ruff/)
[![pytest](https://img.shields.io/badge/tests-pytest-0A9EDC?logo=pytest&logoColor=white&style=flat-square)](https://docs.pytest.org/)

[Features](#-features) •
[Quick Start](#-quick-start) •
[Configuration](#%EF%B8%8F-configuration) •
[Local Run](#-local-run) •
[Commands](#-commands) •
[Contributing](CONTRIBUTING.md) •
[README на русском](README_RU.md)

</div>

---

## ✨ Features

- 🔗 **URL support** for `x.com`, `twitter.com`, `mobile.twitter.com`, `vxtwitter.com`
- 🧩 **Parses** `/status/<id>` and `/statuses/<id>` paths
- 🔐 **User whitelist** and administrators via `ADMIN_IDS`
- 💬 **Commands** `/start`, `/help`, `/id`, `/allow`, `/deny`, `/users`, `/stats`, `/health`
- ⚡ **Inline mode** with an instant "Loading…" response that is then edited in-place
- 🗄️ **Cache** of successful responses in PostgreSQL with a configurable TTL
- 🐳 **Docker Compose** with PostgreSQL and Alembic migrations out of the box
- 🔌 **Multiple providers** to choose from: `fake`, `public_embed`, `external_http`, `x_api`

---

## 🚀 Quick Start

### 1. Create a bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Run `/newbot` and save the token as `BOT_TOKEN`.
3. For inline mode run `/setinline`, select the bot, and set a placeholder.

### 2. Prepare `.env`

```bash
cp .env.example .env
# edit BOT_TOKEN, ADMIN_IDS, and other variables
```

### 3. Start with Docker Compose

```bash
docker compose -f docker-compose.local.yml up --build
```

Before starting, the `bot` container runs:

```bash
alembic upgrade head
python -m app.main
```

> 💡 The Docker image is built via `uv sync --frozen --no-dev` and `uv.lock` — no version surprises.

---

## ⚙️ Configuration

All variables are read via `pydantic-settings`. A full reference is in `.env.example`:

```env
BOT_TOKEN=123456:replace-me
DATABASE_URL=postgresql+asyncpg://xtract:xtract@postgres:5432/xtract
ADMIN_IDS=123456789,987654321
ACCESS_WHITELIST_ENABLED=true
TWEET_PROVIDER=public_embed
TWEET_CACHE_TTL_SECONDS=86400
TWEET_PROVIDER_TIMEOUT_SECONDS=10
LOG_LEVEL=INFO
POLLING_ENABLED=true
```

### Tweet providers

| Provider        | Description                                                                                                  | Requires                        |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `fake`          | Deterministic dev provider, no calls to X/Twitter                                                            | —                               |
| `public_embed`  | Public FxTwitter / VxTwitter card endpoints with Twitter oEmbed fallback — no tokens or accounts required    | —                               |
| `external_http` | External service `GET /tweets/{tweet_id}` returning `TweetData` JSON or `{ "tweet": ... }`                   | `TWEET_PROVIDER_BASE_URL`       |
| `x_api`         | Official X API v2                                                                                             | `X_BEARER_TOKEN`                |

### Access control

| `ACCESS_WHITELIST_ENABLED` value | Behavior                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `true`                            | Only admins and whitelisted users can use the bot                                              |
| `false`                           | The bot is open to all users; admin commands are still restricted to `ADMIN_IDS`               |

---

## 💻 Local Run

Install [`uv`](https://github.com/astral-sh/uv) if it is not already installed:

```bash
# Linux / macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```powershell
# Windows PowerShell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Start the bot:

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run python -m app.main
```

---

## 📜 Commands

### 👤 User

| Command   | Description                        |
| --------- | ---------------------------------- |
| `/start`  | Greeting and access status         |
| `/help`   | Short usage guide                  |
| `/id`     | Your Telegram user ID              |

### 🛡️ Admin

| Command                  | Description                               |
| ------------------------ | ----------------------------------------- |
| `/allow <telegram_id>`   | Add a user to the whitelist               |
| `/deny <telegram_id>`    | Remove a user from the whitelist          |
| `/users`                 | List all allowed users                    |
| `/stats`                 | Overall statistics and top users         |
| `/stats <telegram_id>`   | Statistics for a specific user            |
| `/health`                | Check DB and provider health              |

---
