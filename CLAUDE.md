# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Xtract Bot** is a TypeScript Telegram bot that lets users share X/Twitter posts inside Telegram. It extracts tweet content (text, media, metadata) via pluggable providers and formats it for Telegram.

Stack: TypeScript 5, grammY 1.42, Drizzle ORM (postgres-js), PostgreSQL 17, Vitest, Bun.

## Commands

```bash
# Install dependencies
bun install

# Lint
bun run lint

# Format
bun run format
bun run format:check

# Typecheck
bun run typecheck

# Tests
bun run test
bun run test tests/urls.test.ts
bun run test -- -t "embed"

# Database migrations
bun run src/db/migrate.ts

# Run bot locally (requires .env)
bun run start

# Docker (local: builds from source)
docker compose -f docker-compose.local.yml up --build
```

CI runs `typecheck`, `lint`, `format:check`, and `test` on every PR.

## Architecture

### Request Flow

**Private chat**: Update → `sessionMiddleware` (opens Drizzle transaction, builds repos/services, attaches them to the grammY `Context`) → `accessMiddleware` (registers user, enforces whitelist) → composer-bound handler → `tweetShareService` → provider → `tweetCache` repository → formatter → Telegram message.

**Inline query**: `@bot <url>` → `inline_query` handler immediately responds with a "⏳ Loading…" placeholder (no fetch yet) → user selects result → `chosen_inline_result` handler runs the full share flow and edits the message in-place.

### Key Layers

| Layer        | Path                         | Role                                      |
| ------------ | ---------------------------- | ----------------------------------------- |
| Entry point  | `src/main.ts`                | Init DB, bot, provider; start polling     |
| Dispatcher   | `src/bot/dispatcher.ts`      | Register middlewares and composers        |
| Handlers     | `src/bot/handlers/`          | `private.ts`, `admin.ts`, `inline.ts`     |
| Middlewares  | `src/bot/middlewares/`       | `session.ts`, `access.ts`                 |
| Services     | `src/services/`              | `access`, `stats`, `tweetShare`           |
| Repositories | `src/repositories/`          | Data access for each Drizzle table        |
| Providers    | `src/providers/`             | Pluggable tweet fetching strategies       |
| Formatters   | `src/formatters/telegram.ts` | Convert `TweetData` → HTML `TelegramPost` |
| Utils        | `src/utils/urls.ts`          | Parse X/Twitter/VxTwitter URLs            |

### Middleware & Dependency Injection

Both middlewares run on every update. `sessionMiddleware` runs first: it opens a Drizzle transaction (`db.transaction(...)`), constructs all repositories and services, attaches them to the grammY `Context`, and the transaction commits on success or rolls back if the handler throws. `accessMiddleware` runs second: it reads `ctx.services.access`, upserts the user, then blocks access unless the user is an admin, is whitelisted, or is using a public command (`/start`, `/help`, `/id`).

Handlers consume injected services via the typed `AppContext` (e.g. `ctx.services.tweetShare`).

### Providers

Selected via `TWEET_PROVIDER` env var. All implement `TweetProvider` (`getTweet`, `health`, `close`).

- `fake` — deterministic mock, for dev/testing
- `public_embed` — tries FxTwitter → VxTwitter → Syndication API → oEmbed in sequence; uses the first that returns usable content (default for public use)
- `external_http` — delegates to an external HTTP API (requires `TWEET_PROVIDER_BASE_URL`)
- `x_api` — official X API v2 (requires `X_BEARER_TOKEN`)

`TweetData` and `TweetMedia` are the shared domain types defined in `src/providers/base.ts`. Helper functions `tweetToPayload` / `tweetFromPayload` handle the JSONB serialisation used by the cache.

### Database Schema (`src/db/schema.ts`)

- `users` — Telegram user + `is_allowed` whitelist flag
- `tweet_cache` — JSONB payload with TTL (`expires_at`); keyed by `tweet_id`
- `share_events` — per-share audit log (mode: private/inline, status, error_code)
- `admin_actions` — admin allow/deny audit log

Migrations live in `drizzle/migrations/*.sql` and are applied by `src/db/migrate.ts`.

### Configuration (`src/config.ts`)

Plain `loadSettings(env)` function — no global cache, accepts an env dictionary so tests can pass overrides directly. See `.env.example` for all vars.

### Media Sending Strategy (private chat)

`src/bot/handlers/private.ts` tries to send media in this fallback order: `replyWithMediaGroup` with direct URLs → `replyWithMediaGroup` with preview thumbnails → individual items one by one → plain text fallback. Each step catches `GrammyError` and falls through. The bot installs an API transformer that sets `parse_mode: "HTML"` on `sendMessage`, `editMessageText`, and `editMessageCaption` unless the caller overrides it.

### Tests

Tests are plain TS files under `tests/*.test.ts`, using Vitest. Path alias `@/*` resolves to `src/*`. Use simple in-module fakes (e.g. `FakeProvider`, `FakeCache`) rather than mocking frameworks. The `public_embed` test injects a custom `fetch` to replay canned HTTP responses.
