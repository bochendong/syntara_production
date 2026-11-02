import { NextResponse } from 'next/server';

import { requireServerSession } from '@/lib/server/auth';
import { isDatabaseUnavailableError, jsonErrorFromUnknown } from '@/lib/server/json-error-response';
import { ClassroomError, type ClassroomViewer } from '@/lib/server/teacher-classroom';

/** 老师端课堂接口：只要登录；能不能看某门课 / 某个班由 teacher-classroom.ts 按关系判断。 */
export async function classroomRoute(
  handler: (viewer: ClassroomViewer) => Promise<NextResponse>,
): Promise<NextResponse> {
  const session = await requireServerSession();
  const user = session?.user;
  if (!user?.id) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  try {
    return await handler({ userId: user.id, role: user.role ?? null });
  } catch (error) {
    if (error instanceof ClassroomError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isDatabaseUnavailableError(error)) return jsonErrorFromUnknown(error, 503);
    return jsonErrorFromUnknown(error);
  }
}
