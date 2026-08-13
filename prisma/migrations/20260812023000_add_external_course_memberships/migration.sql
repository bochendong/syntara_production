CREATE TYPE "ExternalCourseMemberRole" AS ENUM ('TEACHER', 'STUDENT');

ALTER TABLE "ExternalCourseBinding"
ADD COLUMN "campusCode" VARCHAR(120) NOT NULL DEFAULT 'UNKNOWN';

UPDATE "ExternalCourseBinding"
SET "campusCode" = UPPER(REGEXP_REPLACE(COALESCE(NULLIF(BTRIM("universityAbbrs"), ''), 'UNKNOWN'), '[^A-Za-z0-9_-]+', '-', 'g'));

DROP INDEX IF EXISTS "ExternalCourseBinding_provider_externalCourseId_key";

CREATE UNIQUE INDEX "ExternalCourseBinding_provider_campusCode_externalCourseId_key"
ON "ExternalCourseBinding"("provider", "campusCode", "externalCourseId");

CREATE TABLE "ExternalCourseMembership" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ExternalCourseMemberRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCourseMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalCourseMembership_bindingId_userId_role_key"
ON "ExternalCourseMembership"("bindingId", "userId", "role");

CREATE INDEX "ExternalCourseMembership_userId_role_active_updatedAt_idx"
ON "ExternalCourseMembership"("userId", "role", "active", "updatedAt" DESC);

CREATE INDEX "ExternalCourseMembership_bindingId_role_active_idx"
ON "ExternalCourseMembership"("bindingId", "role", "active");

ALTER TABLE "ExternalCourseMembership"
ADD CONSTRAINT "ExternalCourseMembership_bindingId_fkey"
FOREIGN KEY ("bindingId") REFERENCES "ExternalCourseBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalCourseMembership"
ADD CONSTRAINT "ExternalCourseMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing access. Future Speedup logins reconcile these rows and
-- mark memberships inactive without deleting course or learning data.
INSERT INTO "ExternalCourseMembership" (
    "id", "bindingId", "userId", "role", "active", "lastVerifiedAt", "createdAt", "updatedAt"
)
SELECT
    CONCAT('ecm_', MD5(binding."id" || ':' || course."ownerId" || ':TEACHER')),
    binding."id",
    course."ownerId",
    'TEACHER'::"ExternalCourseMemberRole",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ExternalCourseBinding" binding
JOIN "Course" course ON course."id" = binding."courseId"
ON CONFLICT ("bindingId", "userId", "role") DO NOTHING;

INSERT INTO "ExternalCourseMembership" (
    "id", "bindingId", "userId", "role", "active", "lastVerifiedAt", "createdAt", "updatedAt"
)
SELECT
    CONCAT('ecm_', MD5(binding."id" || ':' || enrollment."userId" || ':STUDENT')),
    binding."id",
    enrollment."userId",
    'STUDENT'::"ExternalCourseMemberRole",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ExternalCourseBinding" binding
JOIN "CourseEnrollment" enrollment ON enrollment."courseId" = binding."courseId"
ON CONFLICT ("bindingId", "userId", "role") DO NOTHING;
