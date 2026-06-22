# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Xtract Bot** is a TypeScript Telegram bot that lets users share X/Twitter posts and profiles inside Telegram. It extracts tweet content (text, media, metadata) and profile cards (bio, stats, avatar) via pluggable providers and formats them for Telegram.

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

**Private chat**: Update → `sessionMiddleware` (opens Drizzle transaction, builds repos/services, attaches them to the grammY `Context`) → `accessMiddleware` (registers user, enforces whitelist) → `rateLimitMiddleware` (per-user token bucket on fetch actions; admins exempt) → composer-bound handler → `tweetShareService` → provider → `tweetCache` repository → formatter → Telegram message. When the message contains a tweet URL, the handler first streams a short-lived animated `<tg-thinking>` placeholder via `replyWithRichMessageDraft` (best-effort; failures are ignored). Rich Message **drafts are private-chat only** (they need a numeric `chat_id`), so inline has no equivalent animation.

`tweetShareService` also **unrolls threads** (walks up the self-reply chain via `repliedToTweet` / `inReplyToTweetId`, capped by `THREAD_MAX_TWEETS`) and uses a **negative cache** to short-circuit known-deleted/not-found tweets. A multi-tweet thread is rendered by `formatThread` into a `TelegramPost` carrying per-post `segments`; `buildRichMessage` interleaves each post's text with its own media and chains the posts with `<hr/>` dividers (no numbering, up to the 32k char / 50 media Rich Message limits). A single tweet uses `formatTweet`. Both feed the same Rich Message / legacy-ladder send path.

**Inline query**: `@bot <url>` → `inline_query` handler immediately responds with "⏳ Loading…" placeholders (no fetch yet) → user selects result → `chosen_inline_result` handler runs the full share flow and edits the message in-place. It offers two variants — **Поделиться постом** (`tweet-<id>`, single post) and, when `THREAD_UNROLL_ENABLED`, **🧵 Поделиться тредом** (`tweet-thread-<id>`, whole thread) — plus the translation variant (`tweet-ru-<id>`) when enabled; the chosen `result_id` prefix selects whether to unroll (via `ProcessOptions.unrollThread`). Posts with media are edited into a Rich Message so all media is shown in one message; it falls back to the legacy single-media edit on failure.

**Profile sharing**: a bare handle URL (e.g. `https://x.com/jack`, no `/status/`) is treated as a profile share, handled by `profileShareService` instead of `tweetShareService`. `src/utils/urls.ts` exposes `parseProfileUrl` / `extractFirstProfileUrl` (rejects status links, reserved routes like `/home` or `/i/...`, and non-handle deep links; accepts known profile sub-tabs like `/media`). Profiles are fetched by a separate `ProfileProvider` (`getProfile`), cached in `profile_cache` (with the same positive/negative TTL scheme as tweets), formatted by `formatProfile` into a `TelegramPost` (avatar + banner as media, verified badge, follower/following/post counts, location, website, join date), and sent through the **same** Rich Message / legacy-ladder path. In inline mode it adds a **👤 Поделиться профилем** result (`profile-<username>`). Both private and inline profile fetches count against the rate limiter.

### Key Layers

| Layer        | Path                    | Role                                                                                        |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------------- |
| Entry point  | `src/main.ts`           | Init DB, bot, provider; polling/webhook                                                     |
| Dispatcher   | `src/bot/dispatcher.ts` | Register middlewares and composers                                                          |
| Handlers     | `src/bot/handlers/`     | `private.ts`, `admin.ts`, `inline.ts`                                                       |
| Middlewares  | `src/bot/middlewares/`  | `session.ts`, `access.ts`, `rateLimit.ts`                                                   |
| Services     | `src/services/`         | `access`, `stats`, `tweetShare`, `profileShare`, `rateLimit`                                |
| Repositories | `src/repositories/`     | Data access for each Drizzle table                                                          |
| Providers    | `src/providers/`        | Pluggable tweet/profile fetching strategies                                                 |
| Formatters   | `src/formatters/`       | `telegram.ts` (`TweetData` → `TelegramPost`), `profile.ts` (`ProfileData` → `TelegramPost`) |
| Utils        | `src/utils/urls.ts`     | Parse X/Twitter/VxTwitter post & profile URLs                                               |

### Middleware & Dependency Injection

`sessionMiddleware` runs first: it opens a Drizzle transaction (`db.transaction(...)`), constructs all repositories and services, attaches them to the grammY `Context`, and the transaction commits on success or rolls back if the handler throws. `accessMiddleware` runs second: it reads `ctx.services.access`, upserts the user, then blocks access unless the user is an admin, is whitelisted, or is using a public command (`/start`, `/help`, `/id`). `rateLimitMiddleware` runs third (only when `RATE_LIMIT_ENABLED`): it consumes a token from an **in-memory** token bucket (created once in `buildBot`, shared across updates — not per-request) for fetch actions only (private text carrying a tweet URL, and `chosen_inline_result`); admins are exempt.

Handlers consume injected services via the typed `AppContext` (e.g. `ctx.services.tweetShare`).

### Providers

Selected via `TWEET_PROVIDER` env var. All implement `TweetProvider` (`getTweet`, `health`, `close`).

- `fake` — deterministic mock, for dev/testing
- `public_embed` — tries FxTwitter → VxTwitter → Syndication API → oEmbed in sequence; uses the first that returns usable content (default for public use)
- `external_http` — delegates to an external HTTP API (requires `TWEET_PROVIDER_BASE_URL`)
- `x_api` — official X API v2 (requires `X_BEARER_TOKEN`)

`TweetData` and `TweetMedia` are the shared domain types defined in `src/providers/base.ts`. `TweetData` also carries `inReplyToTweetId` (parent status id, used for thread unrolling) and `poll` (a `TweetPoll` of options + vote counts, rendered by `pollHtml`). Helper functions `tweetToPayload` / `tweetFromPayload` handle the JSONB serialisation used by the cache.

**Profile providers** are a separate, smaller interface (`ProfileProvider` with `getProfile` / `close`, in `src/providers/profileBase.ts`) so the existing tweet providers (and their test fakes) stay untouched. `createProfileProvider` (`src/providers/profileFactory.ts`) returns `FakeProfileProvider` for `TWEET_PROVIDER=fake` and otherwise `PublicEmbedProfileProvider`, which hits FxTwitter's credential-free public user endpoint regardless of `TWEET_PROVIDER` (so profile sharing works even with `external_http` / `x_api`). `ProfileData` plus `profileToPayload` / `profileFromPayload` live alongside.

### Database Schema (`src/db/schema.ts`)

- `users` — Telegram user + `is_allowed` whitelist flag
- `tweet_cache` — keyed by `tweet_id` with TTL (`expires_at`). Positive entries hold the JSONB `payload`; **negative** entries (deleted/not-found) have a null `payload` and a non-null `error_code` so providers aren't re-hit. The repository exposes `getEntry` (discriminated `hit`/`negative`), `set`, `setNegative`, `count`, `clearAll`, and `clearExpired`. Admins purge it manually via `/clearcache` (or `/clearcache expired`); a background loop (`src/services/cacheCleanup.ts`, gated by `CACHE_CLEANUP_ENABLED`) periodically calls `clearExpired` so the table doesn't grow unbounded.
- `profile_cache` — same shape/semantics as `tweet_cache` but keyed by lower-cased `username` and storing a `ProfileDataPayload` (TTL `PROFILE_CACHE_TTL_SECONDS`, default 6h). `/clearcache` and the cleanup loop purge it alongside `tweet_cache`.
- `share_events` — per-share audit log (mode: private/inline, status, error_code)
- `admin_actions` — admin allow/deny audit log

Migrations live in `drizzle/migrations/*.sql` and are applied by `src/db/migrate.ts`.

### Deployment (`src/main.ts`)

`POLLING_ENABLED=true` (default) runs long polling. Otherwise `main.ts` starts a `Bun.serve` HTTP server and registers the webhook from `WEBHOOK_URL` via grammY's `webhookCallback(bot, "bun", { secretToken })`, listening on `WEBHOOK_PORT` (or `$PORT`) with a `GET /health` route. Both paths track in-flight handlers and drain them on `SIGINT`/`SIGTERM` before closing the provider and DB.

### Configuration (`src/config.ts`)

Plain `loadSettings(env)` function — no global cache, accepts an env dictionary so tests can pass overrides directly. See `.env.example` for all vars.

### Media Sending Strategy (private chat)

`src/bot/handlers/private.ts` first tries `replyWithRichMessage` — a Rich Message (Bot API 9.x) whose body is the tweet text and whose media is a `<tg-slideshow>` carousel (built by `src/formatters/richMessage.ts`). If that throws a `GrammyError`, it falls back to the legacy ladder: `replyWithMediaGroup` with direct URLs → `replyWithMediaGroup` with preview thumbnails → individual items one by one → plain text fallback. Each step catches `GrammyError` and falls through.

The bot installs an API transformer that sets `parse_mode: "HTML"` on `sendMessage`, `editMessageText`, and `editMessageCaption` unless the caller overrides it. Rich Message payloads (which carry a `rich_message` field instead of `text`) are skipped, since `parse_mode` only applies to plain text/caption.

### Tests

Tests are plain TS files under `tests/*.test.ts`, using Vitest. Path alias `@/*` resolves to `src/*`. Use simple in-module fakes (e.g. `FakeProvider`, `FakeCache`) rather than mocking frameworks. The `public_embed` test injects a custom `fetch` to replay canned HTTP responses.

Handler tests (`tests/privateHandler.test.ts`, `tests/inlineHandler.test.ts`) drive the **real** grammY composers through `tests/support/botHarness.ts`: it builds a `Bot` with a fake `botInfo` and installs an API transformer that records every call (and can force `GrammyError`s) instead of hitting Telegram, while a middleware injects fake `ctx.services`. This exercises command parsing, filters, and context shortcuts without network. Non-`*.test.ts` files under `tests/` (e.g. `tests/support/`) are helpers, not test suites.
