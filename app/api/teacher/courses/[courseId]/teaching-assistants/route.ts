import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasTeacherCourseAccess } from '@/lib/server/external-course-access';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  addCourseTeachingAssistant,
  listCourseTeachingAssistants,
  removeCourseTeachingAssistant,
} from '@/lib/server/repositories/course-teaching-assistant-repository';
import { requireTeacher } from '@/lib/server/teacher-auth';

type Context = { params: Promise<{ courseId: string }> };

const userIdSchema = z.object({ userId: z.string().trim().min(1).max(200) });
const accountSchema = z.union([
  z.object({ email: z.string().trim().email().max(240) }),
  userIdSchema,
]);

async function requireCourseTeacher(context: Context) {
  const teacher = await requireTeacher();
  if (teacher.response) return { response: teacher.response };
  const { courseId } = await context.params;
  if (!(await hasTeacherCourseAccess(prisma, teacher.userId, courseId))) {
    return { response: NextResponse.json({ error: '课程不存在或无管理权限。' }, { status: 404 }) };
  }
  return { courseId };
}

export async function GET(_request: Request, context: Context) {
  return safeRoute(async () => {
    const access = await requireCourseTeacher(context);
    if ('response' in access) return access.response;
    return NextResponse.json({
      assistants: await listCourseTeachingAssistants(prisma, access.courseId),
    });
  });
}

export async function POST(request: Request, context: Context) {
  return safeRoute(async () => {
    const access = await requireCourseTeacher(context);
    if ('response' in access) return access.response;
    const parsed = accountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: '请输入有效的助教邮箱或账号 ID。' }, { status: 400 });
    }
    const added = await addCourseTeachingAssistant(prisma, access.courseId, parsed.data);
    if (!added) {
      return NextResponse.json(
        { error: '未找到已启用的助教账号，请先联系管理员分配助教角色。' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  });
}

export async function DELETE(request: Request, context: Context) {
  return safeRoute(async () => {
    const access = await requireCourseTeacher(context);
    if ('response' in access) return access.response;
    const parsed = userIdSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: '请选择要移除的助教。' }, { status: 400 });
    }
    await removeCourseTeachingAssistant(prisma, parsed.data.userId, access.courseId);
    return NextResponse.json({ success: true });
  });
}
