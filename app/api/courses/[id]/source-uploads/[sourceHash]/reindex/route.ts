import { after, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { findStoredCourseSource } from '@/features/memory/server/course-source-store';
import {
  claimCourseSourceKnowledgeIndex,
  indexCourseSourceKnowledge,
} from '@/lib/server/knowledge-document-index';
import { createLogger } from '@/lib/logger';

export const maxDuration = 300;

const log = createLogger('CourseSourceReindex');

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; sourceHash: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;

    const { id, sourceHash: rawSourceHash } = await context.params;
    const sourceHash = rawSourceHash.trim();
    const localOnlyParam = new URL(request.url).searchParams.get('localOnly');
    if (localOnlyParam !== null && localOnlyParam !== '1') {
      return NextResponse.json(
        {
          error: 'localOnly only accepts 1.',
          code: 'INVALID_LOCAL_ONLY_REINDEX_MODE',
        },
        { status: 400 },
      );
    }
    const localOnly = localOnlyParam === '1';
    const lookup = await findStoredCourseSource({
      prisma,
      userId: auth.userId,
      courseId: id,
      sourceHash,
    });
    if (!lookup.available) {
      return NextResponse.json({ error: '课程资料索引尚未完成数据库迁移。' }, { status: 409 });
    }
    if (!lookup.source) {
      return NextResponse.json({ error: 'Source upload not found' }, { status: 404 });
    }
    if (lookup.source.ingestStatus !== 'ready') {
      return NextResponse.json(
        {
          error:
            lookup.source.errorReason ||
            `资料尚未入库完成，当前状态：${lookup.source.ingestStatus}`,
        },
        { status: 409 },
      );
    }

    const claim = await claimCourseSourceKnowledgeIndex({
      prisma,
      ownerId: auth.userId,
      courseId: id,
      sourceHash,
      allowReady: true,
    });
    if (!claim.available) {
      return NextResponse.json({ error: '课程资料索引尚未完成数据库迁移。' }, { status: 409 });
    }
    if (!claim.claimed || !claim.leaseToken) {
      return NextResponse.json(
        {
          ok: true,
          indexStatus: 'indexing',
          alreadyQueued: true,
          embeddingMode: localOnly ? 'disabled' : 'provider',
        },
        { status: 202 },
      );
    }

    after(async () => {
      const result = await indexCourseSourceKnowledge({
        prisma,
        ownerId: auth.userId,
        courseId: id,
        sourceHash,
        leaseToken: claim.leaseToken,
        embeddingMode: localOnly ? 'disabled' : 'provider',
      });
      if (!result.indexed) {
        log.warn('Course source reindex did not complete.', {
          courseId: id,
          sourceHash,
          reason: result.reason,
          errorReason: result.errorReason,
        });
      }
    });

    return NextResponse.json(
      {
        ok: true,
        indexStatus: 'indexing',
        embeddingMode: localOnly ? 'disabled' : 'provider',
      },
      { status: 202 },
    );
  });
}
