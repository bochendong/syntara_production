import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';

const schema = z.object({
  notebookIds: z
    .array(z.string().trim().min(1).max(160))
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length),
});

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function PUT(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const payload = schema.safeParse(await request.json().catch(() => null));
    if (!payload.success) return NextResponse.json({ error: '笔记本顺序无效' }, { status: 400 });
    const notebooks = await prisma.notebook.findMany({
      where: { courseId, ownerId: teacher.userId, removedAt: null },
      select: { id: true, coverSlideJson: true },
    });
    const existingIds = new Set(notebooks.map((notebook) => notebook.id));
    if (
      existingIds.size !== payload.data.notebookIds.length ||
      payload.data.notebookIds.some((id) => !existingIds.has(id))
    ) {
      return NextResponse.json(
        { error: '笔记本列表已经变化，请刷新后重新调整顺序' },
        { status: 409 },
      );
    }
    const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
    await prisma.$transaction(
      payload.data.notebookIds.map((id, learningOrder) => {
        const notebook = byId.get(id)!;
        return prisma.notebook.update({
          where: { id },
          data: {
            coverSlideJson: toPrismaJson({
              ...jsonRecord(notebook.coverSlideJson),
              learningOrder,
            }),
          },
        });
      }),
    );
    return NextResponse.json({ ok: true, notebookIds: payload.data.notebookIds });
  });
}
