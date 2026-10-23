# Syntara Production

Production baseline of Syntara, migrated from OpenMAIC.

Working from another computer? Read [the sync workflow](CONTRIBUTING.md) and
[the current branch / deployment snapshot](CURRENT_STATE.md) before starting.

## Included product surface

- `/` — marketing home
- `/learn` — learner home + course workspace
- `/course/*`, `/my-courses`, `/classroom/*` — course & notebook flow
- `/practice/*`, `/review/*`, `/calendar` — learn satellites
- `/login`, `/register` — auth
- `/test` — platform QA test center
- NextAuth, Prisma schema/migrations, and the API/server layer those pages need

## Prerequisites

- Node.js 22 (`.nvmrc`)
- [pnpm](https://pnpm.io/) 10.28.0 (`packageManager`)
- PostgreSQL (for Learn / Course / Auth persistence)

## Setup

```bash
cp .env.example .env.local
# Fill at least:
#   DATABASE_URL=
#   NEXTAUTH_URL=http://localhost:3000
#   NEXTAUTH_SECRET=   # openssl rand -base64 32
#   OPENAI_API_KEY=    # or another configured LLM provider

pnpm install
pnpm db:generate
pnpm exec next typegen
# Optional against a real DB:
# pnpm db:migrate
# or: pnpm db:push

pnpm dev
```

Open:

- http://localhost:3000/
- http://localhost:3000/learn
- http://localhost:3000/test

## Notes

- Do not commit `.env.local` or `server-providers.yml` (they can contain secrets).
- Live2D page assets and several non-core marketing/admin routes were intentionally omitted from this baseline; shared components they depend on may still exist for Learn/Stage.
- `/test` Phase 1–2 scenarios call production Learn/Course APIs and use fixtures under `data/` and `queue/CSC148/`.
