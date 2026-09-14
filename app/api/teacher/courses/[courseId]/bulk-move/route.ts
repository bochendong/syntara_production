import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import {
  CourseBulkMoveError,
  getCourseBulkMovePreview,
  moveCourseContents,
} from '@/lib/server/teacher-course-bulk-move';
import { syncUnlinkedCourseKnowledgeProjection } from '@/lib/server/unlinked-course-knowledge-projection';

export const maxDuration = 300;
type Context = { params: Promise<{ courseId: string }> };

const inputSchema = z
  .object({
    targetCourseId: z.string().trim().min(1).max(200),
    notebooks: z.boolean(),
    problems: z.boolean(),
    notebookVersion: z.string().regex(/^[a-f0-9]{64}$/),
    problemVersion: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

async function handle(action: () => Promise<unknown>) {
  try {
    return NextResponse.json(await action(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CourseBulkMoveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['P2034', 'P2002'].includes(String(error.code))
    ) {
      return NextResponse.json(
        { error: '课程内容刚刚发生变化，迁移未执行。请刷新列表后重试。' },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function GET(_request: Request, context: Context) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    return handle(() => getCourseBulkMovePreview(prisma, teacher.userId, courseId));
  });
}

export async function POST(request: Request, context: Context) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: '迁移参数无效，请重新打开弹窗。' }, { status: 400 });
    return handle(async () => {
      const result = await moveCourseContents(prisma, teacher.userId, courseId, parsed.data);
      after(async () => {
        for (const id of [courseId, result.targetCourseId]) {
          try {
            await syncUnlinkedCourseKnowledgeProjection({
              prisma,
              courseId: id,
              ownerId: teacher.userId,
            });
          } catch (error) {
            console.error('[course-bulk-move] Search reconciliation failed', id, error);
          }
        }
      });
      return result;
    });
  });
}
