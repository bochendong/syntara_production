import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { findOwnedCourse } from '@/lib/server/repositories/course-repository';
import {
  findOwnedNotebookId,
  updateOwnedNotebook,
} from '@/lib/server/repositories/notebook-repository';
import { scheduleUnlinkedCourseKnowledgeProjectionSync } from '@/lib/server/unlinked-course-knowledge-projection';

const addNotebookToCourseSchema = z.object({
  notebookId: z.string().trim().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const payload = addNotebookToCourseSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const course = await findOwnedCourse(prisma, userId, id);
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const existing = await findOwnedNotebookId(prisma, userId, payload.data.notebookId);
    if (!existing) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    const notebook = await updateOwnedNotebook(prisma, userId, payload.data.notebookId, {
      courseId: id,
    });
    if (!notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (existing.courseId !== id) {
      scheduleUnlinkedCourseKnowledgeProjectionSync({
        prisma,
        courseId: existing.courseId,
        ownerId: userId,
        reason: 'notebook_detached_from_course',
      });
      scheduleUnlinkedCourseKnowledgeProjectionSync({
        prisma,
        courseId: id,
        ownerId: userId,
        reason: 'notebook_attached_to_course',
      });
    }

    return NextResponse.json({ notebook });
  });
}
