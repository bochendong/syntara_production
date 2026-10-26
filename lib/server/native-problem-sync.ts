import {
  notebookProblemAttemptImageSchema,
  notebookProblemProgressSnapshotSchema,
} from '@/lib/problem-bank/schema';
import { isValidPhotoAnswerUpload } from '@/lib/problem-bank/photo-answer';
import { z } from 'zod';

import { createNotebookProblemAttempt } from '@/lib/server/notebook-problems/service';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { resolveCourseNotebookAccess } from '@/lib/server/repositories/course-enrollment-repository';
import { problemLayerWhere } from '@/lib/server/store-course-layers';

/**
 * App 端题库同步：题目按 updatedAt 增量下发，字段与 apps/native 的 LocalProblem 一致；
 * App 上的作答按网页「自评」同样的方式记进 NotebookProblemAttempt，网页题库能看到。
 */

/** 一门课最多同步这么多题，超出的按更新时间取最新的。 */
const NATIVE_PROBLEM_LIMIT = 3000;
export const NATIVE_ATTEMPT_UPLOAD_LIMIT = 100;

function timestamp(value: Date): number {
  return value.getTime();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 老师（课程拥有者）看得到草稿；学生只看已发布的，且只看已解锁笔记里的题。都只看「公有 + 自己的」，去掉自己隐藏的。 */
async function visibleProblemWhere(prisma: PrismaClient, userId: string, courseId: string) {
  const access = await resolveCourseNotebookAccess(prisma, userId, courseId);
  if (!access) return null;
  const owner = access.role === 'owner';
  const limited = !owner && access.notebookAccessLimit !== null;
  const layer = await problemLayerWhere(prisma, userId, courseId);
  return {
    courseId,
    AND: [
      layer,
      // 学员自己的私有题连草稿也看得到。
      owner
        ? { status: { in: ['draft' as const, 'published' as const] } }
        : { OR: [{ status: 'published' as const }, { ownerId: userId, status: 'draft' as const }] },
      ...(limited
        ? [
            {
              OR: [
                { notebookId: null },
                { notebookId: { in: access.allowedNotebookIds } },
                { ownerId: userId },
              ],
            },
          ]
        : []),
    ],
  };
}

export async function readNativeProblems(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
  since: number | null,
) {
  const where = await visibleProblemWhere(prisma, userId, courseId);
  if (!where) return null;
  const serverTime = Date.now();
  const ids = await prisma.notebookProblem.findMany({
    where,
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: NATIVE_PROBLEM_LIMIT,
  });
  const changedIds = ids
    .filter((row) => since === null || timestamp(row.updatedAt) > since)
    .map((row) => row.id);
  const [rows, progress] = await Promise.all([
    changedIds.length
      ? prisma.notebookProblem.findMany({
          where: { id: { in: changedIds } },
          select: {
            id: true,
            notebookId: true,
            chapterId: true,
            chapter: { select: { name: true } },
            title: true,
            type: true,
            status: true,
            difficulty: true,
            tags: true,
            order: true,
            publicContentJson: true,
            gradingJson: true,
            ownerId: true,
            releaseAddedIn: true,
            contentUpdatedAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]),
    prisma.notebookProblemProgress.findMany({
      where: { userId, problem: where },
      select: {
        problemId: true,
        latestAttemptId: true,
        status: true,
        score: true,
        attemptedCount: true,
        passedCount: true,
        lastAttemptAt: true,
        createdAt: true,
        updatedAt: true,
        problem: { select: { points: true } },
      },
      take: NATIVE_PROBLEM_LIMIT,
    }),
  ]);
  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { userId, courseId },
    select: { newSinceVersion: true },
  });
  return {
    courseId,
    serverTime,
    /** 题目的 releaseAddedIn 比它大就标「新」。课程拥有者没有这个值。 */
    newSinceVersion: enrollment?.newSinceVersion ?? null,
    /** 网页上这门课当前所有可见题目的 id；本机有、这里没有的就是网页上删掉或收回的。 */
    problemIds: ids.map((row) => row.id),
    complete: ids.length < NATIVE_PROBLEM_LIMIT,
    problems: rows.map((problem) => ({
      id: problem.id,
      courseId,
      notebookId: problem.notebookId,
      chapterId: problem.chapterId,
      chapterName: problem.chapter?.name ?? null,
      title: problem.title,
      type: problem.type,
      status: problem.status,
      difficulty: problem.difficulty,
      tags: problem.tags,
      publicContent: jsonRecord(problem.publicContentJson),
      grading: jsonRecord(problem.gradingJson),
      layer: problem.ownerId ? ('private' as const) : ('public' as const),
      releaseAddedIn: problem.releaseAddedIn,
      contentUpdatedAt: problem.contentUpdatedAt ? timestamp(problem.contentUpdatedAt) : null,
      createdAt: timestamp(problem.createdAt),
      updatedAt: timestamp(problem.updatedAt),
    })),
    progress: progress.map((row) => ({
      problemId: row.problemId,
      latestAttemptId: row.latestAttemptId,
      status: row.status,
      // App 用 0–1 的得分率，网页存的是按题目分值算的分。
      score:
        typeof row.score === 'number' && row.problem.points > 0
          ? Math.max(0, Math.min(1, row.score / row.problem.points))
          : null,
      attemptedCount: row.attemptedCount,
      passedCount: row.passedCount,
      lastAttemptAt: row.lastAttemptAt ? timestamp(row.lastAttemptAt) : null,
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
    })),
  };
}

export const nativeProblemAttemptUploadSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  attempts: z
    .array(
      z.object({
        id: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{8,80}$/),
        problemId: z.string().trim().min(1).max(200),
        status: z.enum(['pending', 'passed', 'failed', 'partial']),
        score: z.number().min(0).max(1).nullable(),
        answer: z.object({
          selectedOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
          text: z.string().max(40_000).optional(),
          code: z.string().max(120_000).optional(),
          parts: z
            .record(
              z.string().trim().min(1).max(40),
              z.object({
                selectedOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
                text: z.string().max(40_000).optional(),
                blanks: z.record(z.string(), z.string().max(4000)).optional(),
              }),
            )
            .optional(),
          images: z
            .array(notebookProblemAttemptImageSchema.refine(isValidPhotoAnswerUpload))
            .max(4)
            .optional(),
        }),
        feedback: z.string().max(8000).nullable().optional(),
        autoGraded: z.boolean().optional(),
        event: z.enum(['solution_viewed', 'answer_reset']).optional(),
        progressSnapshot: notebookProblemProgressSnapshotSchema.nullable().optional(),
        parts: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(40),
              status: z.enum(['pending', 'passed', 'failed', 'partial']),
              score: z.number().min(0).max(1),
              share: z.number().min(0).max(1),
              feedback: z.string().max(8000).optional(),
              gradedAt: z.number().int().positive().optional(),
              submissions: z.number().int().min(0).max(1000).optional(),
            }),
          )
          .max(12)
          .optional(),
        createdAt: z.number().int().positive(),
      }),
    )
    .max(NATIVE_ATTEMPT_UPLOAD_LIMIT),
});

export type NativeProblemAttemptUpload = z.infer<typeof nativeProblemAttemptUploadSchema>;

/** 网页那边的作答 id；同一条 App 作答重复上传时靠它去重。 */
function serverAttemptId(clientId: string): string {
  return `native_${clientId}`;
}

/** 返回已经记下（含之前就记过）和不再需要上传（题目已不可见）的 App 作答 id。 */
export async function saveNativeProblemAttempts(
  prisma: PrismaClient,
  userId: string,
  upload: NativeProblemAttemptUpload,
) {
  const where = await visibleProblemWhere(prisma, userId, upload.courseId);
  if (!where) return null;
  const problemIds = [...new Set(upload.attempts.map((attempt) => attempt.problemId))];
  const [problems, existing] = await Promise.all([
    prisma.notebookProblem.findMany({
      where: { ...where, id: { in: problemIds } },
      select: { id: true, points: true },
    }),
    prisma.notebookProblemAttempt.findMany({
      where: { id: { in: upload.attempts.map((attempt) => serverAttemptId(attempt.id)) } },
      select: { id: true },
    }),
  ]);
  const pointsById = new Map(problems.map((problem) => [problem.id, problem.points]));
  const existingIds = new Set(existing.map((attempt) => attempt.id));
  const saved: string[] = [];
  const skipped: string[] = [];
  const ordered = [...upload.attempts].sort((a, b) => a.createdAt - b.createdAt);
  for (const attempt of ordered) {
    const points = pointsById.get(attempt.problemId);
    if (points === undefined) {
      skipped.push(attempt.id);
      continue;
    }
    if (existingIds.has(serverAttemptId(attempt.id))) {
      saved.push(attempt.id);
      continue;
    }
    const score = attempt.score === null ? null : attempt.score * points;
    const createdAt = new Date(Math.min(attempt.createdAt, Date.now()));
    await createNotebookProblemAttempt({
      id: serverAttemptId(attempt.id),
      createdAt,
      userId,
      problemId: attempt.problemId,
      kind: 'answer',
      status: attempt.event ? 'pending' : attempt.status,
      score: attempt.event ? null : score,
      answer: attempt.answer,
      result: {
        correct: attempt.event ? null : attempt.status === 'passed',
        ...(attempt.event
          ? { event: attempt.event, progressSnapshot: attempt.progressSnapshot ?? null }
          : {}),
        feedback: attempt.feedback ?? '',
        earnedPoints: attempt.event ? undefined : (score ?? undefined),
        publicCases: [],
        ...(attempt.parts
          ? {
              parts: attempt.parts.map((part) => ({
                label: part.label,
                status: part.status,
                points: Math.round(part.share * points * 100) / 100,
                score: Math.round(part.score * part.share * points * 100) / 100,
                correct: part.status === 'passed',
                ...(part.feedback ? { feedback: part.feedback } : {}),
                ...(part.gradedAt ? { gradedAt: part.gradedAt } : {}),
                ...(part.submissions !== undefined ? { submissions: part.submissions } : {}),
              })),
            }
          : {}),
      },
      timingSource: attempt.event
        ? 'native-learning-snapshot'
        : attempt.autoGraded
          ? 'native-auto'
          : 'native',
      preserveProgress: Boolean(attempt.event),
    });
    saved.push(attempt.id);
  }
  return { saved, skipped };
}
