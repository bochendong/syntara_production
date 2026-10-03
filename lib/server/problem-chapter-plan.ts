import { z } from 'zod';

export const CHAPTER_ARCHIVE_BATCH_SIZE = 80;
export const chapterArchivePlanSchema = z.object({
  chapters: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(240),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000),
      }),
    )
    .max(16),
  assignments: z
    .array(
      z.object({
        problemId: z.string().trim().min(1).max(240),
        chapterId: z.string().trim().min(1).max(240),
      }),
    )
    .max(CHAPTER_ARCHIVE_BATCH_SIZE),
});

export function normalizeChapterArchivePlan(
  plan: z.infer<typeof chapterArchivePlanSchema>,
  problemIds: ReadonlySet<string>,
  existingChapterIds: ReadonlySet<string>,
) {
  const keys = new Set(existingChapterIds);
  const chapters = plan.chapters.filter((chapter) => {
    if (keys.has(chapter.key)) return false;
    keys.add(chapter.key);
    return true;
  });
  const seen = new Set<string>();
  const assignments = plan.assignments.filter((assignment) => {
    if (
      seen.has(assignment.problemId) ||
      !problemIds.has(assignment.problemId) ||
      !keys.has(assignment.chapterId)
    ) {
      return false;
    }
    seen.add(assignment.problemId);
    return true;
  });
  const used = new Set(assignments.map((assignment) => assignment.chapterId));
  return { chapters: chapters.filter((chapter) => used.has(chapter.key)), assignments };
}

/** Only prompt text is needed for filing; never include image data or grading. */
export function chapterArchiveProblemText(content: unknown) {
  if (!content || typeof content !== 'object') return '';
  const value = content as Record<string, unknown>;
  const text = [value.stem, value.stemTemplate]
    .filter((part) => typeof part === 'string')
    .join('\n');
  return text.length <= 2400 ? text : `${text.slice(0, 2399)}…`;
}
