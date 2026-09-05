import type { BackgroundJob } from '@/lib/server/generated-prisma';
import { prisma } from '@/lib/server/prisma';
import { claimJob, checkpoint, failJob, finishJob, inputHash, renewLease } from './store';
import { withRequestContext } from '@/lib/server/request-context';

async function execute(job: BackgroundJob): Promise<unknown> {
  if (job.kind === 'learner-note' || job.kind === 'conversation-memory') {
    const { processMemoryJob } = await import('./memory');
    return processMemoryJob(prisma, job);
  }
  if (job.kind === 'memory-index') {
    const { memoryId } = job.payload as { memoryId: string };
    const memory = await prisma.studyMemory.findFirst({
      where: { id: memoryId, ownerId: job.ownerId, status: 'active' },
    });
    if (!memory) return { skipped: 'deleted' };
    const { indexStudyMemoryRecord } = await import('@/lib/server/study-memory-vector-store');
    const result = await indexStudyMemoryRecord(prisma, memory);
    if (
      result.reason === 'embedding_unavailable' ||
      result.reason === 'embedding_dimension_mismatch'
    )
      throw new Error('记忆索引暂不可用，稍后重试。');
    return result;
  }
  if (job.kind === 'mini-lecture') {
    const { nativeMiniLectureRequestSchema } =
      await import('@/features/native-api/domain/mini-lecture');
    const { generateNativeMiniLecture, nativeMiniLectureDependencies } =
      await import('@/features/native-api/server/mini-lecture-service');
    const { markInternalRequestHeaders } = await import('@/lib/server/internal-request');
    const payload = job.payload as { input: unknown };
    const parsedInput = nativeMiniLectureRequestSchema.parse(payload.input);
    if (!parsedInput.idempotencyKey) throw new Error('Missing idempotency key');
    const input = { ...parsedInput, idempotencyKey: parsedInput.idempotencyKey };
    const { findCourseConversationAccessRole } =
      await import('@/features/learn-conversations/server/course-conversation-repository');
    if (
      job.courseId &&
      !(await findCourseConversationAccessRole(prisma, job.ownerId, job.courseId))
    )
      throw new Error('课程访问权限已失效。');
    const headers = new Headers({ 'x-user-id': job.ownerId });
    markInternalRequestHeaders(headers);
    // Routes are invoked in-process. Never persist cookies, credentials, or a client URL.
    const result = await withRequestContext(
      {
        userId: job.ownerId,
        courseId: job.courseId || undefined,
        route: '/api/learn/mini-lectures',
        operationCode: 'learn_mini_lecture_generation',
        chargeReason: '生成课程图片课堂讲解',
      },
      () =>
        generateNativeMiniLecture({
          input,
          context: { requestUrl: 'http://localhost/api/learn/mini-lectures', headers },
          dependencies: {
            generatePage: (args) =>
              checkpoint(prisma, job, `page:${inputHash({ ...args, context: undefined })}`, () =>
                nativeMiniLectureDependencies.generatePage(args),
              ),
            generateActions: (args) =>
              checkpoint(prisma, job, `actions:${inputHash({ ...args, context: undefined })}`, () =>
                nativeMiniLectureDependencies.generateActions(args),
              ),
            synthesizeSpeech: (args) =>
              checkpoint(prisma, job, `speech:${inputHash(args)}`, () =>
                nativeMiniLectureDependencies.synthesizeSpeech(args),
              ),
          },
        }),
    );
    return result.manifest;
  }
  throw new Error(`Unknown job kind: ${job.kind}`);
}

export async function runNextBackgroundJob(): Promise<boolean> {
  const job = await claimJob(prisma);
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void renewLease(prisma, job).catch((error) =>
      console.error(
        '[ai-worker] lease renewal failed',
        error instanceof Error ? error.message : 'database',
      ),
    );
  }, 20_000);
  try {
    const result = await execute(job);
    await finishJob(prisma, job, result);
  } catch (error) {
    await failJob(prisma, job, error);
    console.error(
      '[ai-worker] job failed',
      job.id,
      job.kind,
      error instanceof Error ? error.message : 'unknown',
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
