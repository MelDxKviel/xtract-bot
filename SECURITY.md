# 🔐 Security Policy

Thank you for caring about the security of **Xtract Bot**! This document describes
how to report a vulnerability and which versions are supported.

## Supported Versions

Only the latest version from the `main` branch is supported under the MVP scope.
Security fixes are released in the next minor or patch releases.

| Version   | Support                  |
| --------- | ------------------------ |
| `main`    | ✅ actively supported    |
| `< 0.1.0` | ❌ not supported         |

## Reporting a Vulnerability

> ⚠️ **Please do not create public issues for vulnerabilities.**
> Public disclosure before a fix is released puts users at risk.

Use one of the private channels:

1. **GitHub Security Advisories** — the preferred path:
   open a new advisory at
   [Security → Report a vulnerability](https://github.com/MelDxKviel/xtract-bot/security/advisories/new).
2. **Email** — send a report to the maintainer via the email
   listed in their GitHub profile, with the subject `[xtract-bot][security] <brief description>`.

Include in your report:

- Affected version or commit.
- Detailed description of the vulnerability and potential impact.
- Reproduction steps, minimal proof-of-concept (if possible).
- Your contact details for follow-up questions.
- Desired credit in the advisory (name / handle / organization) or a request to remain anonymous.

## What Happens After a Report

| Timeline     | Action                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| **48 hours** | Acknowledgement of receipt                                                 |
| **7 days**   | Initial assessment: confirmation, severity, action plan                    |
| **30 days**  | Target fix release for High/Critical severity issues                       |
| **On fix**   | Public advisory, reporter credit (if agreed), and changelog entry         |

If the vulnerability affects dependencies (aiogram, SQLAlchemy, Alembic, asyncpg, httpx, etc.),
we will coordinate disclosure with upstream projects.

## Scope

In scope:

- Code in this repository (`app/`, `migrations/`, `Dockerfile`, `docker-compose.yml`).
- CI/CD configurations (`.github/workflows/`).
- Documentation that could mislead users on security matters.

Out of scope:

- Vulnerabilities in public FxTwitter / VxTwitter / X API endpoints — report those upstream.
- Attacks requiring physical or administrative access to the user's server.
- Social engineering targeting maintainers.

## Self-Hosting Best Practices

- 🔑 **Never** commit `.env`, `BOT_TOKEN`, `X_BEARER_TOKEN`,
  `WEBHOOK_SECRET`, `TWEET_PROVIDER_API_KEY`, or any other secrets.
- 🛡️ Restrict Postgres access to the `bot` service or a private network only.
- 👥 Use `ACCESS_WHITELIST_ENABLED=true` and a narrow `ADMIN_IDS` list in production.
- 🔄 Regularly update dependencies (`uv lock --upgrade`) and the base Docker image.
- 📜 Enable structured logs (`LOG_LEVEL=INFO` or higher) and collect them centrally.

Thank you for responsible disclosure! 🙏
