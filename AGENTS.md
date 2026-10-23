# AGENTS.md

## Repository map

Syntara is a pnpm workspace with a Next.js 16 web app at the repository root, a
React/Vite/Tauri app in `apps/native`, and internal packages in
`packages/mathml2omml` and `packages/pptxgenjs`.

- `app/`: web routes and API handlers; `app/(qa)/test/`: browser QA pages.
- `components/`, `features/`, `lib/`: shared UI, feature modules, and utilities/server code.
- `prisma/`: PostgreSQL schema and migrations for Web Learn/Course/Auth persistence.
- `apps/native/`: native app, browser IndexedDB and native SQLite repositories;
  see `apps/native/README.md` for desktop/mobile setup.
- `scripts/maintenance/`, `scripts/learn/`: contract, runtime, and scenario checks.
- `artifacts/`: design experiments and generated assets, not the main application.

## Preserve ongoing work

Use one worktree and one `codex/<task>` branch per task. Before editing, inspect
`git worktree list`, `git branch --show-current`, and `git status --short` (or run
`pnpm workspace:status` when available). Reuse this chat's suitable attached
worktree; otherwise create a managed Codex worktree from `main` or another
explicitly selected reviewed commit, then use its returned directory for all
task commands. Create a task branch if the managed worktree starts detached.

The original checkout on `codex/shared-wip-*` is a legacy preservation area.
Its pending changes have mixed, unassigned origins. Keep new feature work in
separate worktrees. Do not copy the whole shared working tree into a new task,
or base an ordinary PR on a mixed WIP snapshot. Migrate needed changes explicitly
and record their source and scope. Historical attribution requires evidence;
filenames and timestamps do not establish authorship.

For environment/bootstrap changes that must also be available in the original
checkout, first implement and verify them in the task worktree, then copy only
those named tooling files back and record the sync in the local workspace
registry. See `WORKTREES.md` for the checkpoint and recovery procedure.

`pnpm workspace:guard` installs a local pre-commit guard without replacing custom
hooks. It protects `main`, detached HEADs, and the legacy shared checkout. Use
`SYNTARA_ALLOW_SHARED_COMMIT=1` only for an explicitly authorized integration or
legacy migration, never as a routine workaround.

Check `git status --short` before editing. This checkout may contain unrelated
changes from the user or other chats. Preserve them; do not reset, clean, stash,
stage, or commit unrelated files. Inspect the existing diff before editing a
dirty file and make the smallest necessary patch. Do not run repository-wide
formatting to fix a task-specific issue.

## Cross-computer handoff

Read `CONTRIBUTING.md` and `CURRENT_STATE.md` before continuing
work from another machine. Verify the remote branch and commit; a deployed site
or a local checkpoint is not evidence that its source has been pushed. Record
the task branch, verification, remaining work, and deployment commit in its PR
or Issue when handing off. Preserve a user's no-commit restriction and explicitly
report any local-only changes. Do not send handoff messages without user authorization.

## Setup and development

Use Node.js 22 (`.nvmrc`) and pnpm 10.28.0 (`packageManager`).

```bash
pnpm install
pnpm db:generate
pnpm exec next typegen
pnpm dev
```

`postinstall` builds both internal packages. If it fails, run `npm run build`
inside each package. Prisma client generation is needed even for checks that
import server modules without connecting to a database. On a fresh checkout,
`pnpm exec next typegen` also generates the ignored Next.js image and route
declarations needed by the root typecheck; no database or AI request is required.

If `.env.local` is missing, copy `.env.example` and configure only the services
needed for the task. Preserve existing environment files and never print or
commit secrets. Web Learn/Course/Auth flows generally require PostgreSQL;
starting the server without a database does not make those flows local-first.
`/create?courseId=...` redirects into the course notebook creation route; it is
not a database bypass.

`pnpm dev` starts Next.js on port 3000 and **also starts the AI background worker
when `DATABASE_URL` is set**. For a web-only server without the worker, use
`pnpm exec next dev --webpack`. Native test server overrides depend on the checkout;
inspect its package scripts, `.env.example`, and `apps/native/README.md` before use.

AI generation needs an appropriately configured provider. Model selection can
come from server configuration and environment variables; inspect
`lib/server/system-llm-config.ts` and `.env.example` rather than assuming a model.
Local demo authentication requires `SYNTARA_ALLOW_DEMO_AUTH=1`, a development
server on loopback, and a configured auth secret. Missing OAuth configuration
alone does not enable it; see `lib/server/auth.ts`.

## Local verification

```bash
pnpm verify:local                       # format + lint local changes, then typecheck
pnpm verify:local --list                # JSON list of selected files; no checks
pnpm verify:local --skip-types          # format + lint only
pnpm verify:local --skip-types -- app/path.tsx scripts/path.mjs
node --test scripts/maintenance/verify-local-changes.test.mjs
node --test scripts/maintenance/workspace.test.mjs
```

`verify:local` checks the current on-disk contents of staged, unstaged, and
untracked files, deduplicates paths, and skips deleted files, symlinks,
Git-ignored untracked files, dependency directories, and build output. Optional
pathspecs are relative to the repository root. Prettier and ESLint retain their
own ignore rules; unsupported formats are skipped. It never fixes files, stages
changes, loads environment files, starts services, or calls the database/AI.

TypeScript checks the full root project, not just changed files, with incremental
output disabled. If selected files include native TypeScript, it also checks the
native app and Vite configs. Root TypeScript currently includes native files,
so report unrelated failures separately rather than silently
ignoring them. Pathspecs narrow format/lint selection, not the root typecheck.
The local command checks the whole selected working tree, including others'
pending changes; it does not identify which chat authored a change.

Standalone prototypes and generated QA/export output under `artifacts/` are
excluded from root Prettier, ESLint, and TypeScript checks. Use a prototype's own
instructions and package scripts when editing it. Nested `node_modules/`
directories are Git-ignored; keep prototype source and generated design assets.

CI uses `pnpm check:changed -- BASE_SHA` and `pnpm lint:changed -- BASE_SHA` for
committed changes (`BASE_SHA...HEAD`), followed by the full root typecheck. Those
two CI helpers do **not** include uncommitted or untracked files. See
`.github/workflows/ci.yml`. Full-repository checks are available as `pnpm check`,
`pnpm lint`, and `pnpm exec tsc --noEmit`.

## Feature verification

There are automated contract/runtime checks using Node assertions and other
local runners; the absence of Jest/Vitest does not mean there are no tests.
Use `package.json` for available `test:*` commands and inspect the relevant
script before running it. Useful entry points include:

- Course/chat/memory: `test:course-answer-contracts`,
  `test:course-chat-unified`, `test:learn-core-contracts`.
- Problem import/grading: `test:problem-import-assessment-compiler`,
  `test:code-submission`, `test:python-code-runner`.
- Native local data: `native:verify`, `native:verify:platform-access`.
- Browser flows: `/test` and the applicable feature route.

Run affected offline checks directly. API scenarios, `/test` flows, AI smoke
tests (`test:image-gen`, `test:tts-gen`), and data maintenance scripts can use
real services or write data; establish their target and effects before running.
Use disposable local fixtures for verification. A source-text contract check
does not establish that the corresponding browser/API flow works end to end.

Report checks run, failures, and unverified behavior accurately. Existing
lint/format/type failures may exist; compare against the task's diff before
attributing them. Do not dismiss a new failure as pre-existing without evidence.
