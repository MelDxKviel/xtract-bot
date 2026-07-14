<div align="center">

# 🐦 Xtract Bot

**Telegram-бот для удобного шеринга постов из X / Twitter прямо в Telegram**

Отправьте ссылку на пост — бот вытащит текст и медиа через изолированный `TweetProvider`,
закеширует результат в PostgreSQL и вернёт аккуратно оформленное сообщение.

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

[Возможности](#-возможности) •
[Быстрый старт](#-быстрый-старт) •
[Конфигурация](#%EF%B8%8F-конфигурация) •
[Команды](#-команды) •
[Архитектура](#%EF%B8%8F-архитектура) •
[Разработка](#-разработка) •
[Контрибьюция](CONTRIBUTING.md)

</div>

---

## ✨ Возможности

- 🔗 **Поддержка ссылок** `x.com`, `twitter.com` и зеркал-фиксеров — `vxtwitter.com`, `fixvx.com`, `fxtwitter.com`, `fixupx.com`, `twittpr.com`, `xfixup.com`, `pxtwitter.com`, `twitterez.com` (и любых их поддоменов, напр. `mobile.twitter.com`)
- 🧩 **Парсинг** `/status/<id>` и `/statuses/<id>`
- 🧵 **Разворот тредов** — собирает цепочку самоответов в один пост
- 🗳 **Опросы** — варианты с числом голосов и процентами
- 🔐 **Whitelist пользователей** и администраторы из `ADMIN_IDS`
- 🐢 **Рейт-лимит на пользователя** для защиты провайдеров от заваливания (админы — без лимита)
- 💬 **Команды** `/start`, `/help`, `/id`, `/allow`, `/deny`, `/users`, `/stats`, `/health`
- ⚡ **Inline-режим** с быстрым ответом «Загрузка…» и последующим редактированием
- 🗄️ **Кеш** успешных ответов в PostgreSQL с настраиваемым TTL
- 🚫 **Негативный кеш** — удалённые/ненайденные посты не дёргают провайдеров повторно
- 🌐 **Polling _или_ webhook** (`POLLING_ENABLED` / `WEBHOOK_URL`)
- 🐳 **Docker Compose** с PostgreSQL и миграциями Drizzle из коробки
- 🔌 **Несколько провайдеров** на выбор: `fake`, `public_embed`, `external_http`, `x_api`

---

## 🚀 Быстрый старт

### 1. Создайте бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram.
2. Выполните `/newbot` и сохраните токен в `BOT_TOKEN`.
3. Для inline-режима выполните `/setinline`, выберите бота и задайте placeholder.

### 2. Подготовьте `.env`

```bash
cp .env.example .env
# отредактируйте BOT_TOKEN, ADMIN_IDS и другие переменные
```

### 3. Запустите через Docker Compose

```bash
docker compose -f docker-compose.local.yml up --build
```

Контейнер `bot` перед стартом выполняет:

```bash
bun run src/db/migrate.ts
bun run src/main.ts
```

> 💡 Docker-образ собирается на `oven/bun:1.3-alpine` из зафиксированного `bun.lock` — никаких сюрпризов с версиями.

---

## ⚙️ Конфигурация

Все переменные читаются через `loadSettings()` (см. `src/config.ts`). Образец — в `.env.example`:

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

### Параметры функций

| Переменная                   | По умолчанию | Описание                                                                |
| ---------------------------- | ------------ | ----------------------------------------------------------------------- |
| `THREAD_UNROLL_ENABLED`      | `true`       | Разворачивать цепочку самоответов в один пост                           |
| `THREAD_MAX_TWEETS`          | `10`         | Максимум постов в треде (включая исходный)                              |
| `NEGATIVE_CACHE_TTL_SECONDS` | `600`        | Сколько помнить удалённые/ненайденные посты, чтобы не дёргать провайдер |
| `RATE_LIMIT_ENABLED`         | `true`       | Ограничивать число запросов на пользователя (админы — без лимита)       |
| `RATE_LIMIT_MAX_REQUESTS`    | `20`         | Сколько запросов разрешено в окне до сообщения «помедленнее»            |
| `RATE_LIMIT_WINDOW_SECONDS`  | `60`         | Длина окна рейт-лимита                                                  |

### Режим работы

По умолчанию бот работает в режиме **long polling** (`POLLING_ENABLED=true`).
Для прода за HTTPS можно переключиться на **webhook**:

```env
POLLING_ENABLED=false
WEBHOOK_URL=https://bot.example.com/telegram
WEBHOOK_SECRET=длинная-случайная-строка
WEBHOOK_PORT=8080
```

Бот поднимает webhook через `Bun.serve` на `WEBHOOK_PORT` (или `$PORT`),
проверяет заголовок Telegram `X-Telegram-Bot-Api-Secret-Token` против
`WEBHOOK_SECRET`, регистрирует webhook при старте и отдаёт `GET /health`.

### Провайдеры твитов

| Провайдер       | Описание                                                                                             | Требуется                 |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| `fake`          | Детерминированный dev-провайдер без обращения к X/Twitter                                            | —                         |
| `public_embed`  | Публичные FxTwitter / VxTwitter card endpoints с fallback на Twitter oEmbed без токенов и аккаунтов  | —                         |
| `external_http` | Внешний сервис `GET /tweets/{tweet_id}`, возвращающий JSON модели `TweetData` или `{ "tweet": ... }` | `TWEET_PROVIDER_BASE_URL` |
| `x_api`         | Официальный X API v2                                                                                 | `X_BEARER_TOKEN`          |

### Доступ к боту

| Значение `ACCESS_WHITELIST_ENABLED` | Поведение                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `true`                              | Доступ только для админов и пользователей из whitelist                                          |
| `false`                             | Бот открыт для всех пользователей; админские команды по-прежнему доступны только из `ADMIN_IDS` |

---

## 💻 Локальный запуск

Установите [Bun](https://bun.sh/), если он ещё не установлен:

```bash
# Linux / macOS
curl -fsSL https://bun.sh/install | bash
```

```powershell
# Windows PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Запустите бота:

```bash
bun install
bun run src/db/migrate.ts
bun run start
```

Полезные скрипты:

```bash
bun run test          # vitest
bun run typecheck     # tsc --noEmit
bun run lint          # eslint
bun run format        # prettier --write
```

---

## 📜 Команды

### 👤 Пользовательские

| Команда  | Назначение                   |
| -------- | ---------------------------- |
| `/start` | Приветствие и статус доступа |
| `/help`  | Краткая инструкция           |
| `/id`    | Telegram ID пользователя     |

### 🛡️ Администраторские

| Команда                | Назначение                         |
| ---------------------- | ---------------------------------- |
| `/allow <telegram_id>` | Добавить пользователя в whitelist  |
| `/deny <telegram_id>`  | Убрать пользователя из whitelist   |
| `/users`               | Список разрешённых пользователей   |
| `/stats`               | Общая статистика и топы            |
| `/stats <telegram_id>` | Статистика отдельного пользователя |
| `/health`              | Проверка БД и провайдера           |

---
