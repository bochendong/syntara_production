import { NextResponse } from 'next/server';

import { listTeachableCourses } from '@/lib/server/teacher-classroom';
import { classroomRoute } from '@/lib/server/teacher-classroom-route';

export const runtime = 'nodejs';

/** 老师能开班的课程，以及每门课本学期的班。 */
export async function GET() {
  return classroomRoute(async (viewer) => NextResponse.json(await listTeachableCourses(viewer)));
}
