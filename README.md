<div align="center">

# 🐦 Xtract Bot

**Telegram-бот для удобного шеринга постов из X / Twitter прямо в Telegram**

Отправьте ссылку на пост — бот вытащит текст и медиа через изолированный `TweetProvider`,
закеширует результат в PostgreSQL и вернёт аккуратно оформленное сообщение.

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

- 🔗 **Поддержка ссылок** `x.com`, `twitter.com`, `mobile.twitter.com`, `vxtwitter.com`
- 🧩 **Парсинг** `/status/<id>` и `/statuses/<id>`
- 🔐 **Whitelist пользователей** и администраторы из `ADMIN_IDS`
- 💬 **Команды** `/start`, `/help`, `/id`, `/allow`, `/deny`, `/users`, `/stats`, `/health`
- ⚡ **Inline-режим** с быстрым ответом «Загрузка…» и последующим редактированием
- 🗄️ **Кеш** успешных ответов в PostgreSQL с настраиваемым TTL
- 🐳 **Docker Compose** с PostgreSQL и Alembic-миграциями из коробки
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
docker compose up --build
```

Контейнер `bot` перед стартом выполняет:

```bash
alembic upgrade head
python -m app.main
```

> 💡 Docker-образ собирается через `uv sync --frozen --no-dev` и `uv.lock` — никаких сюрпризов с версиями.

---

## ⚙️ Конфигурация

Все переменные читаются через `pydantic-settings`. Образец — в `.env.example`:

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

### Провайдеры твитов

| Провайдер        | Описание                                                                                              | Требуется                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| `fake`           | Детерминированный dev-провайдер без обращения к X/Twitter                                             | —                               |
| `public_embed`   | Публичные FxTwitter / VxTwitter card endpoints с fallback на Twitter oEmbed без токенов и аккаунтов   | —                               |
| `external_http`  | Внешний сервис `GET /tweets/{tweet_id}`, возвращающий JSON модели `TweetData` или `{ "tweet": ... }`  | `TWEET_PROVIDER_BASE_URL`       |
| `x_api`          | Официальный X API v2                                                                                  | `X_BEARER_TOKEN`                |

### Доступ к боту

| Значение `ACCESS_WHITELIST_ENABLED` | Поведение                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `true`                              | Доступ только для админов и пользователей из whitelist                                             |
| `false`                             | Бот открыт для всех пользователей; админские команды по-прежнему доступны только из `ADMIN_IDS`    |

---

## 💻 Локальный запуск

Установите [`uv`](https://github.com/astral-sh/uv), если он ещё не установлен:

```bash
# Linux / macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```powershell
# Windows PowerShell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Запустите бота:

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run python -m app.main
```

---

## 📜 Команды

### 👤 Пользовательские

| Команда   | Назначение                          |
| --------- | ----------------------------------- |
| `/start`  | Приветствие и статус доступа        |
| `/help`   | Краткая инструкция                  |
| `/id`     | Telegram ID пользователя            |

### 🛡️ Администраторские

| Команда                  | Назначение                                  |
| ------------------------ | ------------------------------------------- |
| `/allow <telegram_id>`   | Добавить пользователя в whitelist           |
| `/deny <telegram_id>`    | Убрать пользователя из whitelist            |
| `/users`                 | Список разрешённых пользователей            |
| `/stats`                 | Общая статистика и топы                     |
| `/stats <telegram_id>`   | Статистика отдельного пользователя          |
| `/health`                | Проверка БД и провайдера                    |

---
