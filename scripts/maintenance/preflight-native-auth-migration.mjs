import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

if (
  process.env.DATABASE_URL.includes('proxy.rlwy.net') &&
  !process.env.DATABASE_URL.includes('sslmode=')
) {
  process.env.DATABASE_URL += process.env.DATABASE_URL.includes('?')
    ? '&sslmode=require'
    : '?sslmode=require';
}

const prisma = new PrismaClient();

try {
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT "migration_name",
           "finished_at" IS NOT NULL AS "finished",
           "rolled_back_at" IS NOT NULL AS "rolledBack"
    FROM "_prisma_migrations"
    ORDER BY "started_at"
  `);
  const duplicateGroups = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "count"
    FROM (
      SELECT 1
      FROM "MemoryFact"
      WHERE "status" = 'active'
      GROUP BY
        "ownerId",
        "scopeType",
        COALESCE("scopeId", ''),
        "namespace",
        "key"
      HAVING COUNT(*) > 1
    ) AS duplicate_groups
  `);
  const nativeTables = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "count"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('NativeDeviceAuthorization', 'NativeDeviceSession')
  `);

  console.log(
    JSON.stringify(
      {
        connected: true,
        appliedMigrations: migrations,
        duplicateActiveMemoryFactGroups: duplicateGroups[0]?.count ?? null,
        existingNativeAuthTables: nativeTables[0]?.count ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
