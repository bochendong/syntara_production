import { z } from 'zod';

import type { PrismaClient } from '@/lib/server/generated-prisma';
import { draftAuthority } from '@/lib/server/course-content-drafts';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import {
  COURSE_HARD_RULE_LIMIT,
  COURSE_HARD_RULE_MAX_CHARS,
  listCourseHardRulesForPrompt,
  type CourseHardRulePromptItem,
} from '@/lib/server/course-hard-rules';

/**
 * 课程的 AI 规则包：老师在 App「管理课程 → AI 规则」里维护的一组规则（存在 CourseHardRule，
 * 和网页老师端的 Hard Rule 是同一张表）。App 的课程助教每次回答都会带上。
 */
export type CourseAiRule = { id: string; content: string; updatedAt: string };

export const courseAiRulesInputSchema = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(200).optional(),
      content: z.string().trim().min(1).max(COURSE_HARD_RULE_MAX_CHARS),
    }),
  )
  .max(COURSE_HARD_RULE_LIMIT);

type Db = PrismaClient;

export async function listCourseAiRules(
  db: Db,
  userId: string,
  courseId: string,
): Promise<{ rules: CourseAiRule[]; limit: number; maxChars: number }> {
  const course = await draftAuthority(db, userId, courseId);
  const rules = await db.courseHardRule.findMany({
    where: { courseId, ownerId: course.ownerId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, content: true, updatedAt: true },
  });
  return {
    rules: rules.map((rule) => ({ ...rule, updatedAt: rule.updatedAt.toISOString() })),
    limit: COURSE_HARD_RULE_LIMIT,
    maxChars: COURSE_HARD_RULE_MAX_CHARS,
  };
}

/** 整包保存：按传入顺序写 position，没传的旧规则删除。 */
export async function saveCourseAiRules(
  db: Db,
  userId: string,
  courseId: string,
  input: z.infer<typeof courseAiRulesInputSchema>,
) {
  const course = await draftAuthority(db, userId, courseId);
  await db.$transaction(async (tx) => {
    const existing = await tx.courseHardRule.findMany({
      where: { courseId, ownerId: course.ownerId },
      select: { id: true },
    });
    const keep = new Set(input.flatMap((rule) => (rule.id ? [rule.id] : [])));
    const known = new Set(existing.map((rule) => rule.id));
    await tx.courseHardRule.deleteMany({
      where: { courseId, ownerId: course.ownerId, id: { notIn: [...keep] } },
    });
    for (const [position, rule] of input.entries()) {
      if (rule.id && known.has(rule.id)) {
        await tx.courseHardRule.update({
          where: { id: rule.id },
          data: { content: rule.content, position },
        });
      } else {
        await tx.courseHardRule.create({
          data: { courseId, ownerId: course.ownerId, content: rule.content, position },
        });
      }
    }
  });
  return listCourseAiRules(db, userId, courseId);
}

/**
 * 聊天用：只要提问的人能读这门课（主人、加入的学生、老师、管理员），就给这门课主人设的规则。
 * 读不到课程时返回空，不报错。
 */
export async function loadCourseAiRulesForChat(
  db: Db,
  userId: string,
  courseId: string,
): Promise<CourseHardRulePromptItem[]> {
  const [role, user] = await Promise.all([
    findCourseAccessRole(db, userId, courseId),
    db.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  if (!role && user?.role !== 'ADMIN') return [];
  const course = await db.course.findUnique({ where: { id: courseId }, select: { ownerId: true } });
  if (!course) return [];
  return listCourseHardRulesForPrompt({ prisma: db, courseId, ownerId: course.ownerId });
}
