import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function createHandler({
  db,
  Prisma,
  problems,
  notebooks,
  notebookProblemImportDraftSchema,
  syncUnlinkedCourseKnowledgeProjection,
  token,
}) {
  const name = z.string().trim().min(1).max(200);
  const patchProblem = z
    .object({
      title: name.optional(),
      status: z.enum(['draft', 'published', 'archived']).optional(),
      points: z.number().int().min(0).max(1000).optional(),
      order: z.number().int().min(0).optional(),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
      type: z.literal('multipart').optional(),
      sourceMeta: z.record(z.string(), z.unknown()).optional(),
      notebookId: z.string().min(1).nullable().optional(),
      chapterId: z.string().min(1).nullable().optional(),
      publicContent: z.unknown().optional(),
      grading: z.unknown().optional(),
      secretJudge: z.unknown().nullable().optional(),
    })
    .strict();
  const notebookInput = z
    .object({
      name,
      description: z.string().max(3000).optional(),
      tags: z.array(z.string().min(1).max(30)).max(16).default([]),
      language: z.string().max(24).optional(),
      style: z.string().max(80).optional(),
      notebookKind: z.enum(['markdown', 'image']).default('markdown'),
    })
    .strict();
  const notebookPatch = notebookInput.partial().omit({ notebookKind: true }).strict();
  const sectionsSchema = z
    .array(
      z
        .object({
          id: z.string().min(1).optional(),
          title: name,
          order: z.number().int().min(0),
          markdown: z.string().min(1).max(250000),
          summary: z.string().max(2000).optional(),
          sourceMeta: z.unknown().optional(),
        })
        .strict(),
    )
    .max(300);
  const scenesSchema = z
    .array(
      z
        .object({
          id: z.string().min(1).optional(),
          title: name,
          type: z.string().min(1).max(60),
          order: z.number().int().min(0),
          content: z.unknown(),
          actions: z.unknown().nullable().optional(),
          whiteboard: z.unknown().nullable().optional(),
        })
        .strict(),
    )
    .max(500);
  function json(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  }
  function fail(status, message) {
    const e = new Error(message);
    e.status = status;
    throw e;
  }
  async function body(req) {
    let chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4_000_000) fail(413, 'Request exceeds 4 MB');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      fail(400, 'Invalid JSON');
    }
  }
  async function projection(courseId, ownerId, reason) {
    try {
      await syncUnlinkedCourseKnowledgeProjection({ prisma: db, courseId, ownerId, reason });
      return null;
    } catch {
      return 'Changes saved, but knowledge projection refresh failed; retry using the application maintenance workflow.';
    }
  }
  async function run(req, res) {
    const sent = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (
      sent.length !== token.length ||
      !timingSafeEqual(sent, token) ||
      req.headers.origin ||
      req.headers.host !== '127.0.0.1:8766'
    )
      return json(res, 403, { error: 'Forbidden' });
    const path = new URL(req.url, 'http://localhost').pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    if (path.length === 2 && path[0] === 'v1' && path[1] === 'courses' && req.method === 'GET') {
      const courses = await db.course.findMany({
        select: { id: true, name: true, courseCode: true, university: true },
        orderBy: { name: 'asc' },
      });
      return json(res, 200, { courses });
    }
    if (path.length < 3 || path[0] !== 'v1' || path[1] !== 'courses')
      return json(res, 404, { error: 'Not found' });
    const [, , courseId, resource, resourceId, subresource] = path;
    const course = await db.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!course) return json(res, 404, { error: 'Course not found' });
    const ownerId = course.ownerId;
    if (path.length === 3 && req.method === 'GET') return json(res, 200, { course });
    if (resource === 'chapters' && path.length === 4 && req.method === 'GET') {
      const chapters = await db.courseProblemChapter.findMany({
        where: { courseId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { _count: { select: { problems: true } } },
      });
      return json(res, 200, { chapters });
    }
    if (resource === 'chapters' && path.length === 5 && resourceId && req.method === 'PATCH') {
      const input = z
        .object({
          expectedUpdatedAt: z.string().datetime({ precision: 3 }),
          patch: z
            .object({
              name: z.string().trim().min(1).max(160).optional(),
              description: z.string().trim().max(2000).optional(),
            })
            .strict()
            .refine((value) => Object.keys(value).length > 0),
        })
        .strict()
        .parse(await body(req));
      const chapter = await db.$transaction(async (tx) => {
        const current = await tx.courseProblemChapter.findFirst({
          where: { id: resourceId, courseId },
        });
        if (!current) fail(404, 'Chapter not found in course');
        if (
          input.patch.name &&
          (await tx.courseProblemChapter.findFirst({
            where: { courseId, name: input.patch.name, id: { not: resourceId } },
          }))
        )
          fail(409, 'Chapter name already exists');
        const changed = await tx.courseProblemChapter.updateMany({
          where: { id: resourceId, courseId, updatedAt: new Date(input.expectedUpdatedAt) },
          data: input.patch,
        });
        if (changed.count !== 1) fail(409, 'Chapter changed since it was read');
        if (input.patch.name !== undefined)
          await tx.notebookProblem.updateMany({
            where: { courseId, chapterId: resourceId },
            data: { updatedAt: new Date() },
          });
        return tx.courseProblemChapter.findFirst({ where: { id: resourceId, courseId } });
      });
      return json(res, 200, { chapter });
    }
    if (resource === 'problems' && path.length === 4 && req.method === 'GET') {
      const rows = await db.notebookProblem.findMany({
        where: { ownerId: null, OR: [{ courseId }, { notebook: { courseId, ownerId } }] },
        include: { secret: true, tagAssignments: true },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      return json(res, 200, { problems: rows });
    }
    if (resource === 'problems' && path.length === 4 && req.method === 'POST') {
      const raw = await body(req);
      const payload = z
        .object({
          draft: notebookProblemImportDraftSchema,
          chapterId: z.string().min(1).nullable().optional(),
        })
        .strict()
        .parse(raw);
      const result = await problems.createManualCourseProblem({
        userId: ownerId,
        courseId,
        ...payload,
      });
      const warning = await projection(courseId, ownerId, 'course_problem_updated');
      return json(res, 201, { ...result, warning });
    }
    if (resource === 'problems' && path.length === 5 && resourceId) {
      const row = await db.notebookProblem.findFirst({
        where: {
          id: resourceId,
          ownerId: null,
          OR: [{ courseId }, { notebook: { courseId, ownerId } }],
        },
        include: { secret: true, tagAssignments: true, _count: { select: { attempts: true } } },
      });
      if (!row) fail(404, 'Problem not found in course');
      if (req.method === 'GET') return json(res, 200, { problem: row });
      if (row.courseId !== courseId)
        fail(
          409,
          'Problem is only indirectly linked to this course; use its original notebook workflow',
        );
      const raw = await body(req);
      const expected = z.string().datetime({ precision: 3 }).parse(raw.expectedUpdatedAt);
      if (row.updatedAt.toISOString() !== expected) fail(409, 'Problem changed since it was read');
      if (row._count.attempts > 0) fail(409, 'Problem has student attempts');
      if (req.method === 'PATCH') {
        const patch = patchProblem.parse(raw.patch);
        const result = await problems.updateCourseProblem({
          userId: ownerId,
          courseId,
          problemId: resourceId,
          preservePreparedContent: true,
          patch,
        });
        const warning = await projection(courseId, ownerId, 'course_problem_updated');
        return json(res, 200, { problem: result, warning });
      }
      if (req.method === 'DELETE') {
        await problems.deleteCourseProblem({ userId: ownerId, courseId, problemId: resourceId });
        const warning = await projection(courseId, ownerId, 'course_problem_deleted');
        return json(res, 200, { deleted: resourceId, warning });
      }
    }
    if (resource === 'notebooks' && path.length === 4 && req.method === 'GET')
      return json(res, 200, {
        notebooks: await db.notebook.findMany({
          where: { courseId, ownerId },
          select: {
            id: true,
            name: true,
            description: true,
            ownerId: true,
            notebookKind: true,
            removedAt: true,
            updatedAt: true,
            contentVersion: true,
          },
          orderBy: { updatedAt: 'desc' },
        }),
      });
    if (resource === 'notebooks' && path.length === 4 && req.method === 'POST') {
      const input = notebookInput.parse(await body(req));
      const notebook = await notebooks.createOwnedNotebook(db, ownerId, { ...input, courseId });
      const warning = await projection(courseId, ownerId, 'notebook_created');
      return json(res, 201, { notebook, warning });
    }
    if (resource === 'notebooks' && resourceId) {
      const n = await db.notebook.findFirst({
        where: { id: resourceId, courseId, ownerId },
        include: {
          scenes: { orderBy: { order: 'asc' } },
          markdownSections: { orderBy: { order: 'asc' } },
          pages: {
            orderBy: { order: 'asc' },
            include: {
              content: true,
              actions: true,
              assets: {
                include: {
                  asset: {
                    select: { id: true, path: true, mimeType: true, sizeBytes: true, sha256: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!n) fail(404, 'Notebook not found in course');
      if (path.length === 5 && req.method === 'GET') return json(res, 200, { notebook: n });
      if (n.ownerId !== ownerId)
        fail(409, 'Notebook owner differs from course owner; use its owner workflow');
      const raw = await body(req);
      const expected = z.string().datetime({ precision: 3 }).parse(raw.expectedUpdatedAt);
      if (n.updatedAt.toISOString() !== expected) fail(409, 'Notebook changed since it was read');
      if (path.length === 5 && req.method === 'PATCH') {
        const patch = notebookPatch.parse(raw.patch);
        const updated = await notebooks.updateOwnedNotebook(db, ownerId, resourceId, patch);
        const warning = await projection(courseId, ownerId, 'notebook_renamed');
        return json(res, 200, { notebook: updated, warning });
      }
      if (path.length === 5 && req.method === 'DELETE') {
        const result = await notebooks.deleteOwnedNotebook(db, ownerId, resourceId);
        const warning = await projection(courseId, ownerId, 'notebook_deleted');
        return json(res, 200, { deleted: result, warning });
      }
      if (path.length === 6 && req.method === 'PUT' && subresource === 'sections') {
        if (n.pages.length)
          fail(409, 'Notebook has page records; section replacement cannot keep them synchronized');
        if (n.notebookKind !== 'markdown')
          fail(409, 'Only Markdown notebooks support section replacement');
        const input = sectionsSchema.parse(raw.sections);
        const result = await notebooks.replaceOwnedMarkdownNotebookSections(
          db,
          ownerId,
          resourceId,
          input.map((s) => ({
            ...s,
            sourceMeta: s.sourceMeta == null ? Prisma.DbNull : s.sourceMeta,
          })),
          { preserveScenes: true, notebookKind: 'markdown' },
        );
        const warning = await projection(courseId, ownerId, 'markdown_notebook_replaced');
        return json(res, 200, { sections: result, warning });
      }
      if (path.length === 6 && req.method === 'PUT' && subresource === 'scenes') {
        if (n.pages.length)
          fail(409, 'Notebook has page records; scene replacement cannot keep them synchronized');
        if (n.notebookKind !== 'image') fail(409, 'Only image notebooks support scene replacement');
        const input = scenesSchema.parse(raw.scenes);
        const result = await notebooks.replaceOwnedNotebookScenes(
          db,
          ownerId,
          resourceId,
          input.map((s) => ({
            ...s,
            actions: s.actions == null ? Prisma.DbNull : s.actions,
            whiteboard: s.whiteboard == null ? Prisma.DbNull : s.whiteboard,
          })),
        );
        const warning = await projection(courseId, ownerId, 'notebook_updated');
        return json(res, 200, { scenes: result, warning });
      }
    }
    return json(res, 404, { error: 'Not found' });
  }

  return run;
}
