# Xtract Bot

Telegram-бот для удобного шеринга постов из X/Twitter внутри Telegram. Пользователь отправляет ссылку на пост, бот получает данные через изолированный `TweetProvider`, кеширует результат в PostgreSQL и возвращает аккуратно оформленное Telegram-сообщение.

## Возможности MVP

- Поддержка ссылок `x.com`, `twitter.com`, `mobile.twitter.com`, `vxtwitter.com`.
- Парсинг `/status/<id>` и `/statuses/<id>`.
- Whitelist пользователей и администраторы из `ADMIN_IDS`.
- Команды `/start`, `/help`, `/id`, `/allow`, `/deny`, `/users`, `/stats`, `/health`.
- Inline-режим с быстрым результатом `Загрузка...` и последующим редактированием сообщения.
- Кеш успешных ответов в PostgreSQL.
- Docker Compose с PostgreSQL и Alembic-миграциями.

## Создание бота

1. Откройте BotFather в Telegram.
2. Выполните `/newbot` и сохраните токен в `BOT_TOKEN`.
3. Для inline-режима выполните `/setinline`, выберите бота и задайте placeholder.

## Конфигурация

Создайте `.env` на основе `.env.example`:

```env
BOT_TOKEN=123456:replace-me
DATABASE_URL=postgresql+asyncpg://xtract:xtract@postgres:5432/xtract
ADMIN_IDS=123456789,987654321
TWEET_PROVIDER=public_embed
TWEET_CACHE_TTL_SECONDS=86400
TWEET_PROVIDER_TIMEOUT_SECONDS=10
LOG_LEVEL=INFO
POLLING_ENABLED=true
```

Провайдеры:

- `fake` - детерминированный dev-provider без обращения к X/Twitter.
- `public_embed` - публичные embed/oEmbed endpoints Twitter без токенов, cookies и аккаунтов. Работает только с публичными постами и зависит от доступности embed-страниц.
- `external_http` - внешний сервис `GET /tweets/{tweet_id}`, возвращающий JSON модели `TweetData` или `{ "tweet": TweetData }`.
- `x_api` - официальный X API v2, требует `X_BEARER_TOKEN`.

## Запуск через Docker Compose

Docker-образ собирается через `uv sync --frozen --no-dev` и `uv.lock`

```bash
docker compose up --build
```

Контейнер `bot` перед стартом выполняет:

```bash
alembic upgrade head
python -m app.main
```

## Локальный запуск

Установите `uv`, если он еще не установлен:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Для Windows PowerShell:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run python -m app.main
```

## Команды

Пользовательские:

- `/start` - приветствие и статус доступа.
- `/help` - краткая инструкция.
- `/id` - Telegram ID пользователя.

Администраторские:

- `/allow <telegram_id>` - добавить пользователя в whitelist.
- `/deny <telegram_id>` - убрать пользователя из whitelist.
- `/users` - список разрешенных пользователей.
- `/stats` - общая статистика и топы.
- `/stats <telegram_id>` - статистика пользователя.
- `/health` - проверка БД и провайдера.

## Ограничения

- Inline-режим отправляет текст, ссылку на оригинал и ссылку на первое медиа, без media group.
- В личном чате бот отправляет до 10 медиа; лишние медиа отмечаются в тексте.
- `public_embed` не обходит авторизацию и не достает приватные, удаленные, age-restricted или geo-restricted посты.
- Реальная доступность постов зависит от выбранного провайдера и ограничений X/Twitter.
- Webhook-переменные зарезервированы, MVP по умолчанию работает в polling-режиме.

## Тесты и линтинг

```bash
uv run pytest
uv run ruff check .
uv run ruff format .
```
