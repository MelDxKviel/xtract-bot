# 🤝 Contributing Guide

Thank you for your interest in **Xtract Bot**! Any contribution — from fixing typos
to implementing new features — is welcome. This document will help you get started quickly.

> 📜 Before you begin, please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
> Report vulnerabilities following [SECURITY.md](SECURITY.md), not in public issues.

---

## 📋 Table of Contents

- [Ways to help](#-ways-to-help)
- [Setting up the environment](#-setting-up-the-environment)
- [Workflow](#-workflow)
- [Code style](#-code-style)
- [Tests](#-tests)
- [Commits](#-commits)
- [Pull Request](#-pull-request)
- [Creating an issue](#-creating-an-issue)

---

## 💡 Ways to Help

- 🐛 Report a bug via an issue with reproduction steps.
- ✨ Suggest a new feature or improvement.
- 📝 Improve documentation (README, comments, examples).
- 🧪 Add test coverage.
- 🧩 Implement a new `TweetProvider` or improve existing ones.
- 🌍 Help with documentation translations.

---

## 🛠 Setting Up the Environment

Requirements: Python 3.12+, Docker (optional), `uv`.

```bash
# 1. Fork the repository and clone your fork
git clone https://github.com/<your-username>/xtract-bot.git
cd xtract-bot

# 2. Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 3. Install dependencies including dev tools
uv sync --extra dev

# 4. Prepare .env
cp .env.example .env
# edit BOT_TOKEN etc.

# 5. Start Postgres (e.g. via docker compose)
docker compose up -d postgres

# 6. Apply migrations
uv run alembic upgrade head

# 7. Run the bot
uv run python -m app.main
```

> 💡 For development it is convenient to use `TWEET_PROVIDER=fake` —
> no live X/Twitter credentials are needed.

---

## 🔄 Workflow

1. **Find or create an issue** — discuss the idea before starting large work.
2. **Fork** the repository and create a branch:
   ```bash
   git checkout -b feature/short-description
   # or
   git checkout -b fix/short-description
   ```
3. **Make changes** in small, atomic commits.
4. **Run checks** locally (see below).
5. **Open a Pull Request** to `main` with a clear description.

### Branch naming conventions

| Prefix        | Purpose                            | Example                              |
| ------------- | ---------------------------------- | ------------------------------------ |
| `feature/`    | New functionality                  | `feature/inline-media-group`         |
| `fix/`        | Bug fix                            | `fix/cache-ttl-overflow`             |
| `docs/`       | Documentation                      | `docs/provider-comparison`           |
| `refactor/`   | Refactoring without behavior change| `refactor/extract-tweet-formatter`   |
| `test/`       | Tests only                         | `test/public-embed-fallback`         |
| `chore/`      | Build, CI, dependencies            | `chore/bump-aiogram`                 |

---

## 🎨 Code Style

The project uses [`ruff`](https://docs.astral.sh/ruff/) for both linting and formatting.

```bash
uv run ruff check .          # lint
uv run ruff check . --fix    # auto-fix
uv run ruff format .         # format
uv run ruff format --check . # check without changes (as in CI)
```

Additional guidelines:

- 🐍 Target Python version — **3.12** (see `pyproject.toml`).
- 📏 Line length — **100** characters.
- 📦 Imports are sorted automatically (ruff `I` rule).
- 🧠 Use full type hints for public functions and methods.
- 🏷️ Names in English, descriptive; avoid abbreviations.
- 🚫 Do not add code-translation comments; only explain non-obvious "why".

---

## 🧪 Tests

Uses `pytest` + `pytest-asyncio` (`asyncio_mode = "auto"`).

```bash
uv run pytest                       # all tests
uv run pytest tests/test_foo.py     # single file
uv run pytest -k "embed"            # filter by substring
uv run pytest -x --ff               # stop on first failure, start from failed
```

Test checklist:

- ✅ New logic — new tests.
- ✅ Found a bug — write a reproducing test first, then fix.
- ✅ Do not make network requests in unit tests; mock external providers.
- ✅ `arrange / act / assert` structure is encouraged.

---

## 📝 Commits

[Conventional Commits](https://www.conventionalcommits.org/) are recommended (but not strictly required):

```
<type>(<scope>): <short imperative description>

[optional body]

[optional footer, e.g. "Closes #123"]
```

Common `type` values:

| Type       | When to use                              |
| ---------- | ---------------------------------------- |
| `feat`     | New functionality                        |
| `fix`      | Bug fix                                  |
| `docs`     | Documentation only                       |
| `refactor` | Refactoring without behavior change      |
| `perf`     | Performance improvement                  |
| `test`     | Tests                                    |
| `chore`    | Build, dependencies, configs             |
| `ci`       | CI/CD changes                            |

Examples:

```
feat(providers): add x_api v2 fallback to public_embed
fix(bot): handle InlineQuery without source link
docs(readme): document TWEET_CACHE_TTL_SECONDS
```

---

## 🚀 Pull Request

Before opening a PR, make sure:

- [ ] Branch is based off a fresh `main`.
- [ ] `uv run ruff check .` — no errors.
- [ ] `uv run ruff format --check .` — no changes needed.
- [ ] `uv run pytest` — all tests green.
- [ ] Documentation (README, .env.example) updated if necessary.
- [ ] Tests added / updated for new logic.
- [ ] PR title is short and descriptive.
- [ ] Description explains what and why is changed, with linked issues (`Closes #N`).

After creating the PR:

1. Wait for green CI (`Lint`, `Test`).
2. Respond to review comments and push fixes to the same branch.
3. **Avoid `force push` after review starts** — it breaks discussion anchors.

---

## 🐛 Creating an Issue

### Bug report

Include:

- Version / commit where the issue reproduces.
- Provider in use (`TWEET_PROVIDER=...`).
- Reproduction steps.
- Expected and actual behavior.
- Relevant logs (with `LOG_LEVEL=DEBUG` if possible).
- Environment: OS, Python, Docker / native run.

### Feature request

Describe:

- The problem the feature solves.
- Proposed solution and alternatives.
- Willingness to implement it yourself (if applicable).

---

## 🙏 Thank You

Every PR, issue, typo fix, and idea makes Xtract Bot better.
If something is unclear — open an issue with the `question` label
and we will help you out.

Happy hacking! 🚀
