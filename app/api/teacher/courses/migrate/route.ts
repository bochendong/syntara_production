import { NextResponse } from 'next/server';
import { z } from 'zod';

import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';

const payloadSchema = z.object({
  sourceCourseId: z.string().trim().min(1),
  targetCourseId: z.string().trim().min(1),
  referenceIds: z.array(z.string().trim().min(1)).min(1).max(200),
});

function periodOrder(year: number, term: 'winter' | 'summer' | 'fall') {
  return year * 3 + { winter: 0, summer: 1, fall: 2 }[term];
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '迁移参数无效' }, { status: 400 });
    const input = parsed.data;
    if (input.sourceCourseId === input.targetCourseId) {
      return NextResponse.json({ error: '请选择另一门课程' }, { status: 400 });
    }
    const [sourceCourse, targetCourse] = await Promise.all([
      prisma.course.findFirst({
        where: { id: input.sourceCourseId, ...teacherCourseAccessWhere(teacher.userId) },
        select: { id: true, name: true, courseCode: true, academicYear: true, academicTerm: true },
      }),
      prisma.course.findFirst({
        where: { id: input.targetCourseId, ...teacherCourseAccessWhere(teacher.userId) },
        select: { id: true, name: true, courseCode: true, academicYear: true, academicTerm: true },
      }),
    ]);
    if (!sourceCourse || !targetCourse) {
      return NextResponse.json({ error: '课程不存在或没有教师权限' }, { status: 404 });
    }
    const sourceCode = sourceCourse.courseCode?.trim() || sourceCourse.name;
    const targetCode = targetCourse.courseCode?.trim() || targetCourse.name;
    if (sourceCode.toUpperCase() !== targetCode.toUpperCase()) {
      return NextResponse.json({ error: '只能迁移到相同课程代码的课程' }, { status: 409 });
    }
    if (
      !sourceCourse.academicYear ||
      !sourceCourse.academicTerm ||
      !targetCourse.academicYear ||
      !targetCourse.academicTerm ||
      periodOrder(sourceCourse.academicYear, sourceCourse.academicTerm) >=
        periodOrder(targetCourse.academicYear, targetCourse.academicTerm)
    ) {
      return NextResponse.json({ error: '源课程必须早于目标课程' }, { status: 409 });
    }

    const references = Array.from(new Set(input.referenceIds));
    const sourceIds = references.filter((id) => id.startsWith('source:')).map((id) => id.slice(7));
    const notebookIds = references
      .filter((id) => id.startsWith('notebook:'))
      .map((id) => id.slice(9));
    if (sourceIds.length + notebookIds.length !== references.length) {
      return NextResponse.json({ error: '迁移内容标识无效' }, { status: 400 });
    }
    const [sources, notebooks] = await Promise.all([
      prisma.courseSource.findMany({
        where: {
          id: { in: sourceIds },
          courseId: sourceCourse.id,
          ownerId: teacher.userId,
          removedAt: null,
        },
      }),
      prisma.notebook.findMany({
        where: {
          id: { in: notebookIds },
          courseId: sourceCourse.id,
          ownerId: teacher.userId,
          removedAt: null,
        },
        include: { markdownSections: { orderBy: { order: 'asc' } } },
      }),
    ]);
    if (sources.length !== sourceIds.length || notebooks.length !== notebookIds.length) {
      return NextResponse.json({ error: '部分迁移内容已不存在，请刷新后重试' }, { status: 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      let migratedCount = 0;
      let skippedCount = 0;
      const sourceIdMap = new Map<string, string>();
      for (const source of sources) {
        const existing = await tx.courseSource.findUnique({
          where: {
            courseId_sourceHash: { courseId: targetCourse.id, sourceHash: source.sourceHash },
          },
          select: { id: true },
        });
        if (existing) {
          sourceIdMap.set(source.id, existing.id);
          skippedCount += 1;
          continue;
        }
        const cloned = await tx.courseSource.create({
          data: {
            ownerId: teacher.userId,
            courseId: targetCourse.id,
            sourceHash: source.sourceHash,
            title: source.title,
            kind: 'teacher_upload',
            fileMime: source.fileMime,
            fileData: source.fileData,
            fileSize: source.fileSize,
            sourceCategory: source.sourceCategory,
            usageProfile: source.usageProfile,
            topic: source.topic,
            extractedText: source.extractedText,
            extractedTextHash: source.extractedTextHash,
            ingestStatus: source.ingestStatus,
            indexStatus: source.indexStatus,
            metadataJson: source.metadataJson ?? undefined,
            artifactCountsJson: source.artifactCountsJson ?? undefined,
            contentVersion: source.contentVersion,
            ingestedAt: source.ingestedAt,
            indexedAt: source.indexedAt,
          },
        });
        sourceIdMap.set(source.id, cloned.id);
        migratedCount += 1;
      }
      for (const notebook of notebooks) {
        const existing = await tx.notebook.findFirst({
          where: {
            courseId: targetCourse.id,
            ownerId: teacher.userId,
            sourceNotebookId: notebook.id,
          },
          select: { id: true },
        });
        if (existing) {
          skippedCount += 1;
          continue;
        }
        const cover =
          notebook.coverSlideJson &&
          typeof notebook.coverSlideJson === 'object' &&
          !Array.isArray(notebook.coverSlideJson)
            ? { ...(notebook.coverSlideJson as Record<string, unknown>) }
            : {};
        const oldSourceId =
          typeof cover.sourceId === 'string'
            ? cover.sourceId
            : typeof cover.sourceFileId === 'string'
              ? cover.sourceFileId
              : '';
        const mappedSourceId = sourceIdMap.get(oldSourceId);
        const cloned = await tx.notebook.create({
          data: {
            ownerId: teacher.userId,
            courseId: targetCourse.id,
            name: notebook.name,
            description: notebook.description,
            tags: notebook.tags,
            avatarUrl: notebook.avatarUrl,
            language: notebook.language,
            style: notebook.style,
            notebookKind: notebook.notebookKind,
            sourceNotebookId: notebook.id,
            sectionCount: notebook.sectionCount,
            problemCount: notebook.problemCount,
            coverSlideJson: toPrismaJson({
              ...cover,
              ...(mappedSourceId ? { sourceId: mappedSourceId, sourceFileId: mappedSourceId } : {}),
              migratedFromCourseId: sourceCourse.id,
              migratedAt: Date.now(),
              persistence: { status: 'complete', storage: 'postgresql', savedAt: Date.now() },
            }),
            mindMapData: notebook.mindMapData,
            mindMapMime: notebook.mindMapMime,
          },
        });
        if (notebook.markdownSections.length) {
          await tx.markdownNotebookSection.createMany({
            data: notebook.markdownSections.map((section) => ({
              notebookId: cloned.id,
              courseId: targetCourse.id,
              title: section.title,
              order: section.order,
              markdown: section.markdown,
              summary: section.summary,
              sourceMeta: section.sourceMeta ?? undefined,
            })),
          });
        }
        migratedCount += 1;
      }
      const notebookCount = await tx.notebook.count({
        where: { courseId: targetCourse.id, removedAt: null },
      });
      await tx.course.update({ where: { id: targetCourse.id }, data: { notebookCount } });
      return { migratedCount, skippedCount };
    });
    return NextResponse.json({ storage: 'postgresql', ...result });
  });
}
