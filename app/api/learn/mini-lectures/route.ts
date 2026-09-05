import { NextRequest } from 'next/server';
import { nativeMiniLectureRequestSchema } from '@/features/native-api/domain/mini-lecture';
import {
  enqueueJob,
  JobConflictError,
  unpackResult,
} from '@/features/background-jobs/server/store';
import { findCourseConversationAccessRole } from '@/features/learn-conversations/server/course-conversation-repository';
import { requireUserId } from '@/lib/server/api-auth';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: NextRequest): Promise<Response> {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const parsed = nativeMiniLectureRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.idempotencyKey)
      return Response.json({ error: '课堂参数不完整。' }, { status: 400 });
    const input = parsed.data;
    const courseId = typeof input.course === 'object' ? input.course.id : undefined;
    if (courseId && !(await findCourseConversationAccessRole(prisma, auth.userId, courseId)))
      return Response.json({ error: '课程不存在或没有访问权限。' }, { status: 404 });
    try {
      // The full confirmed question/answer and parameters are immutable in this job.
      const job = await enqueueJob(prisma, {
        ownerId: auth.userId,
        courseId,
        kind: 'mini-lecture',
        key: `mini-lecture:${input.idempotencyKey}`,
        payload: { input },
      });
      if (job.status === 'failed') {
        await prisma.backgroundJob.updateMany({
          where: { id: job.id, ownerId: auth.userId, status: 'failed' },
          data: { status: 'queued', attempts: 0, availableAt: new Date(), error: null },
        });
        job.status = 'queued';
      }
      return Response.json({ ok: true, job }, { status: 202, headers });
    } catch (error) {
      if (error instanceof JobConflictError)
        return Response.json({ error: error.message }, { status: 409, headers });
      throw error;
    }
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const id = request.nextUrl.searchParams.get('id');
    const keys = request.nextUrl.searchParams.get('keys');
    if (keys) {
      const requested = keys
        .split(',')
        .filter((k) => k.length <= 220)
        .slice(0, 40)
        .map((k) => `mini-lecture:${k}`);
      const jobs = await prisma.backgroundJob.findMany({
        where: { ownerId: auth.userId, kind: 'mini-lecture', dedupeKey: { in: requested } },
        select: { id: true, status: true, dedupeKey: true },
        take: 40,
      });
      return Response.json(
        {
          ok: true,
          jobs: jobs.map((j) => ({
            id: j.id,
            status: j.status,
            key: j.dedupeKey.slice('mini-lecture:'.length),
          })),
        },
        { headers },
      );
    }
    if (!id || id.length > 200) return Response.json({ error: '缺少任务编号。' }, { status: 400 });
    const job = await prisma.backgroundJob.findFirst({
      where: { id, ownerId: auth.userId, kind: 'mini-lecture' },
    });
    if (
      !job ||
      (job.courseId && !(await findCourseConversationAccessRole(prisma, auth.userId, job.courseId)))
    )
      return Response.json({ error: '找不到这个课堂任务。' }, { status: 404 });
    const input = (
      job.payload as {
        input: {
          message: string | { text: string };
          answer: string | { text: string; title?: string };
          course?: string | { name: string };
        };
      }
    ).input;
    const prompt = {
      id: job.id,
      title: typeof input.answer === 'object' ? input.answer.title || '课堂讲解' : '课堂讲解',
      question: typeof input.message === 'string' ? input.message : input.message.text,
      answer: typeof input.answer === 'string' ? input.answer : input.answer.text,
      courseName: typeof input.course === 'string' ? input.course : input.course?.name || '',
      createdAt: job.createdAt.getTime(),
    };
    return Response.json(
      {
        ok: true,
        job: {
          id: job.id,
          status: job.status,
          error: job.status === 'failed' ? '课堂生成失败，可点击重试。' : undefined,
        },
        ...(job.status === 'completed' && job.result
          ? { data: unpackResult(job.result), prompt }
          : {}),
      },
      { headers },
    );
  });
}
