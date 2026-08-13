import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import {
  buildLearnerAnalytics,
  type LearnerAnalytics,
  type LearnerAnalyticsTimeScope,
} from '@/lib/server/memory-learner-analytics';
import type { MemorySearchIntent, MemorySearchIntentKind } from '@/lib/server/memory-search-intent';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';

export type CourseAgentLearningFocus = 'questions' | 'status' | 'weakness' | 'all';

export type CourseLearnerSignalInput = {
  signalType: 'stuck' | 'error_pattern' | 'mastered';
  knowledgePoint: string;
  evidenceExcerpt: string;
  stuckPoint?: string;
  cause?: string;
  masteredSignal?: string;
  nextTeachingMove: string;
};

function compact(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN');
}

function timeScopeQuery(scope: LearnerAnalyticsTimeScope): string {
  if (scope === 'week') return '这周';
  if (scope === 'month') return '这个月';
  if (scope === 'term') return '整学期';
  return '全部历史';
}

function focusIntentKind(focus: CourseAgentLearningFocus): MemorySearchIntentKind {
  if (focus === 'questions') return 'learner_questions';
  if (focus === 'weakness') return 'weakness_review';
  return 'learning_status';
}

function analyticsIntent(args: {
  focus: CourseAgentLearningFocus;
  timeScope: LearnerAnalyticsTimeScope;
}): MemorySearchIntent {
  const kind = focusIntentKind(args.focus);
  const query = `${timeScopeQuery(args.timeScope)}学生${
    args.focus === 'questions'
      ? '问过什么'
      : args.focus === 'weakness'
        ? '有哪些薄弱点'
        : '学习状态怎么样'
  }`;
  const knowledgeTypes: MemorySearchIntent['knowledgeTypes'] =
    args.focus === 'questions'
      ? ['learner_history']
      : ['learner_history', 'study_memory', 'problem_bank'];
  return {
    kind,
    originalQuery: query,
    rewrittenQuery: query,
    progressFilter: args.focus === 'weakness' ? 'wrong_or_partial' : null,
    scopeMode: 'course_wide',
    scopeReason: '当前查询面向整门课程中的一个学生。',
    knowledgeTypes,
    sourceGrounding: {
      required: false,
      reason: '学习状态以聊天、作答和私有学习记忆为证据。',
      signals: [],
    },
    matchedSignals: [kind],
    notes: [],
    source: 'fallback',
    plan: {
      summary: query,
      answerMode: args.focus === 'weakness' ? 'review_weakness' : 'mixed',
      primarySources: knowledgeTypes,
      secondarySources: [],
      searchQueries: [query],
      filters: {
        progress: args.focus === 'weakness' ? 'wrong_or_partial' : null,
        tags: [],
        notebookHints: [],
        courseHints: [],
      },
    },
  };
}

export async function loadCourseLearnerInsight(args: {
  prisma: PrismaClient;
  courseId: string;
  userId: string;
  focus: CourseAgentLearningFocus;
  timeScope: LearnerAnalyticsTimeScope;
}): Promise<LearnerAnalytics | null> {
  const intent = analyticsIntent({ focus: args.focus, timeScope: args.timeScope });
  return buildLearnerAnalytics({
    prisma: args.prisma,
    userId: args.userId,
    target: {
      targetType: 'course',
      targetId: args.courseId,
      courseId: args.courseId,
      notebookId: null,
    },
    query: intent.originalQuery,
    searchIntent: intent,
  });
}

type EnrolledStudent = {
  userId: string;
  name: string;
  email: string | null;
};

async function enrolledStudents(
  prisma: PrismaClient,
  courseId: string,
): Promise<EnrolledStudent[]> {
  const binding = await prisma.externalCourseBinding.findUnique({
    where: { courseId },
    select: { id: true },
  });
  const rows = await prisma.courseEnrollment.findMany({
    where: {
      courseId,
      user: {
        isActive: true,
        ...(binding
          ? {
              externalCourseMemberships: {
                some: { bindingId: binding.id, role: 'STUDENT', active: true },
              },
            }
          : {}),
      },
    },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: 'desc' },
  });
  return rows.map(({ user }) => ({
    userId: user.id,
    name: user.name?.trim() || user.email?.split('@')[0] || '未命名学生',
    email: user.email || null,
  }));
}

function resolveStudentMatches(students: EnrolledStudent[], query: string): EnrolledStudent[] {
  const needle = normalized(query);
  const exact = students.filter(
    (student) =>
      normalized(student.userId) === needle ||
      normalized(student.name) === needle ||
      (student.email ? normalized(student.email) === needle : false),
  );
  if (exact.length > 0) return exact;
  return students.filter(
    (student) =>
      normalized(student.userId).includes(needle) ||
      normalized(student.name).includes(needle) ||
      (student.email ? normalized(student.email).includes(needle) : false),
  );
}

export async function loadTeacherStudentInsight(args: {
  prisma: PrismaClient;
  courseId: string;
  studentQuery: string;
  focus: CourseAgentLearningFocus;
  timeScope: LearnerAnalyticsTimeScope;
}) {
  const students = await enrolledStudents(args.prisma, args.courseId);
  const matches = resolveStudentMatches(students, args.studentQuery);
  if (matches.length !== 1) {
    return {
      found: false as const,
      reason: matches.length === 0 ? '没有找到这门课中的学生。' : '匹配到多位学生，请再明确一些。',
      candidates: matches.slice(0, 8),
    };
  }
  const student = matches[0];
  const analytics = await loadCourseLearnerInsight({
    prisma: args.prisma,
    courseId: args.courseId,
    userId: student.userId,
    focus: args.focus,
    timeScope: args.timeScope,
  });
  return { found: true as const, student, analytics };
}

function sinceForScope(scope: LearnerAnalyticsTimeScope, courseCreatedAt: Date): Date | null {
  const now = Date.now();
  if (scope === 'week') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (scope === 'month') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  if (scope === 'term') return courseCreatedAt;
  return null;
}

function topCounts(values: string[], limit = 8): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => compact(item, 80)).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export async function loadTeacherClassOverview(args: {
  prisma: PrismaClient;
  courseId: string;
  timeScope: LearnerAnalyticsTimeScope;
}) {
  const course = await args.prisma.course.findUnique({
    where: { id: args.courseId },
    select: { createdAt: true },
  });
  if (!course) return { found: false as const, reason: '课程不存在。' };

  const students = await enrolledStudents(args.prisma, args.courseId);
  const userIds = students.map((student) => student.userId);
  const since = sinceForScope(args.timeScope, course.createdAt);
  if (userIds.length === 0) {
    return {
      found: true as const,
      timeScope: args.timeScope,
      since: since?.toISOString() || null,
      enrolledStudentCount: 0,
      activeStudentCount: 0,
      questionCount: 0,
      attemptCount: 0,
      recentQuestions: [],
      attemptStatus: { passed: 0, failed: 0, partial: 0, other: 0 },
      weakTags: [],
      learnerSignals: [],
      sampled: false,
    };
  }

  const questionLimit = 120;
  const attemptLimit = 160;
  const memoryLimit = 80;
  const [questions, attempts, memories] = await Promise.all([
    args.prisma.courseConversationMessage.findMany({
      where: {
        courseId: args.courseId,
        ownerId: { in: userIds },
        role: 'user',
        deletedAt: null,
        plainText: { not: null },
        ...(since ? { createdAt: { gte: since } } : {}),
        conversation: { deletedAt: null },
      },
      select: { ownerId: true, plainText: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: questionLimit,
    }),
    args.prisma.notebookProblemAttempt.findMany({
      where: {
        userId: { in: userIds },
        ...(since ? { createdAt: { gte: since } } : {}),
        problem: {
          status: { not: 'archived' },
          OR: [{ courseId: args.courseId }, { notebook: { courseId: args.courseId } }],
        },
      },
      select: {
        userId: true,
        status: true,
        problem: { select: { tags: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: attemptLimit,
    }),
    args.prisma.studyMemory.findMany({
      where: {
        ownerId: { in: userIds },
        courseId: args.courseId,
        scope: 'private',
        status: 'active',
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      select: { ownerId: true, title: true, text: true, kind: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: memoryLimit,
    }),
  ]);

  const activeStudentIds = new Set([
    ...questions.map((row) => row.ownerId),
    ...attempts.map((row) => row.userId),
    ...memories.map((row) => row.ownerId),
  ]);
  const attemptStatus = { passed: 0, failed: 0, partial: 0, other: 0 };
  for (const attempt of attempts) {
    const status = String(attempt.status);
    if (status === 'passed' || status === 'failed' || status === 'partial') {
      attemptStatus[status] += 1;
    } else {
      attemptStatus.other += 1;
    }
  }

  return {
    found: true as const,
    timeScope: args.timeScope,
    since: since?.toISOString() || null,
    enrolledStudentCount: students.length,
    activeStudentCount: activeStudentIds.size,
    questionCount: questions.length,
    attemptCount: attempts.length,
    recentQuestions: questions
      .map((row) => ({ text: compact(row.plainText, 700), createdAt: row.createdAt.toISOString() }))
      .filter((row) => row.text)
      .slice(0, 60),
    attemptStatus,
    weakTags: topCounts(
      attempts
        .filter((attempt) => ['failed', 'partial'].includes(String(attempt.status)))
        .flatMap((attempt) => attempt.problem.tags || []),
    ),
    learnerSignals: memories.slice(0, 30).map((memory) => ({
      title: compact(memory.title, 120),
      text: compact(memory.text, 500),
      kind: memory.kind,
      updatedAt: memory.updatedAt.toISOString(),
    })),
    sampled:
      questions.length === questionLimit ||
      attempts.length === attemptLimit ||
      memories.length === memoryLimit,
  };
}

function stableCourseMemoryId(userId: string, courseId: string, knowledgePointKey: string): string {
  const digest = createHash('sha256')
    .update(`${userId}\0${courseId}\0${knowledgePointKey}`)
    .digest('hex')
    .slice(0, 40);
  return `memory_course_chat_${digest}`;
}

function knowledgePointKey(value: string): string {
  return compact(value, 180)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .slice(0, 160);
}

function hasExplicitSignal(text: string, signalType: CourseLearnerSignalInput['signalType']) {
  if (signalType === 'mastered') {
    return /(我明白了|我懂了|我会了|理解了|掌握了|原来如此|现在知道了)/u.test(text);
  }
  if (signalType === 'error_pattern') {
    return /(报错|错误|错在|为什么错|总是错|老是错|失败|不通过|跑不通)/u.test(text);
  }
  return /(不懂|没懂|不会|看不懂|不理解|搞不清|不知道怎么|卡在|困惑|混淆)/u.test(text);
}

type CourseMemorySourceReferences = {
  schema: 'course_chat_learner_memory_v1';
  knowledgePointKey: string;
  evidence: Array<{ messageId: string; excerpt: string; recordedAt: string }>;
};

function parseSourceReferences(value: unknown): CourseMemorySourceReferences['evidence'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as { schema?: unknown; evidence?: unknown };
  if (record.schema !== 'course_chat_learner_memory_v1' || !Array.isArray(record.evidence)) {
    return [];
  }
  return record.evidence
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const candidate = item as Record<string, unknown>;
      const messageId = compact(candidate.messageId, 160);
      const excerpt = compact(candidate.excerpt, 320);
      const recordedAt = compact(candidate.recordedAt, 40);
      return messageId && excerpt ? { messageId, excerpt, recordedAt } : null;
    })
    .filter((item): item is CourseMemorySourceReferences['evidence'][number] => Boolean(item))
    .slice(0, 11);
}

export async function recordCourseLearnerSignal(args: {
  prisma: PrismaClient;
  courseId: string;
  userId: string;
  messageId: string;
  studentMessage: string;
  signal: CourseLearnerSignalInput;
}) {
  const studentMessage = compact(args.studentMessage, 12_000);
  const evidenceExcerpt = compact(args.signal.evidenceExcerpt, 320);
  const point = compact(args.signal.knowledgePoint, 180);
  const pointKey = knowledgePointKey(point);
  const evidenceIsLiteral =
    evidenceExcerpt.length >= 2 && normalized(studentMessage).includes(normalized(evidenceExcerpt));
  if (
    !pointKey ||
    !evidenceIsLiteral ||
    !hasExplicitSignal(studentMessage, args.signal.signalType)
  ) {
    return {
      recorded: false as const,
      reason: '本轮没有通过明确学习信号和逐字证据校验。',
    };
  }

  const accessRole = await findCourseAccessRole(args.prisma, args.userId, args.courseId);
  if (accessRole !== 'enrolled') {
    return { recorded: false as const, reason: '当前用户不在这门课程中。' };
  }

  const memoryId = stableCourseMemoryId(args.userId, args.courseId, pointKey);
  const existing = await args.prisma.studyMemory.findUnique({ where: { id: memoryId } });
  const cause = compact(args.signal.cause, 500);
  const groundedCause =
    cause && normalized(studentMessage).includes(normalized(cause)) ? cause : '';
  const nextTeachingMove =
    compact(args.signal.nextTeachingMove, 500) || '下一轮先用一个最小检查问题确认理解。';
  const text =
    args.signal.signalType === 'mastered'
      ? [
          `掌握：${compact(args.signal.masteredSignal, 500) || `学生明确表示已理解${point}`}`,
          `下一步：${nextTeachingMove}`,
        ].join('\n')
      : [
          `薄弱：${compact(args.signal.stuckPoint, 500) || `学生在${point}上明确表示困惑`}`,
          groundedCause ? `原因：${groundedCause}` : '',
          `下一步：${nextTeachingMove}`,
        ]
          .filter(Boolean)
          .join('\n');
  const sourceReferences: CourseMemorySourceReferences = {
    schema: 'course_chat_learner_memory_v1',
    knowledgePointKey: pointKey,
    evidence: [
      {
        messageId: compact(args.messageId, 160),
        excerpt: evidenceExcerpt,
        recordedAt: new Date().toISOString(),
      },
      ...parseSourceReferences(existing?.sourceReferences),
    ]
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.messageId === item.messageId && candidate.excerpt === item.excerpt,
          ) === index,
      )
      .slice(0, 12),
  };
  await args.prisma.studyMemory.upsert({
    where: { id: memoryId },
    create: {
      id: memoryId,
      ownerId: args.userId,
      courseId: args.courseId,
      notebookId: null,
      targetType: 'course',
      scope: 'private',
      kind: args.signal.signalType === 'mastered' ? 'reflection' : 'knowledge_gap',
      status: 'active',
      source: 'course_chat_memory_diagnosis',
      title: `学习状态：${point}`,
      text,
      reason: '学生在课程对话中提供了明确、可逐字核对的学习信号。',
      question: null,
      sourceReferences: sourceReferences as unknown as Prisma.InputJsonObject,
      confidence: 0.9,
    },
    update: {
      kind: args.signal.signalType === 'mastered' ? 'reflection' : 'knowledge_gap',
      status: 'active',
      source: 'course_chat_memory_diagnosis',
      title: `学习状态：${point}`,
      text,
      reason: '学生在课程对话中提供了明确、可逐字核对的学习信号。',
      sourceReferences: sourceReferences as unknown as Prisma.InputJsonObject,
      confidence: 0.9,
    },
  });
  return { recorded: true as const, status: existing ? 'updated' : 'created', memoryId };
}
