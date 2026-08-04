import { after, NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  deleteCourseSourceUpload,
  isLegacySectionSourceHash,
  listCourseSourceUploads,
} from '@/features/memory/server/source-upload-library';
import {
  claimCourseSourceKnowledgeIndex,
  indexCourseSourceKnowledge,
} from '@/lib/server/knowledge-document-index';
import { createLogger } from '@/lib/logger';
import {
  scheduleUnlinkedCourseKnowledgeProjectionReconciliation,
  scheduleUnlinkedCourseKnowledgeProjectionSync,
} from '@/lib/server/unlinked-course-knowledge-projection';

export const maxDuration = 300;

const log = createLogger('CourseSourceUploads');

async function listOwnedCourseProblemIds(
  userId: string,
  courseId: string,
): Promise<string[] | null> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, ownerId: userId },
    select: { id: true },
  });
  if (!course) return null;

  const problems = await prisma.notebookProblem.findMany({
    where: {
      OR: [
        { courseId },
        {
          courseId: null,
          notebook: { courseId, ownerId: userId },
        },
      ],
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return problems.map((problem) => problem.id);
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const ownedCourse = await prisma.course.findFirst({
      where: { id, ownerId: auth.userId },
      select: { id: true },
    });
    if (!ownedCourse) {
      // Students consume the generated notebook projection, never the teacher's
      // uploaded source catalog or extracted source text.
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const url = new URL(request.url);
    const includeTextSections = url.searchParams.get('includeText') !== '0';
    const includeArtifacts = url.searchParams.get('includeArtifacts') !== '0';
    const deferKnowledgeSyncParam = url.searchParams.get('deferKnowledgeSync');
    if (deferKnowledgeSyncParam !== null && deferKnowledgeSyncParam !== '1') {
      return NextResponse.json(
        {
          error: 'deferKnowledgeSync only accepts 1 for an owner-scoped side-effect-free read.',
          code: 'INVALID_DEFER_KNOWLEDGE_SYNC',
        },
        { status: 400 },
      );
    }
    const deferKnowledgeSync = deferKnowledgeSyncParam === '1';

    const uploads = await listCourseSourceUploads({
      prisma,
      userId: auth.userId,
      courseId: id,
      includeTextSections,
      includeArtifacts,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'List source uploads failed';
      if (message === 'Course not found') {
        return NextResponse.json({ error: message }, { status: 404 });
      }
      throw error;
    });

    if (uploads instanceof NextResponse) return uploads;
    const retryableSources =
      includeArtifacts && !deferKnowledgeSync
        ? uploads
            .filter(
              (upload) =>
                !isLegacySectionSourceHash(upload.sourceHash) &&
                upload.ingestStatus === 'ready' &&
                (upload.indexStatus === 'pending' ||
                  upload.indexStatus === 'indexing' ||
                  upload.indexStatus === 'error'),
            )
            .slice(0, 4)
        : [];
    const claimedSources: Array<{ sourceHash: string; leaseToken: string }> = [];
    for (const source of retryableSources) {
      const claim = await claimCourseSourceKnowledgeIndex({
        prisma,
        courseId: id,
        sourceHash: source.sourceHash,
      });
      if (claim.claimed && claim.leaseToken) {
        claimedSources.push({ sourceHash: source.sourceHash, leaseToken: claim.leaseToken });
      }
    }
    if (claimedSources.length > 0) {
      // The database status is the durable retry marker. If a previous
      // post-response task was interrupted, its lease expires and the next
      // authorized catalog read atomically claims the rebuild again.
      after(async () => {
        for (const source of claimedSources) {
          const result = await indexCourseSourceKnowledge({
            prisma,
            courseId: id,
            sourceHash: source.sourceHash,
            leaseToken: source.leaseToken,
          });
          if (!result.indexed && result.reason !== 'source_changed_during_index') {
            log.warn('Retryable course source projection rebuild did not complete.', {
              courseId: id,
              sourceHash: source.sourceHash,
              reason: result.reason,
              errorReason: result.errorReason,
            });
          }
        }
      });
    }
    // Reconcile after the response so the source library remains a fast read.
    // Business rows are the durable retry marker: missing inserts, trigger-
    // marked stale edits, and orphaned deletes are checked on every read.
    if (
      !deferKnowledgeSync &&
      includeArtifacts &&
      uploads.some((upload) => !isLegacySectionSourceHash(upload.sourceHash)) &&
      uploads.every(
        (upload) => isLegacySectionSourceHash(upload.sourceHash) || upload.indexStatus === 'ready',
      )
    ) {
      scheduleUnlinkedCourseKnowledgeProjectionReconciliation({
        prisma,
        courseId: id,
      });
    }
    return NextResponse.json({
      storage: 'database',
      knowledgeSyncDeferred: deferKnowledgeSync,
      uploads,
    });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const url = new URL(request.url);
    const preserveProblemsParam = url.searchParams.get('preserveProblems');
    const deferKnowledgeSyncParam = url.searchParams.get('deferKnowledgeSync');
    if (preserveProblemsParam !== null && preserveProblemsParam !== '1') {
      return NextResponse.json(
        {
          error: 'Bulk source deletion always preserves course problems.',
          code: 'PROBLEM_PRESERVATION_REQUIRED',
        },
        { status: 400 },
      );
    }
    if (deferKnowledgeSyncParam !== null && deferKnowledgeSyncParam !== '1') {
      return NextResponse.json(
        {
          error: 'deferKnowledgeSync only accepts 1 when knowledge sync is finalized separately.',
          code: 'INVALID_DEFER_KNOWLEDGE_SYNC',
        },
        { status: 400 },
      );
    }
    const deferKnowledgeSync = deferKnowledgeSyncParam === '1';

    const beforeProblemIds = await listOwnedCourseProblemIds(auth.userId, id);
    if (!beforeProblemIds) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const uploads = await listCourseSourceUploads({
      prisma,
      userId: auth.userId,
      courseId: id,
      includeTextSections: false,
      includeArtifacts: true,
      serializeDatabaseReads: true,
    });

    const results = [];
    for (const upload of uploads) {
      results.push(
        await deleteCourseSourceUpload({
          prisma,
          userId: auth.userId,
          courseId: id,
          sourceHash: upload.sourceHash,
          preserveProblems: true,
        }),
      );
    }

    const afterProblemIds = (await listOwnedCourseProblemIds(auth.userId, id)) ?? [];
    const problemsUnchanged = sameIds(beforeProblemIds, afterProblemIds);
    const invariant = {
      problemsUnchanged,
      beforeProblemCount: beforeProblemIds.length,
      afterProblemCount: afterProblemIds.length,
      beforeProblemIds,
      afterProblemIds,
    };
    if (!problemsUnchanged) {
      return NextResponse.json(
        {
          error: 'Course problem preservation invariant failed.',
          code: 'PROBLEM_PRESERVATION_INVARIANT_FAILED',
          preserveProblems: true,
          invariant,
          results,
        },
        { status: 500 },
      );
    }

    if (results.length > 0 && !deferKnowledgeSync) {
      scheduleUnlinkedCourseKnowledgeProjectionSync({
        prisma,
        courseId: id,
        ownerId: auth.userId,
        reason: 'course_sources_bulk_deleted_preserve_problems',
      });
    }
    return NextResponse.json({
      ok: true,
      preserveProblems: true,
      knowledgeSyncDeferred: deferKnowledgeSync,
      deletedSourceCount: results.length,
      invariant,
      results,
    });
  });
}
