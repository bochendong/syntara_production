# Prisma migration baseline and rollout

This repository historically used `prisma/schema.prisma` without a checked-in
Prisma migration history. The migration history now has two deliberately
separate steps:

1. `20260723070000_legacy_schema_baseline` describes the legacy schema before
   `CourseSource`, `KnowledgeDocument`, and `KnowledgeChunk`.
2. `20260723080000_add_course_source_knowledge_search` only adds those three
   tables, their relations, search indexes, and lightweight staleness triggers
   on searchable public business content.

No migration backfills data or rewrites an existing business row. The
staleness triggers only react to future content changes so incomplete
projections fall back to live business-table reads.

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
