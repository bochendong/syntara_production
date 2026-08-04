import type { PrismaClient } from '@/lib/server/generated-prisma';

export const COURSE_HARD_RULE_LIMIT = 30;
export const COURSE_HARD_RULE_MAX_CHARS = 1_000;

export type CourseHardRulePromptItem = {
  id: string;
  content: string;
};

export async function listCourseHardRulesForPrompt(args: {
  prisma: PrismaClient;
  courseId: string;
  ownerId: string;
}): Promise<CourseHardRulePromptItem[]> {
  const rules = await args.prisma.courseHardRule.findMany({
    where: { courseId: args.courseId, ownerId: args.ownerId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: COURSE_HARD_RULE_LIMIT,
    select: { id: true, content: true },
  });
  return rules.flatMap((rule) => {
    const content = rule.content.trim();
    return content ? [{ id: rule.id, content }] : [];
  });
}
