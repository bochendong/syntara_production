# Prisma migration baseline and rollout

This repository historically used `prisma/schema.prisma` without a checked-in
Prisma migration history. The migration history now has two deliberately
separate steps:

1. `20260723070000_legacy_schema_baseline` describes the legacy schema before
   `CourseSource`, `KnowledgeDocument`, and `KnowledgeChunk`.
2. `20260723080000_add_course_source_knowledge_search` only adds those three
   tables, their relations, search indexes, and lightweight staleness triggers
   on searchable public business content.

The historical baseline and course-source migrations do not rewrite business
rows. A later, narrow repair migration backfills only the denormalized
`Course.notebookCount` value so course-list reads can stay constant-size
without returning stale legacy counts. The staleness triggers only react to
future content changes so incomplete projections fall back to live
business-table reads.

The development database applied
`20260730010000_repair_course_notebook_counts` on 2026-07-30. Treat its
counter parity as a release gate and re-run it before deployment:

```bash
pnpm db:verify:course-notebook-counts
```

The verifier checks the completed migration row, the enabled Notebook trigger,
all stored-vs-authoritative course counts, and an insert/delete trigger probe
inside a transaction that is always rolled back.

After this migration, the database trigger is the only runtime writer for
`Course.notebookCount`. `refreshCourseSummaryFields` deliberately refreshes
the other denormalized fields without rewriting this counter, so a stale
aggregate cannot overwrite a concurrent trigger increment.

## Existing database

Take a database backup and verify that the deployed legacy schema matches the
baseline before rollout. Then mark **only** the legacy baseline as already
applied:

```bash
pnpm exec prisma migrate resolve \
  --applied 20260723070000_legacy_schema_baseline
```

After that marker succeeds, apply the additive migration:

```bash
pnpm exec prisma migrate deploy
```

Do not mark the additive migration as applied before its tables exist. Do not
execute the baseline SQL against an existing populated database: it contains
the `CREATE TABLE` statements that describe objects already present there.

`CREATE EXTENSION vector` and `CREATE EXTENSION pg_trgm` may require a database
role allowed to enable extensions. Managed PostgreSQL environments should
enable pgvector and pg_trgm before `migrate deploy` if the deploy role lacks
that permission.

## Fresh database

A fresh database can run both migrations in order:

```bash
pnpm exec prisma migrate deploy
```

The baseline creates the legacy objects and pgvector-backed
`StudyMemoryChunk`; the additive migration then creates the new projection.

## Application rollout

The source-library reader has an explicit transition mode:

- `COURSE_SOURCE_CATALOG_READ_MODE=dual` is the default, including when the
  variable is unset or invalid. It reads `CourseSource` and the legacy source
  tables in parallel, deduplicates by `sourceHash`, keeps catalog lifecycle
  state and errors authoritative, and merges legacy artifact IDs. A partially
  backfilled course therefore keeps showing its older uploads.
- `COURSE_SOURCE_CATALOG_READ_MODE=catalog` is the post-migration fast path.
  When the catalog table exists, an empty catalog is treated as a real empty
  result and the legacy aggregate is not queried. The normal `/learn`
  `includeText=0` request performs one catalog data query after course-access
  resolution. A full-text source detail may still hydrate its Markdown
  sections separately.

Both modes safely fall back to legacy aggregation when the `CourseSource` table
or its expected columns are not installed. This is a deployment guard, not a
substitute for applying the migration.

Deploy the dual-read code before, or together with, the additive migration.
Keep the read mode unset or explicitly set to `dual` while uploads are dual
written and existing courses are backfilled.

All maintenance commands are read-only unless `--apply` is present:

```bash
# 1. Inspect source/document/chunk counts without writing.
pnpm db:course-knowledge:backfill

# 2. Backfill one local course, then verify it in the application.
pnpm db:course-knowledge:backfill -- --course-id=<course-id> --apply

# 3. Backfill all courses only after the per-course check succeeds.
pnpm db:course-knowledge:backfill -- --apply

# 4. Optionally enrich the ready lexical projection with semantic embeddings.
pnpm db:course-knowledge:reindex
pnpm db:course-knowledge:reindex -- --apply --limit=500
```

The backfill marks the lexical projection ready even when no embedding provider
is configured; semantic retrieval is an optional enrichment. Each course is
written in one transaction under the same advisory lock used by runtime
projection rebuilds. The script rechecks its legacy snapshot before commit,
rolls back on concurrent change, and updates only catalog rows previously
created by this legacy recovery path; it never overwrites a normal ingestion
record or broadly prunes runtime-owned projections. If reindexing is enabled,
repeat the last apply command until `pendingSelected` is `0`. A non-local
database additionally requires the explicit
`ALLOW_REMOTE_COURSE_KNOWLEDGE_MIGRATION=1` safety acknowledgement (or the
equivalent long CLI flag). Back up and verify the target before using it.

After backfill, verify source-count parity and search coverage for every course
while still in `dual` mode. Then switch the deployed application to:

```bash
COURSE_SOURCE_CATALOG_READ_MODE=catalog
```

Verify `/learn` source loading, source detail, deletion, and AI retrieval after
the switch. To roll the read path back without changing the schema, unset the
variable or set it to `dual`; legacy rows remain intact. Rolling application
code back is also safe because the migration does not remove or rewrite legacy
data, and unused projection tables can remain in place.

## Course conversation cutover

`20260730020000_add_course_conversation_store` moves scoped `/learn`
conversations out of the generic `Conversation` / `Message` tables and into
`CourseConversation` / `CourseConversationMessage`.

Run the read-only preflight immediately before deployment:

```bash
pnpm exec dotenv -e .env.local -- \
  node scripts/maintenance/preflight-course-conversation-migration.mjs
```

The migration takes write locks on the legacy rows it copies, canonicalizes a
duplicate session by client revision and activity time, remaps
conversation-scoped facts/events and course-question runs, and verifies their
owner/course/session identity before adding foreign keys. Unscoped legacy
`learn:*` rows with no `courseId` are retained in the generic store and
reported as a warning; the migration never guesses their course.

This is a direct cutover, not a long-lived dual-write mode. Deploy the schema
migration and the application reader/writer switch together. The copied legacy
rows remain intact for forensic rollback, but runtime course conversation,
AI-history, admin, memory-scope, and native-export reads use the dedicated
store. Detail reads return the latest 30 messages plus a sequence cursor;
`summary` is currently a nullable projection reserved for a later compaction
worker.
