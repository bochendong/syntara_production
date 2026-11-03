import { contentDrafts } from './course-content-drafts';
import { randomUUID } from 'node:crypto';
import type { DbClient } from '@/lib/server/repositories/types';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';
import { pendingCourseRelease } from '@/lib/server/store-course-layers';
import { hasTeacherCourseAccess } from './external-course-access';
import {
  DuplicateCourseProblemError,
  updateCourseProblem,
} from '@/lib/server/notebook-problems/service';
import {
  canEditCourseProfile,
  CourseAdmissionError,
  lockAdmissionCourse,
  requireCourseManagement,
} from './course-admissions';

type Kind = 'notes' | 'problems';

async function managedCourse(db: DbClient, userId: string, courseId: string) {
  const course = await requireCourseManagement(db, userId, courseId);
  if (!(await canEditCourseProfile(db, userId, course)))
    throw new CourseAdmissionError(403, '没有管理这门课程内容的权限。');
  return course;
}

export async function listManagedCourseContent(
  db: DbClient,
  userId: string,
  courseId: string,
  kind: Kind,
  requestedPage: number,
  search: string,
  /** 题库按分组取：c:章节 id、n:笔记 id（没章节的）、none（都没有）。分组里按题号排、一页 100 道。 */
  group?: string,
) {
  const course = await managedCourse(db, userId, courseId);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const query = search.trim().toLowerCase().slice(0, 100);
  const pageSize = group ? 100 : 20;
  const live =
    kind === 'notes'
      ? await db.notebook.findMany({
          where: { courseId, ownerId: course.ownerId, removedAt: null },
          select: { id: true, name: true, updatedAt: true },
        })
      : await db.notebookProblem.findMany({
          where: { courseId, ownerId: null, status: { not: 'archived' } },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        });
  const rows = new Map<
    string,
    {
      id: string;
      title: string;
      updatedAt: Date;
      status: string | null;
      chapterId?: string | null;
      notebookId?: string | null;
      pending?: string;
    }
  >(
    live.map((row) => [
      row.id,
      {
        id: row.id,
        title: 'name' in row ? row.name : row.title,
        updatedAt: row.updatedAt,
        status: 'status' in row ? row.status : null,
        ...('chapterId' in row ? { chapterId: row.chapterId, notebookId: row.notebookId } : {}),
      },
    ]),
  );
  for (const draft of (await contentDrafts(db, courseId)).filter((row) => row.kind === kind)) {
    const p = draft.payload;
    rows.set(draft.targetId, {
      id: draft.targetId,
      title: p.name || p.title,
      updatedAt: draft.updatedAt,
      status: kind === 'problems' ? p.status || 'draft' : null,
      chapterId: p.chapterId,
      notebookId: p.notebookId,
      pending: draft.operation === 'delete' ? 'delete' : draft.baseUpdatedAt ? 'update' : 'add',
    });
  }
  const filtered = [...rows.values()].filter(
    (row) =>
      (!query || row.title.toLowerCase().includes(query)) &&
      (!group ||
        (group.startsWith('c:')
          ? row.chapterId === group.slice(2)
          : group.startsWith('n:')
            ? !row.chapterId && row.notebookId === group.slice(2)
            : !row.chapterId && !row.notebookId)),
  );
  return {
    total: filtered.length,
    page,
    pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
  };
}

export async function addManagedCourseContent(
  db: DbClient,
  userId: string,
  courseId: string,
  kind: Kind,
  title: string,
  text: string,
) {
  await lockAdmissionCourse(db, courseId);
  const course = await managedCourse(db, userId, courseId);
  if (kind === 'notes') {
    const id = randomUUID();
    await db.notebook.create({
      data: {
        id,
        ownerId: course.ownerId,
        courseId,
        name: title,
        description: '课程笔记',
        tags: [],
        notebookKind: 'markdown',
        sectionCount: 1,
      },
    });
    await db.markdownNotebookSection.create({
      data: {
        notebookId: id,
        courseId,
        title,
        order: 0,
        markdown: text,
        summary: text.slice(0, 240),
        sourceMeta: { source: 'course-management' },
      },
    });
  } else {
    const last = await db.notebookProblem.aggregate({ where: { courseId }, _max: { order: true } });
    await db.notebookProblem.create({
      data: {
        courseId,
        ownerId: null,
        title,
        type: 'short_answer',
        status: 'draft',
        source: 'manual',
        order: (last._max.order ?? -1) + 1,
        tags: [],
        publicContentJson: { type: 'short_answer', stem: text },
        gradingJson: { type: 'short_answer' },
      },
    });
  }
  await refreshCourseSummaryFields(db, courseId);
  await db.course.update({ where: { id: courseId }, data: { contentVersion: { increment: 1 } } });
}

export async function removeManagedCourseContent(
  db: DbClient,
  userId: string,
  courseId: string,
  kind: Kind,
  id: string,
) {
  await lockAdmissionCourse(db, courseId);
  const course = await managedCourse(db, userId, courseId);
  const problem =
    kind === 'problems'
      ? await db.notebookProblem.findFirst({
          where: { id, courseId, ownerId: null, status: { not: 'archived' } },
          select: { notebookId: true },
        })
      : null;
  const result =
    kind === 'notes'
      ? await db.notebook.updateMany({
          where: { id, courseId, ownerId: course.ownerId, removedAt: null },
          data: { removedAt: new Date() },
        })
      : await db.notebookProblem.deleteMany({
          where: { id, courseId, ownerId: null, status: { not: 'archived' } },
        });
  if (!result.count) throw new CourseAdmissionError(404, '内容不存在或已删除。');
  if (problem?.notebookId) {
    const notebookId = problem.notebookId;
    const [problemCount, publishedProblemCount] = await Promise.all([
      db.notebookProblem.count({ where: { notebookId } }),
      db.notebookProblem.count({ where: { notebookId, status: 'published' } }),
    ]);
    await db.notebook.updateMany({
      where: { id: notebookId },
      data: { problemCount, publishedProblemCount },
    });
  }
  await refreshCourseSummaryFields(db, courseId);
  await db.course.update({ where: { id: courseId }, data: { contentVersion: { increment: 1 } } });
}

/**
 * 课程管理里手动改一本笔记：改名、改各小节的 Markdown。只改这门课公有层（课程主人名下）的笔记。
 * 幻灯片式笔记没有 Markdown 小节，只能改名。
 */
export async function updateManagedCourseNote(
  db: DbClient,
  userId: string,
  courseId: string,
  id: string,
  patch: { title?: string; sections?: Array<{ id: string; markdown: string }> },
) {
  await lockAdmissionCourse(db, courseId);
  const course = await managedCourse(db, userId, courseId);
  const notebook = await db.notebook.findFirst({
    where: { id, courseId, ownerId: course.ownerId, removedAt: null },
    select: { id: true, markdownSections: { select: { id: true } } },
  });
  if (!notebook) throw new CourseAdmissionError(404, '笔记不存在或已删除。');
  const sectionIds = new Set(notebook.markdownSections.map((section) => section.id));
  for (const section of patch.sections ?? []) {
    if (!sectionIds.has(section.id)) throw new CourseAdmissionError(400, '笔记小节不存在。');
    await db.markdownNotebookSection.update({
      where: { id: section.id },
      data: { markdown: section.markdown, summary: section.markdown.slice(0, 240) },
    });
  }
  await db.notebook.update({
    where: { id },
    data: {
      ...(patch.title ? { name: patch.title } : {}),
      contentVersion: { increment: 1 },
    },
  });
  await db.course.update({ where: { id: courseId }, data: { contentVersion: { increment: 1 } } });
}

/**
 * 课程管理里手动改一道公有题。先按课程管理权限（主人、带课老师、机构成员）检查，
 * 再以课程主人的身份走题库原有的 updateCourseProblem（同一套校验、去重和章节检查）。
 */
export async function updateManagedCourseProblem(
  db: DbClient,
  userId: string,
  courseId: string,
  id: string,
  patch: {
    title?: string;
    status?: 'draft' | 'published';
    difficulty?: 'easy' | 'medium' | 'hard';
    chapterId?: string | null;
    notebookId?: string | null;
    publicContent?: unknown;
    grading?: unknown;
  },
) {
  const course = await managedCourse(db, userId, courseId);
  const problem = await db.notebookProblem.findFirst({
    where: { id, courseId, ownerId: null, status: { not: 'archived' } },
    select: { id: true },
  });
  if (!problem) throw new CourseAdmissionError(404, '题目不存在或已删除。');
  try {
    await updateCourseProblem({ userId: course.ownerId, courseId, problemId: id, patch });
  } catch (error) {
    if (error instanceof DuplicateCourseProblemError)
      throw new CourseAdmissionError(409, '课程里已经有一道相同的题目。');
    if (error instanceof Error && /章节/.test(error.message))
      throw new CourseAdmissionError(400, error.message);
    throw error;
  }
  await refreshCourseSummaryFields(db, courseId);
  await db.course.update({ where: { id: courseId }, data: { contentVersion: { increment: 1 } } });
}

/**
 * 题库的分组和每组题数，和学生题库一样：先按课程章节（含还没有题的章节），
 * 没章节的按所属笔记，都没有的归「未分组」。
 */
export async function listManagedProblemGroups(db: DbClient, userId: string, courseId: string) {
  const course = await managedCourse(db, userId, courseId);
  const base = { courseId, ownerId: null, status: { not: 'archived' as const } };
  const [chapters, chapterCounts, notebookCounts, notebooks] = await Promise.all([
    db.courseProblemChapter.findMany({
      where: { courseId },
      select: { id: true, name: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
    db.notebookProblem.groupBy({
      by: ['chapterId'],
      where: { ...base, chapterId: { not: null } },
      _count: { _all: true },
    }),
    db.notebookProblem.groupBy({
      by: ['notebookId'],
      where: { ...base, chapterId: null },
      _count: { _all: true },
    }),
    db.notebook.findMany({
      where: { courseId, ownerId: course.ownerId, removedAt: null },
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const byChapter = new Map(chapterCounts.map((row) => [row.chapterId, row._count._all]));
  const byNotebook = new Map(notebookCounts.map((row) => [row.notebookId, row._count._all]));
  for (const draft of await contentDrafts(db, courseId)) {
    if (draft.kind === 'notes' && !draft.baseUpdatedAt && draft.operation === 'save')
      notebooks.push({ id: draft.targetId, name: draft.payload.name });
    if (draft.kind !== 'problems') continue;
    const previous = await db.notebookProblem.findUnique({
      where: { id: draft.targetId },
      select: { chapterId: true, notebookId: true },
    });
    if (previous) {
      const map = previous.chapterId ? byChapter : byNotebook;
      const key = previous.chapterId || previous.notebookId;
      map.set(key, (map.get(key) || 0) - 1);
    }
    const p = draft.payload;
    const map = p.chapterId ? byChapter : byNotebook;
    const key = p.chapterId || p.notebookId || null;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const notebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const ungrouped = [...byNotebook]
    .filter(([id]) => !id || !notebookIds.has(id))
    .reduce((sum, [, count]) => sum + count, 0);
  return {
    chapters: chapters.map((chapter) => ({
      key: `c:${chapter.id}`,
      id: chapter.id,
      name: chapter.name,
      count: byChapter.get(chapter.id) ?? 0,
    })),
    notebooks: notebooks.map((notebook) => ({
      key: `n:${notebook.id}`,
      id: notebook.id,
      name: notebook.name,
      count: byNotebook.get(notebook.id) ?? 0,
    })),
    ungrouped,
  };
}

const TERM_LABELS = { winter: '冬季', summer: '夏季', fall: '秋季' } as const;
const TERM_ORDER = { winter: 0, summer: 1, fall: 2 } as const;
const termOf = (date: Date) => {
  const month = date.getMonth() + 1;
  const term: keyof typeof TERM_LABELS = month <= 4 ? 'winter' : month <= 8 ? 'summer' : 'fall';
  return {
    key: `${date.getFullYear()}-${term}`,
    label: `${date.getFullYear()} ${TERM_LABELS[term]}`,
    sort: date.getFullYear() * 10 + TERM_ORDER[term],
  };
};
/** 学生都从商城加入：直接加入（store）或老师批准（approval）。 */
const STORE_SOURCES = ['store', 'approval'];

async function requireStudentManagement(db: DbClient, userId: string, courseId: string) {
  const course = await requireCourseManagement(db, userId, courseId);
  if (course.ownerId !== userId) {
    const viewer = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (viewer?.role !== 'ADMIN' && !(await hasTeacherCourseAccess(db, userId, courseId)))
      throw new CourseAdmissionError(403, '你没有这门课的学生管理权限。');
  }
  return course;
}

/**
 * 从商城加入这门课的学生，按加入的学期分组。机构课程带上最近活跃时间（做题或提问）；
 * 私有课程不看学生的做题和提问，只给加入时间。
 */
export async function listManagedCourseStudents(db: DbClient, userId: string, courseId: string) {
  const course = await requireStudentManagement(db, userId, courseId);
  const enrollments = await db.courseEnrollment.findMany({
    where: { courseId, userId: { not: course.ownerId }, source: { in: STORE_SOURCES } },
    select: {
      joinedAt: true,
      source: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: [{ joinedAt: 'desc' }],
    take: 5000,
  });
  const insights = Boolean(course.organizationId);
  const ids = enrollments.map((enrollment) => enrollment.user.id);
  const [attempts, questions] =
    insights && ids.length
      ? await Promise.all([
          db.notebookProblemAttempt.groupBy({
            by: ['userId'],
            where: { userId: { in: ids }, problem: { courseId, ownerId: null } },
            _max: { createdAt: true },
          }),
          db.courseConversationMessage.groupBy({
            by: ['ownerId'],
            where: { ownerId: { in: ids }, courseId, role: 'user', deletedAt: null },
            _max: { createdAt: true },
          }),
        ])
      : [[], []];
  const lastActive = new Map<string, Date>();
  for (const row of attempts)
    if (row._max.createdAt) lastActive.set(row.userId, row._max.createdAt);
  for (const row of questions) {
    const at = row._max.createdAt;
    const previous = lastActive.get(row.ownerId);
    if (at && (!previous || at > previous)) lastActive.set(row.ownerId, at);
  }
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      sort: number;
      students: Array<{
        userId: string;
        name: string | null;
        email: string | null;
        image: string | null;
        joinedAt: Date;
        method: 'open' | 'approval';
        lastActiveAt: Date | null;
      }>;
    }
  >();
  for (const enrollment of enrollments) {
    const term = termOf(enrollment.joinedAt);
    const group = groups.get(term.key) ?? { ...term, students: [] };
    group.students.push({
      userId: enrollment.user.id,
      name: enrollment.user.name,
      email: enrollment.user.email,
      image: enrollment.user.image,
      joinedAt: enrollment.joinedAt,
      method: enrollment.source === 'approval' ? 'approval' : 'open',
      lastActiveAt: lastActive.get(enrollment.user.id) ?? null,
    });
    groups.set(term.key, group);
  }
  return {
    total: enrollments.length,
    insights,
    terms: [...groups.values()]
      .sort((a, b) => b.sort - a.sort)
      .map(({ sort: _sort, ...term }) => term),
  };
}

const answerPreview = (answer: unknown): string => {
  if (!answer || typeof answer !== 'object') return '';
  const record = answer as Record<string, unknown>;
  const text = [record.code, record.text].find(
    (value) => typeof value === 'string' && value.trim(),
  ) as string | undefined;
  if (text) return text.trim().slice(0, 400);
  if (Array.isArray(record.selectedOptionIds)) return `选了 ${record.selectedOptionIds.join('、')}`;
  return '';
};
const messageText = (plainText: string | null, content: unknown): string => {
  if (plainText?.trim()) return plainText.trim().slice(0, 600);
  if (typeof content === 'string') return content.trim().slice(0, 600);
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text.trim().slice(0, 600);
  }
  return '';
};

/**
 * 一个学生在这门课里的情况。课程主人、课程老师和管理员可看，只读这门课的数据。
 * 机构课程才有学情（做题、提问、正确率）；私有课程只有基本信息和加入时填的内容。
 */
export async function getManagedCourseStudent(
  db: DbClient,
  userId: string,
  courseId: string,
  studentId: string,
) {
  const course = await requireStudentManagement(db, userId, courseId);
  const enrollment = await db.courseEnrollment.findFirst({
    where: { courseId, userId: studentId, source: { in: STORE_SOURCES } },
    select: {
      joinedAt: true,
      source: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });
  if (!enrollment) throw new CourseAdmissionError(404, '这个学生不在这门课里。');
  const application = await db.courseJoinApplication.findUnique({
    where: { courseId_userId: { courseId, userId: studentId } },
    select: { answersJson: true },
  });
  const answers = Array.isArray(application?.answersJson)
    ? (application.answersJson as Array<{ id?: string; label?: string; value?: string }>)
        .filter((answer) => answer?.label && typeof answer.value === 'string')
        .map((answer) => ({
          id: answer.id ?? answer.label!,
          label: answer.label!,
          value: answer.value!,
        }))
    : [];
  const student = {
    userId: enrollment.user.id,
    name: enrollment.user.name,
    email: enrollment.user.email,
    image: enrollment.user.image,
    joinedAt: enrollment.joinedAt,
    method: enrollment.source === 'approval' ? ('approval' as const) : ('open' as const),
    answers,
  };
  if (!course.organizationId) return { student, insights: null };
  const publicProblem = { courseId, ownerId: null };
  const [attempted, passed, attemptCount, attempts, questions, recentProblems] = await Promise.all([
    db.notebookProblem.count({
      where: { ...publicProblem, attempts: { some: { userId: studentId } } },
    }),
    db.notebookProblem.count({
      where: { ...publicProblem, attempts: { some: { userId: studentId, status: 'passed' } } },
    }),
    db.notebookProblemAttempt.count({ where: { userId: studentId, problem: publicProblem } }),
    db.notebookProblemAttempt.findMany({
      where: { userId: studentId, problem: publicProblem },
      select: {
        id: true,
        status: true,
        score: true,
        answerJson: true,
        createdAt: true,
        problem: { select: { id: true, title: true, chapter: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    }),
    db.courseConversationMessage.findMany({
      where: {
        ownerId: studentId,
        courseId,
        role: 'user',
        deletedAt: null,
        conversation: { deletedAt: null },
      },
      select: {
        id: true,
        plainText: true,
        content: true,
        createdAt: true,
        conversation: { select: { id: true, title: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    }),
    db.notebookProblemAttempt.groupBy({
      by: ['problemId'],
      where: { userId: studentId, problem: publicProblem },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _max: { createdAt: 'desc' } }, { problemId: 'asc' }],
      take: 20,
    }),
  ]);
  const problems = await db.notebookProblem.findMany({
    where: { ...publicProblem, id: { in: recentProblems.map((row) => row.problemId) } },
    select: {
      id: true,
      title: true,
      chapter: { select: { name: true } },
      attempts: {
        where: { userId: studentId },
        select: { status: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
      },
      _count: { select: { attempts: { where: { userId: studentId, status: 'passed' } } } },
    },
  });
  const byId = new Map(problems.map((problem) => [problem.id, problem]));
  const lastActiveAt = [attempts[0]?.createdAt, questions[0]?.createdAt]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    student,
    insights: {
      attempted,
      passed,
      accuracy: attempted ? passed / attempted : null,
      attemptCount,
      lastActiveAt: lastActiveAt ?? null,
      problems: recentProblems.flatMap((row) => {
        const problem = byId.get(row.problemId);
        if (!problem) return [];
        return [
          {
            id: problem.id,
            title: problem.title,
            chapterName: problem.chapter?.name ?? null,
            status:
              problem._count.attempts > 0
                ? ('passed' as const)
                : (problem.attempts[0]?.status ?? 'pending'),
            attemptCount: row._count._all,
            lastAttemptAt: row._max.createdAt!,
          },
        ];
      }),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        problemId: attempt.problem.id,
        title: attempt.problem.title,
        chapterName: attempt.problem.chapter?.name ?? null,
        status: attempt.status,
        score: attempt.score,
        answerPreview: answerPreview(attempt.answerJson),
        createdAt: attempt.createdAt,
      })),
      questions: questions
        .map((message) => ({
          id: message.id,
          text: messageText(message.plainText, message.content),
          createdAt: message.createdAt,
          conversationTitle: message.conversation.title,
        }))
        .filter((question) => question.text),
    },
  };
}

/**
 * 头部「发布」按钮：上次发布以来有多少新增 / 改过的公有内容。
 * 只有课程主人能发布（机构课程和私有课程都可以，和 store 路由里的 release 动作同一条规则）。
 */
export async function managedReleaseStatus(db: DbClient, userId: string, courseId: string) {
  const course = await managedCourse(db, userId, courseId);
  const drafts = await contentDrafts(db, courseId);
  const pending = await pendingCourseRelease(
    db,
    courseId,
    course.ownerId,
    drafts.map((row) => row.targetId),
  );
  const deletions = drafts.filter((row) => row.operation === 'delete').length;
  const draftCount = drafts.filter(
    (row) => row.kind === 'problems' && row.operation === 'save' && row.payload.status === 'draft',
  ).length;
  for (const row of drafts) {
    if (row.operation === 'delete' || (row.kind === 'problems' && row.payload.status === 'draft'))
      continue;
    const key =
      row.kind === 'notes'
        ? row.baseUpdatedAt
          ? 'updatedNotebooks'
          : 'addedNotebooks'
        : row.baseUpdatedAt
          ? 'updatedProblems'
          : 'addedProblems';
    pending[key] += 1;
  }
  return {
    ...pending,
    deletions,
    draftCount,
    changes: drafts.map((row) => ({
      id: row.targetId,
      kind: row.kind,
      operation: row.operation,
      title: row.payload.name || row.payload.title,
      draft: row.kind === 'problems' && row.payload.status === 'draft',
    })),
    total:
      deletions +
      pending.addedProblems +
      pending.updatedProblems +
      pending.addedNotebooks +
      pending.updatedNotebooks,
    canRelease: await canEditCourseProfile(db, userId, course),
    lastReleasedAt: course.lastReleasedAt,
    version: course.contentVersion,
  };
}

/** Read a bounded page or one full submission, always within this managed public course. */
export async function getManagedCourseStudentAttempts(
  db: DbClient,
  userId: string,
  courseId: string,
  studentId: string,
  problemId: string,
  requestedPage = 1,
  attemptId?: string,
) {
  const course = await requireStudentManagement(db, userId, courseId);
  if (!course.organizationId) throw new CourseAdmissionError(403, '私有课程不显示学生的做题记录。');
  const enrollment = await db.courseEnrollment.findFirst({
    where: { courseId, userId: studentId, source: { in: STORE_SOURCES } },
    select: { id: true },
  });
  if (!enrollment) throw new CourseAdmissionError(404, '这个学生不在这门课里。');
  const where = { userId: studentId, problemId, problem: { courseId, ownerId: null } };
  if (attemptId) {
    const attempt = await db.notebookProblemAttempt.findFirst({
      where: { ...where, id: attemptId },
      select: {
        id: true,
        status: true,
        score: true,
        createdAt: true,
        answerJson: true,
        resultJson: true,
        activeDurationMs: true,
        problem: { select: { title: true, publicContentJson: true } },
      },
    });
    if (!attempt) throw new CourseAdmissionError(404, '找不到这次做题记录。');
    const content = attempt.problem.publicContentJson as { language?: unknown } | null;
    return {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        score: attempt.score,
        createdAt: attempt.createdAt,
        answer: attempt.answerJson,
        result: attempt.resultJson,
        activeDurationMs: attempt.activeDurationMs,
        title: attempt.problem.title,
        language: typeof content?.language === 'string' ? content.language : undefined,
      },
    };
  }
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const pageSize = 20;
  const [total, attempts] = await Promise.all([
    db.notebookProblemAttempt.count({ where }),
    db.notebookProblemAttempt.findMany({
      where,
      select: { id: true, status: true, score: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { attempts, total, page, pageSize };
}
