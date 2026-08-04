import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';

const updateSchema = z.object({ action: z.enum(['remove', 'restore']) });

async function ownedNotebook(userId: string, courseId: string, notebookId: string) {
  return prisma.notebook.findFirst({
    where: { id: notebookId, courseId, ownerId: userId },
    select: { id: true },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ courseId: string; notebookId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, notebookId } = await context.params;
    if (!(await ownedNotebook(teacher.userId, courseId, notebookId))) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    const payload = updateSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    await prisma.notebook.update({
      where: { id: notebookId },
      data: { removedAt: payload.data.action === 'remove' ? new Date() : null },
    });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ courseId: string; notebookId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, notebookId } = await context.params;
    if (!(await ownedNotebook(teacher.userId, courseId, notebookId))) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    await prisma.notebook.delete({ where: { id: notebookId } });
    const notebookCount = await prisma.notebook.count({
      where: { courseId, removedAt: null },
    });
    await prisma.course.update({ where: { id: courseId }, data: { notebookCount } });
    return NextResponse.json({ ok: true });
  });
}
