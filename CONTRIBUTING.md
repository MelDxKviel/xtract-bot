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

Requirements: [Bun](https://bun.sh/) 1.1+, Docker (optional).

```bash
# 1. Fork the repository and clone your fork
git clone https://github.com/<your-username>/xtract-bot.git
cd xtract-bot

# 2. Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# 3. Install dependencies including dev tools
bun install

# 4. Prepare .env
cp .env.example .env
# edit BOT_TOKEN etc.

# 5. Start Postgres (e.g. via docker compose)
docker compose up -d postgres

# 6. Apply migrations
bun run src/db/migrate.ts

# 7. Run the bot
bun run start
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

| Prefix      | Purpose                             | Example                            |
| ----------- | ----------------------------------- | ---------------------------------- |
| `feature/`  | New functionality                   | `feature/inline-media-group`       |
| `fix/`      | Bug fix                             | `fix/cache-ttl-overflow`           |
| `docs/`     | Documentation                       | `docs/provider-comparison`         |
| `refactor/` | Refactoring without behavior change | `refactor/extract-tweet-formatter` |
| `test/`     | Tests only                          | `test/public-embed-fallback`       |
| `chore/`    | Build, CI, dependencies             | `chore/bump-grammy`                |

---

## 🎨 Code Style

The project uses [ESLint](https://eslint.org/) for linting and [Prettier](https://prettier.io/) for formatting.

```bash
bun run lint           # lint
bun run lint -- --fix  # auto-fix
bun run format         # format
bun run format:check   # check without changes (as in CI)
bun run typecheck      # tsc --noEmit
```

Additional guidelines:

- 🟦 TypeScript with `strict: true` and `noUncheckedIndexedAccess`.
- 📏 Line length — **100** characters (Prettier).
- 🧠 Prefer explicit return types on exported functions.
- 🏷️ Names in English, descriptive; avoid abbreviations.
- 🚫 Do not add code-translation comments; only explain non-obvious "why".

---

## 🧪 Tests

Uses [Vitest](https://vitest.dev/).

```bash
bun run test                        # all tests
bun run test tests/urls.test.ts     # single file
bun run test -- -t "embed"          # filter by name pattern
bun run test:watch                  # watch mode
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

| Type       | When to use                         |
| ---------- | ----------------------------------- |
| `feat`     | New functionality                   |
| `fix`      | Bug fix                             |
| `docs`     | Documentation only                  |
| `refactor` | Refactoring without behavior change |
| `perf`     | Performance improvement             |
| `test`     | Tests                               |
| `chore`    | Build, dependencies, configs        |
| `ci`       | CI/CD changes                       |

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
- [ ] `bun run typecheck` — no errors.
- [ ] `bun run lint` — no errors.
- [ ] `bun run format:check` — no changes needed.
- [ ] `bun run test` — all tests green.
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
- Environment: OS, Bun / Node version, Docker / native run.

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
