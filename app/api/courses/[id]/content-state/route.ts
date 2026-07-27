import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  type CourseAccessRole,
  withCourseEnrollmentSchemaFallback,
} from '@/lib/server/repositories/course-enrollment-repository';

export const dynamic = 'force-dynamic';

const CONTENT_STATE_WAIT_TIMEOUT_MS = 12_000;
const CONTENT_STATE_STALE_FLIGHT_MS = 45_000;

type CourseContentStateRow = {
  accessRole: CourseAccessRole | null;
  notebookCount: bigint;
  notebookUpdatedAt: Date | null;
  notebookContentVersion: bigint;
  problemCount: bigint;
  problemUpdatedAt: Date | null;
  sourceCount: bigint;
  sourceUpdatedAt: Date | null;
  sourceProcessingCount: bigint;
  sourceIngestErrorCount: bigint;
  sourceIndexPendingCount: bigint;
  sourceIndexErrorCount: bigint;
  sourceOldestProcessingAt: Date | null;
};

type CourseContentSourceState = ReturnType<typeof resourceState> & {
  processingCount: number;
  ingestErrorCount: number;
  indexPendingCount: number;
  indexErrorCount: number;
  oldestProcessingAt: string | null;
};

type CourseContentStateSnapshot = {
  storage: 'database';
  courseId: string;
  accessRole: CourseAccessRole;
  checkedAt: string;
  revision: string;
  notebooks: ReturnType<typeof resourceState>;
  problems: ReturnType<typeof resourceState>;
  sources: CourseContentSourceState;
};

type CourseContentStateFlight = {
  startedAt: number;
  promise: Promise<CourseContentStateSnapshot | null>;
};

declare global {
  var __synatraCourseContentStateFlightsV2__: Map<string, CourseContentStateFlight> | undefined;
}

function timestamp(value: Date | null): number {
  return value?.getTime() ?? 0;
}

function resourceState(count: bigint, updatedAt: Date | null, version: bigint = BigInt(0)) {
  const normalizedCount = Number(count);
  const normalizedVersion = Number(version);
  const updatedAtMs = timestamp(updatedAt);
  return {
    count: normalizedCount,
    updatedAt: updatedAt?.toISOString() ?? null,
    revision: `${normalizedCount}:${updatedAtMs}:${normalizedVersion}`,
  };
}

function courseContentStateFlights() {
  globalThis.__synatraCourseContentStateFlightsV2__ ??= new Map();
  return globalThis.__synatraCourseContentStateFlightsV2__;
}

class CourseContentStateTimeoutError extends Error {
  constructor() {
    super(`Course content state did not resolve within ${CONTENT_STATE_WAIT_TIMEOUT_MS}ms.`);
    this.name = 'CourseContentStateTimeoutError';
  }
}

async function waitForCourseContentState(
  promise: Promise<CourseContentStateSnapshot | null>,
): Promise<CourseContentStateSnapshot | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new CourseContentStateTimeoutError()),
          CONTENT_STATE_WAIT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readCourseContentState(
  userId: string,
  courseId: string,
): Promise<CourseContentStateSnapshot | null> {
  // Access and resource revisions intentionally share one SQL round-trip. The
  // watcher is frequent and must not spend two scarce remote-pool leases just
  // to learn that the same course has not changed.
  const rows = await withCourseEnrollmentSchemaFallback(
    prisma,
    () =>
      prisma.$queryRaw<CourseContentStateRow[]>`
      SELECT
        CASE
          WHEN course."ownerId" = ${userId} THEN 'owner'
          WHEN EXISTS (
            SELECT 1
            FROM "CourseEnrollment"
            WHERE "userId" = ${userId} AND "courseId" = ${courseId}
          ) OR EXISTS (
            SELECT 1
            FROM "CoursePurchase"
            WHERE "buyerId" = ${userId} AND "sourceCourseId" = ${courseId}
          ) THEN 'enrolled'
          ELSE NULL
        END AS "accessRole",
        (
          SELECT COUNT(*)::bigint
          FROM "Notebook"
          WHERE "courseId" = ${courseId}
        ) AS "notebookCount",
        (
          SELECT MAX("updatedAt")
          FROM "Notebook"
          WHERE "courseId" = ${courseId}
        ) AS "notebookUpdatedAt",
        (
          SELECT COALESCE(SUM("contentVersion"), 0)::bigint
          FROM "Notebook"
          WHERE "courseId" = ${courseId}
        ) AS "notebookContentVersion",
        (
          SELECT COUNT(*)::bigint
          FROM "NotebookProblem" AS problem
          WHERE problem."courseId" = ${courseId}
            OR (
              problem."courseId" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "Notebook" AS problem_notebook
                WHERE problem_notebook."id" = problem."notebookId"
                  AND problem_notebook."courseId" = ${courseId}
              )
            )
        ) AS "problemCount",
        (
          SELECT MAX(problem."updatedAt")
          FROM "NotebookProblem" AS problem
          WHERE problem."courseId" = ${courseId}
            OR (
              problem."courseId" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "Notebook" AS problem_notebook
                WHERE problem_notebook."id" = problem."notebookId"
                  AND problem_notebook."courseId" = ${courseId}
              )
            )
        ) AS "problemUpdatedAt",
        source_state."sourceCount",
        source_state."sourceUpdatedAt",
        source_state."sourceProcessingCount",
        source_state."sourceIngestErrorCount",
        source_state."sourceIndexPendingCount",
        source_state."sourceIndexErrorCount",
        source_state."sourceOldestProcessingAt"
      FROM "Course" AS course
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*)::bigint AS "sourceCount",
          MAX("updatedAt") AS "sourceUpdatedAt",
          COUNT(*) FILTER (
            WHERE "ingestStatus" = 'processing'
          )::bigint AS "sourceProcessingCount",
          COUNT(*) FILTER (
            WHERE "ingestStatus" = 'error'
          )::bigint AS "sourceIngestErrorCount",
          COUNT(*) FILTER (
            WHERE "ingestStatus" = 'ready'
              AND "indexStatus" IN ('pending', 'indexing')
          )::bigint AS "sourceIndexPendingCount",
          COUNT(*) FILTER (
            WHERE "ingestStatus" = 'ready'
              AND "indexStatus" = 'error'
          )::bigint AS "sourceIndexErrorCount",
          MIN("updatedAt") FILTER (
            WHERE "ingestStatus" = 'processing'
          ) AS "sourceOldestProcessingAt"
        FROM "CourseSource"
        WHERE "courseId" = ${courseId}
      ) AS source_state
      WHERE course."id" = ${courseId}
      LIMIT 1
    `,
  );
  const row = rows[0];
  if (!row?.accessRole) return null;

  const notebooks = resourceState(
    row.notebookCount,
    row.notebookUpdatedAt,
    row.notebookContentVersion,
  );
  const problems = resourceState(row.problemCount, row.problemUpdatedAt);
  const sources = {
    ...resourceState(row.sourceCount, row.sourceUpdatedAt),
    processingCount: Number(row.sourceProcessingCount),
    ingestErrorCount: Number(row.sourceIngestErrorCount),
    indexPendingCount: Number(row.sourceIndexPendingCount),
    indexErrorCount: Number(row.sourceIndexErrorCount),
    oldestProcessingAt: row.sourceOldestProcessingAt?.toISOString() ?? null,
  };
  const sourceHealthRevision = [
    sources.processingCount,
    sources.ingestErrorCount,
    sources.indexPendingCount,
    sources.indexErrorCount,
    timestamp(row.sourceOldestProcessingAt),
  ].join(':');
  return {
    storage: 'database',
    courseId,
    accessRole: row.accessRole,
    checkedAt: new Date().toISOString(),
    revision: [notebooks.revision, problems.revision, sources.revision, sourceHealthRevision].join(
      '|',
    ),
    notebooks,
    problems,
    sources,
  };
}

async function readCourseContentStateSingleFlight(userId: string, courseId: string) {
  const key = `${encodeURIComponent(userId)}:${encodeURIComponent(courseId)}`;
  const flights = courseContentStateFlights();
  const existing = flights.get(key);
  if (existing && Date.now() - existing.startedAt < CONTENT_STATE_STALE_FLIGHT_MS) {
    return existing.promise;
  }
  if (existing) flights.delete(key);

  const flight: CourseContentStateFlight = {
    startedAt: Date.now(),
    promise: Promise.resolve(null),
  };
  flight.promise = readCourseContentState(userId, courseId).finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight.promise;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    let snapshot: CourseContentStateSnapshot | null;
    try {
      snapshot = await waitForCourseContentState(
        readCourseContentStateSingleFlight(auth.userId, id),
      );
    } catch (error) {
      if (error instanceof CourseContentStateTimeoutError) {
        return NextResponse.json(
          {
            error: 'Course content synchronization check timed out.',
            code: 'COURSE_CONTENT_STATE_TIMEOUT',
            retryable: true,
          },
          {
            status: 504,
            headers: {
              'Cache-Control': 'private, no-store, max-age=0',
              'Retry-After': '5',
            },
          },
        );
      }
      throw error;
    }
    if (!snapshot) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  });
}
