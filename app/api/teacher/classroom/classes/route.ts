import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ensureCurrentTermClass } from '@/lib/server/teacher-classroom';
import { classroomRoute } from '@/lib/server/teacher-classroom-route';

export const runtime = 'nodejs';

const schema = z.object({ courseId: z.string().trim().min(1).max(200) });

/** 打开 / 新建这门课本学期的班。 */
export async function POST(request: Request) {
  return classroomRoute(async (viewer) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '缺少课程。' }, { status: 400 });
    const classId = await ensureCurrentTermClass(viewer, parsed.data.courseId);
    return NextResponse.json({ classId });
  });
}
