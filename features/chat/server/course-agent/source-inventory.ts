import type { PrismaClient } from '@/lib/server/generated-prisma';

/**
 * Metadata-only inventory of a course's uploaded sources, used by the teacher
 * course agent to explain why something is missing from the problem bank or the
 * notebooks. Never reads file data or extracted text.
 *
 * Source titles are the teacher's own upload list and may appear in this hint
 * context only — never as provenance of a problem-bank problem.
 */

export type CourseSourceCategoryLabel = '课件' | '速成课件' | '题库原件' | '其他';
export type CourseSourceStatusLabel = '未处理' | '处理中' | '已完成' | '失败';

export type CourseSourceInventoryItem = {
  title: string;
  category: CourseSourceCategoryLabel;
  status: CourseSourceStatusLabel;
  /** Non-archived problems in this course imported from this source. */
  convertedProblemCount: number;
  /** A teacher notebook generated from this source exists (not removed). */
  hasNotebook: boolean;
};

export type CourseSourceInventory = CourseSourceInventoryItem[];

const INVENTORY_LIMIT = 60;

function categoryLabel(value: string | null): CourseSourceCategoryLabel {
  if (value === 'school_teacher_notes') return '课件';
  if (value === 'crash_course_teacher_notes') return '速成课件';
  if (value === 'problem_bank') return '题库原件';
  return '其他';
}

function statusLabel(ingestStatus: string, indexStatus: string): CourseSourceStatusLabel {
  if (ingestStatus === 'error' || indexStatus === 'error') return '失败';
  if (ingestStatus === 'processing' || indexStatus === 'indexing') return '处理中';
  if (ingestStatus === 'ready' || ingestStatus === 'completed') return '已完成';
  return '未处理';
}

export async function loadCourseSourceInventory(args: {
  db: PrismaClient;
  courseId: string;
}): Promise<CourseSourceInventory> {
  const [sources, links] = await Promise.all([
    args.db.courseSource.findMany({
      where: { courseId: args.courseId, removedAt: null },
      orderBy: { createdAt: 'desc' },
      take: INVENTORY_LIMIT,
      select: {
        id: true,
        title: true,
        sourceCategory: true,
        ingestStatus: true,
        indexStatus: true,
      },
    }),
    args.db.$queryRaw<Array<{ kind: string; sourceId: string | null; count: number }>>`
      SELECT 'problem' AS "kind",
             p."sourceMeta"->>'courseSourceId' AS "sourceId",
             COUNT(*)::int AS "count"
        FROM "NotebookProblem" p
       WHERE p."courseId" = ${args.courseId}

         AND p."sourceMeta"->>'courseSourceId' IS NOT NULL
       GROUP BY p."sourceMeta"->>'courseSourceId'
      UNION ALL
      SELECT 'notebook' AS "kind",
             -- The source processing route names teacher notebooks
             -- 'teacher-notebook:' || sourceId; 18 = length(prefix) + 1.
             SUBSTRING(n."id" FROM 18) AS "sourceId",
             1 AS "count"
        FROM "Notebook" n
       WHERE n."courseId" = ${args.courseId}
         AND n."removedAt" IS NULL
         AND n."id" LIKE 'teacher-notebook:%'
    `,
  ]);
  const problemCounts = new Map<string, number>();
  const notebookSources = new Set<string>();
  for (const link of links) {
    if (!link.sourceId) continue;
    if (link.kind === 'problem') problemCounts.set(link.sourceId, Number(link.count) || 0);
    else notebookSources.add(link.sourceId);
  }
  return sources.map((source) => ({
    title: source.title,
    category: categoryLabel(source.sourceCategory),
    status: statusLabel(source.ingestStatus, source.indexStatus),
    convertedProblemCount: problemCounts.get(source.id) ?? 0,
    hasNotebook: notebookSources.has(source.id),
  }));
}

function isConverted(item: CourseSourceInventoryItem): boolean {
  return item.convertedProblemCount > 0 || item.hasNotebook;
}

function conversionText(item: CourseSourceInventoryItem): string {
  const parts: string[] = [];
  if (item.convertedProblemCount > 0) parts.push(`已转为 ${item.convertedProblemCount} 道题库题`);
  if (item.hasNotebook) parts.push('已生成笔记本');
  return parts.length ? parts.join('，') : '尚未转换';
}

/** Compact Chinese list for the teacher system prompt. */
export function formatSourceInventoryForPrompt(inventory: CourseSourceInventory): string {
  if (!inventory.length) return '课程上传资料：暂无。';
  const lines = inventory.map(
    (item, index) =>
      `${index + 1}. 《${item.title}》 · ${item.category} · ${item.status} · ${conversionText(item)}`,
  );
  return [
    `课程上传资料（仅元数据，共 ${inventory.length} 份；不能读取原件内容，也不能作为题目出处）：`,
    ...lines,
  ].join('\n');
}

/**
 * Hint for the teacher when the problem bank and notebooks had nothing: names the
 * uploads that are not yet converted, or falls back to a generic hint.
 */
export function unconvertedSourceHint(inventory: CourseSourceInventory): string {
  const pending = inventory.filter((item) => !isConverted(item));
  if (!pending.length) {
    return '题库和课程笔记本中都没有找到相关内容。原始资料可能已经上传但还没有整理进题库或笔记本；可以在课程资料页上传或处理对应资料后再试。';
  }
  const shown = pending.slice(0, 8).map((item) => {
    const detail =
      item.status === '失败'
        ? '处理失败，可重新处理'
        : item.status === '处理中'
          ? '正在处理'
          : item.status === '已完成'
            ? '已处理但没有生成题目或笔记本'
            : '尚未处理';
    return `《${item.title}》（${item.category}，${detail}）`;
  });
  const more = pending.length > shown.length ? ` 等 ${pending.length} 份` : '';
  return `题库和课程笔记本中都没有找到相关内容。以下已上传资料尚未转换进题库或笔记本：${shown.join('、')}${more}。原题可能就在其中，处理完成后即可在题库或笔记本中检索到。`;
}
