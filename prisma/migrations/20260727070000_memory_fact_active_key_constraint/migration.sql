BEGIN;

-- Active teaching facts use NULL scope ids for user scope. A regular compound
-- unique constraint treats NULL values as distinct, so keep the normalized
-- scope id in a migration-owned partial index instead of rebuilding schema on
-- the first memory write of every server process.
CREATE UNIQUE INDEX IF NOT EXISTS "MemoryFact_active_key_idx"
ON "MemoryFact" (
  "ownerId",
  "scopeType",
  COALESCE("scopeId", ''),
  "namespace",
  "key"
)
WHERE "status" = 'active';

COMMIT;
