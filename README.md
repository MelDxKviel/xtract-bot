<div align="center">

# 🐦 Xtract Bot

**A Telegram bot for sharing X / Twitter posts directly in Telegram**

Send a post link — the bot extracts text and media via an isolated `TweetProvider`,
caches the result in PostgreSQL, and returns a neatly formatted message.

[![CI](https://img.shields.io/github/actions/workflow/status/MelDxKviel/xtract-bot/ci.yml?branch=main&label=CI&logo=github&style=for-the-badge)](https://github.com/MelDxKviel/xtract-bot/actions/workflows/ci.yml)
[![CD](https://img.shields.io/github/actions/workflow/status/MelDxKviel/xtract-bot/cd.yml?branch=main&label=CD&logo=github&style=for-the-badge)](https://github.com/MelDxKviel/xtract-bot/actions/workflows/cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![TypeScript 5+](https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)

[![grammY](https://img.shields.io/badge/grammY-1.42-FFCC00?logo=telegram&logoColor=black&style=flat-square)](https://grammy.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white&style=flat-square)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM-C5F74F?style=flat-square)](https://orm.drizzle.team/)
[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black&style=flat-square)](https://bun.sh/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white&style=flat-square)](https://docs.docker.com/compose/)
[![ESLint](https://img.shields.io/badge/lint-eslint-4B32C3?logo=eslint&logoColor=white&style=flat-square)](https://eslint.org/)
[![Vitest](https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white&style=flat-square)](https://vitest.dev/)

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

- 🔗 **URL support** for `x.com`, `twitter.com`, and embed-fixer mirrors — `vxtwitter.com`, `fixvx.com`, `fxtwitter.com`, `fixupx.com`, `twittpr.com`, `xfixup.com`, `pxtwitter.com`, `twitterez.com` (and any subdomain of these, e.g. `mobile.twitter.com`)
- 🧩 **Parses** `/status/<id>` and `/statuses/<id>` paths
- 🧵 **Thread unrolling** — collects a self-reply chain into a single post
- 🗳 **Polls** — renders options with vote counts and percentages
- 🔐 **User whitelist** and administrators via `ADMIN_IDS`
- 🐢 **Per-user rate limiting** to protect providers from flooding (admins exempt)
- 💬 **Commands** `/start`, `/help`, `/id`, `/allow`, `/deny`, `/users`, `/stats`, `/health`
- ⚡ **Inline mode** with an instant "Loading…" response that is then edited in-place
- 🗄️ **Cache** of successful responses in PostgreSQL with a configurable TTL
- 🚫 **Negative cache** so deleted/not-found posts don't re-hit providers
- 🌐 **Polling _or_ webhook** deployment (`POLLING_ENABLED` / `WEBHOOK_URL`)
- 🐳 **Docker Compose** with PostgreSQL and Drizzle migrations out of the box
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
bun run src/db/migrate.ts
bun run src/main.ts
```

> 💡 The Docker image is built on `oven/bun:1.3-alpine` from a frozen `bun.lock` — no version surprises.

---

## ⚙️ Configuration

All variables are read via `loadSettings()` (see `src/config.ts`). A full reference is in `.env.example`:

```env
BOT_TOKEN=123456:replace-me
DATABASE_URL=postgres://xtract:xtract@postgres:5432/xtract
ADMIN_IDS=123456789,987654321
ACCESS_WHITELIST_ENABLED=true
TWEET_PROVIDER=public_embed
TWEET_CACHE_TTL_SECONDS=86400
NEGATIVE_CACHE_TTL_SECONDS=600
THREAD_UNROLL_ENABLED=true
THREAD_MAX_TWEETS=10
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=20
RATE_LIMIT_WINDOW_SECONDS=60
TWEET_PROVIDER_TIMEOUT_SECONDS=10
LOG_LEVEL=INFO
POLLING_ENABLED=true
```

### Feature options

| Variable                     | Default | Description                                                             |
| ---------------------------- | ------- | ----------------------------------------------------------------------- |
| `THREAD_UNROLL_ENABLED`      | `true`  | Walk up a same-author reply chain and render it as one post             |
| `THREAD_MAX_TWEETS`          | `10`    | Maximum tweets collected per thread (including the shared one)          |
| `NEGATIVE_CACHE_TTL_SECONDS` | `600`   | How long deleted/not-found tweets are remembered to skip provider calls |
| `RATE_LIMIT_ENABLED`         | `true`  | Throttle per-user tweet fetches (admins are exempt)                     |
| `RATE_LIMIT_MAX_REQUESTS`    | `20`    | Fetches allowed per window before a user is told to slow down           |
| `RATE_LIMIT_WINDOW_SECONDS`  | `60`    | Length of the rate-limit window                                         |

### Deployment mode

By default the bot runs in **long polling** (`POLLING_ENABLED=true`). For
production behind HTTPS you can switch to **webhooks**:

```env
POLLING_ENABLED=false
WEBHOOK_URL=https://bot.example.com/telegram
WEBHOOK_SECRET=a-long-random-string
WEBHOOK_PORT=8080
```

The bot serves the webhook with `Bun.serve` on `WEBHOOK_PORT` (or `$PORT`),
verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` against `WEBHOOK_SECRET`,
registers the webhook on startup, and exposes `GET /health` for probes.

### Tweet providers

| Provider        | Description                                                                                               | Requires                  |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| `fake`          | Deterministic dev provider, no calls to X/Twitter                                                         | —                         |
| `public_embed`  | Public FxTwitter / VxTwitter card endpoints with Twitter oEmbed fallback — no tokens or accounts required | —                         |
| `external_http` | External service `GET /tweets/{tweet_id}` returning `TweetData` JSON or `{ "tweet": ... }`                | `TWEET_PROVIDER_BASE_URL` |
| `x_api`         | Official X API v2                                                                                         | `X_BEARER_TOKEN`          |

### Access control

| `ACCESS_WHITELIST_ENABLED` value | Behavior                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `true`                           | Only admins and whitelisted users can use the bot                                |
| `false`                          | The bot is open to all users; admin commands are still restricted to `ADMIN_IDS` |

---

## 💻 Local Run

Install [Bun](https://bun.sh/) if it is not already installed:

```bash
# Linux / macOS
curl -fsSL https://bun.sh/install | bash
```

```powershell
# Windows PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Start the bot:

```bash
bun install
bun run src/db/migrate.ts
bun run start
```

Useful scripts:

```bash
bun run test          # vitest
bun run typecheck     # tsc --noEmit
bun run lint          # eslint
bun run format        # prettier --write
```

---

## 📜 Commands

### 👤 User

| Command  | Description                |
| -------- | -------------------------- |
| `/start` | Greeting and access status |
| `/help`  | Short usage guide          |
| `/id`    | Your Telegram user ID      |

### 🛡️ Admin

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `/allow <telegram_id>` | Add a user to the whitelist      |
| `/deny <telegram_id>`  | Remove a user from the whitelist |
| `/users`               | List all allowed users           |
| `/stats`               | Overall statistics and top users |
| `/stats <telegram_id>` | Statistics for a specific user   |
| `/health`              | Check DB and provider health     |

---
