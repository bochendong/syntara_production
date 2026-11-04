/** Disposable browser-only fixture for the 教学 pages. Loopback dev server only; all data is fake. */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppNavigationRail } from '../src/components/AppNavigationRail';
import { AppNavigationContext } from '../src/components/app-navigation-context';
import { useClassroomState } from '../src/components/ClassroomPanel';
import { ProblemBankPage } from '../src/components/ProblemBankPage';
import { StudentClassroomPage } from '../src/components/StudentClassroomPage';
import { TeachPage } from '../src/components/TeachPage';
import { setBrowserAccount } from '../src/data/browser-runtime';
import type { LocalProblem } from '../src/domain/models';
import '../src/tailwind.css';
import '../src/components/marble-tokens.css';
import '../src/styles.css';
import '../src/components/compact-layout.css';
import '../src/components/avatar-theme.css';
import '../src/components/global-calendar.css';

if (
  !import.meta.env.DEV ||
  '__TAURI_INTERNALS__' in window ||
  !['127.0.0.1', 'localhost'].includes(location.hostname)
) {
  throw new Error('This fixture is restricted to a disposable loopback browser preview.');
}

setBrowserAccount('qa-teacher');
const empty = new URLSearchParams(location.search).has('empty');
const isPrivate = new URLSearchParams(location.search).has('private');
const screen = new URLSearchParams(location.search).get('screen');
const now = Date.now();
const day = 86_400_000;

const home = {
  currentPeriod: { label: '2026 秋季' },
  courses: [
    {
      id: 'course-csc108',
      name: '程序设计入门',
      courseCode: 'UTSG-CSC108',
      avatarUrl: null,
      problemCount: empty ? 0 : 80,
      notebookCount: empty ? 0 : 12,
      learnerCount: empty ? 0 : 46,
      listed: !empty,
      canPublish: true,
      pendingApplications: empty ? 0 : 3,
      currentClass: empty
        ? null
        : {
            id: 'class-now',
            name: 'CSC108 · 2026 秋季',
            mine: true,
            memberCount: 8,
            liveSessionId: null,
          },
      pastClasses: empty
        ? []
        : [{ id: 'class-past', name: 'CSC108 · 2026 夏季', label: '2026 夏季', memberCount: 12 }],
    },
  ],
};
const publication = {
  courseId: 'course-csc108',
  name: '程序设计入门',
  campus: 'UTSG',
  organization: empty || isPrivate ? 'none' : 'speedup',
  organizationName: empty || isPrivate ? null : 'SpeedUp',
  admission: {
    mode: 'approval',
    fields: [
      { id: 'sid', label: '学号', kind: 'text' },
      { id: 'phone', label: '手机后四位', kind: 'phone_last4' },
    ],
  },
  avatarUrl: null,
  canEditProfile: true,
  listed: !empty,
  canPublish: true,
  speedupAvailable: true,
  currentClass: null,
};
const applications = empty
  ? []
  : ['李明', '张悦', '陈思远'].map((name, index) => ({
      id: `a${index}`,
      createdAt: new Date(now - index * day * 0.6).toISOString(),
      applicant: { id: `u${index}`, name, email: `s${index}@mail.utoronto.ca`, image: null },
      answersJson: [
        { id: 'sid', label: '学号', kind: 'text', value: `100${7342 + index * 17}` },
        { id: 'phone', label: '手机后四位', kind: 'phone_last4', value: `${3021 + index * 311}` },
      ],
    }));
const notes = [
  '函数与变量',
  '条件语句',
  'while 循环',
  'for 循环',
  '列表与切片',
  '字典',
  '内存模型',
];
const problems = ['表达式求值', '函数定义', '返回值', '累加器', '嵌套循环', '列表方法', '字典计数'];
const content = (kind: string) => {
  const titles = empty ? [] : kind === 'problems' ? problems : notes;
  return {
    total: empty ? 0 : kind === 'problems' ? 80 : 12,
    page: 1,
    pageSize: 7,
    items: titles.map((title, index) => ({
      id: `${kind}-${index}`,
      title: kind === 'problems' ? `${index + 1}. ${title}` : `第 ${index + 1} 讲 · ${title}`,
      updatedAt: new Date(now - index * day * 2).toISOString(),
      status: kind === 'problems' ? (index % 3 === 2 ? 'draft' : 'published') : null,
    })),
  };
};

const chapterOf = (index: number) =>
  index < 3
    ? { chapterId: 'c1', chapterName: '第 1 章 · 函数' }
    : index < 5
      ? { chapterId: 'c2', chapterName: '第 2 章 · 循环' }
      : { chapterId: 'c3', chapterName: '第 3 章 · 列表与字典' };
const problemRecord = (index: number) => {
  const base = {
    id: `problems-${index}`,
    courseId: 'course-csc108',
    notebookId: null,
    ...chapterOf(index),
    title: `${index + 1}. ${problems[index]}`,
    status: index % 3 === 2 ? 'draft' : 'published',
    difficulty: (['easy', 'medium', 'hard'] as const)[index % 3],
    tags: [],
    createdAt: now - index * day * 2,
    updatedAt: now - index * day * 2,
  };
  if (index === 0)
    return {
      ...base,
      type: 'choice',
      publicContent: {
        type: 'choice',
        stem: '下面的表达式求值后，`x` 的值是多少？\n\n```python\nx = 7 // 2 + 7 % 2 * 3\n```',
        options: [
          { id: 'A', label: '6' },
          { id: 'B', label: '4.5' },
          { id: 'C', label: '9' },
          { id: 'D', label: '3' },
        ],
      },
      grading: {
        correctOptionIds: ['A'],
        analysis: '`7 // 2` 是 3，`7 % 2 * 3` 是 3，所以和为 6。',
      },
    };
  if (index === 3)
    return {
      ...base,
      type: 'multipart',
      publicContent: {
        type: 'multipart',
        stem: '阅读下面的累加器代码，回答两个小问。\n\n```python\ntotal = 0\nfor n in range(1, 5):\n    total += n * n\n```',
        parts: [
          {
            label: 'a',
            content: {
              type: 'choice',
              stem: '循环结束后 `total` 是多少？',
              options: [
                { id: 'A', label: '10' },
                { id: 'B', label: '30' },
                { id: 'C', label: '16' },
              ],
            },
          },
          {
            label: 'b',
            content: {
              type: 'short_answer',
              stem: '把 `range(1, 5)` 改成什么，才能把 5 也算进去？',
            },
          },
        ],
      },
      grading: {
        parts: [
          { label: 'a', grading: { correctOptionIds: ['B'] } },
          { label: 'b', grading: { referenceAnswer: '`range(1, 6)`' } },
        ],
      },
    };
  return {
    ...base,
    type: 'code',
    publicContent: {
      type: 'code',
      stem: `实现函数 \`${['f', 'square', 'absolute', 'acc', 'grid', 'dedupe', 'count_words'][index]}\`，满足下面的说明。\n\n给定一个整数列表，返回其中所有偶数的平方和。`,
      language: 'python',
      functionSignature: 'def sum_even_squares(nums: list[int]) -> int:',
      constraints: ['列表长度不超过 1000', '不要修改传入的列表'],
      sampleIO: [{ input: 'sum_even_squares([1, 2, 3, 4])', output: '20' }],
      publicTests: [{ input: 'sum_even_squares([])', output: '0' }],
      starterCode: 'def sum_even_squares(nums: list[int]) -> int:\n    # 在这里写代码\n    pass',
    },
    grading: {
      solutionCode:
        'def sum_even_squares(nums: list[int]) -> int:\n    return sum(n * n for n in nums if n % 2 == 0)',
      analysis: '用生成器表达式筛选偶数，再求平方和。',
    },
  };
};
const notebookArchive = (id: string) => {
  const index = Number(id.split('-')[1] || 0);
  return {
    notebook: { id, name: `第 ${index + 1} 讲 · ${notes[index]}` },
    notebookPages: [],
    markdownSections: [
      {
        id: `${id}-s1`,
        notebookId: id,
        courseId: 'course-csc108',
        title: notes[index],
        order: 0,
        markdown: `## ${notes[index]}\n\n函数把一段可以重复使用的计算包起来。调用函数时，**实参**的值会绑定到**形参**上。\n\n\`\`\`python\ndef area(width, height):\n    return width * height\n\nprint(area(3, 4))  # 12\n\`\`\`\n\n### 要点\n\n- \`return\` 结束函数并把值交回给调用者\n- 没有 \`return\` 的函数返回 \`None\`\n- 变量的作用域：函数里赋值的变量是局部变量\n\n> 写函数前先写出它的类型签名和两个例子。`,
        summary: null,
        sourceMeta: {},
        createdAt: now,
        updatedAt: now,
      },
    ],
    assets: [],
    pageAssets: [],
    notebookAssets: [],
    missingAssetPaths: [],
  };
};

/* ---------- 上课：内存里的班级、节课和提交，接口和形状跟服务器一样 ---------- */
const studentNames = ['李明', '张悦', '陈思远', '刘晨', '赵一鸣', '孙雨桐', '周可', '吴昊'];
const students = studentNames.map((name, index) => ({ userId: `s${index}`, name }));
type MockStatus = 'passed' | 'failed' | 'partial' | 'pending';
type MockAttempt = {
  id: string;
  kind: string;
  status: MockStatus;
  score: number | null;
  answer: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: number;
};
type MockSession = {
  id: string;
  classId: string;
  number: number;
  status: 'draft' | 'live' | 'ended';
  code: string | null;
  locked: boolean;
  startedAt: number | null;
  endedAt: number | null;
  problemIds: string[];
  present: string[];
};
const pid = (index: number) => `problems-${index}`;
const session = (
  id: string,
  classId: string,
  number: number,
  status: MockSession['status'],
  indexes: number[],
  daysAgo: number,
): MockSession => ({
  id,
  classId,
  number,
  status,
  code: null,
  locked: false,
  startedAt: status === 'draft' ? null : now - daysAgo * day,
  endedAt: status === 'ended' ? now - daysAgo * day + 3_000_000 : null,
  problemIds: indexes.map(pid),
  present: status === 'draft' ? [] : students.slice(0, 6).map((student) => student.userId),
});
const mockSessions: MockSession[] = empty
  ? []
  : [
      session('past-1', 'class-past', 1, 'ended', [0, 1, 3], 120),
      session('past-2', 'class-past', 2, 'ended', [0, 4, 5, 6], 113),
      session('past-3', 'class-past', 3, 'ended', [1, 3, 6], 106),
      session('now-1', 'class-now', 1, 'ended', [0, 1, 3, 4], 14),
      session('now-2', 'class-now', 2, 'ended', [1, 4], 7),
      session('now-3', 'class-now', 3, 'draft', [0, 3, 4, 1], 0),
    ];
const attemptStore = new Map<string, MockAttempt[]>();
const attemptKey = (sessionId: string, problemId: string, userId: string) =>
  `${sessionId}:${problemId}:${userId}`;
/** 一道题一个人的提交，形状和服务器存的一样。 */
function seedAttempts(sessionId: string, problemId: string, studentIndex: number) {
  const problemIndex = Number(problemId.split('-')[1]);
  const pattern: MockStatus[][] = [
    ['passed'],
    ['failed', 'passed'],
    ['failed'],
    ['passed'],
    ['partial'],
    ['pending'],
  ];
  const statuses = pattern[(studentIndex + problemIndex) % pattern.length];
  if ((studentIndex * 3 + problemIndex) % 7 === 5) return;
  const attempts = statuses.map((status, attempt): MockAttempt => {
    const createdAt = now - (statuses.length - attempt) * 90_000 - studentIndex * 20_000;
    const id = `${sessionId}-${problemId}-${studentIndex}-${attempt}`;
    const score =
      status === 'passed' ? 1 : status === 'partial' ? 0.5 : status === 'failed' ? 0 : null;
    if (problemIndex === 0) {
      const wrong = (['B', 'C', 'D'] as const)[studentIndex % 3];
      return {
        id,
        kind: 'answer',
        status: status === 'passed' ? 'passed' : 'failed',
        score: status === 'passed' ? 1 : 0,
        answer: { selectedOptionIds: [status === 'passed' ? 'A' : wrong] },
        result: { feedback: status === 'passed' ? '' : '`7 % 2 * 3` 先算乘除。', autoGraded: true },
        createdAt,
      };
    }
    if (problemIndex === 3) {
      return {
        id,
        kind: 'answer',
        status,
        score,
        answer: {
          parts: {
            a: { selectedOptionIds: [status === 'failed' ? 'A' : 'B'] },
            b: { text: status === 'failed' ? '改成 range(1, 5)' : '改成 `range(1, 6)`' },
          },
        },
        result: {
          feedback: '答对 1/2 个小问。',
          parts: [
            {
              label: 'a',
              status: status === 'failed' ? 'failed' : 'passed',
              points: 5,
              score: 5,
              correct: status !== 'failed',
            },
            {
              label: 'b',
              status: status === 'passed' ? 'passed' : 'partial',
              points: 5,
              score: status === 'passed' ? 5 : 2,
              feedback: status === 'passed' ? '' : '上界不包含，要写 6。',
            },
          ],
        },
        createdAt,
      };
    }
    const passed = status === 'passed';
    return {
      id,
      kind: 'submit',
      status,
      score: score === null ? null : score * 100,
      answer: {
        code: passed
          ? 'def sum_even_squares(nums: list[int]) -> int:\n    return sum(n * n for n in nums if n % 2 == 0)'
          : 'def sum_even_squares(nums: list[int]) -> int:\n    total = 0\n    for n in nums:\n        total += n * n\n    return total',
      },
      result: {
        feedback: passed ? '全部通过。' : '奇数也被算进去了，先筛选偶数。',
        publicSummary: { passed: passed ? 3 : 1, total: 3 },
        secretSummary: { passed: passed ? 5 : 2, total: 5 },
        publicCases: passed
          ? []
          : [
              {
                id: 'c1',
                description: 'sum_even_squares([1, 2, 3, 4])',
                passed: false,
                actual: '30',
              },
              { id: 'c2', description: 'sum_even_squares([])', passed: true },
            ],
      },
      createdAt,
    };
  });
  attemptStore.set(attemptKey(sessionId, problemId, `s${studentIndex}`), attempts);
}
function seedSession(entry: MockSession) {
  for (const problemId of entry.problemIds) {
    entry.present.forEach((userId) => seedAttempts(entry.id, problemId, Number(userId.slice(1))));
  }
}
mockSessions.filter((entry) => entry.status === 'ended').forEach(seedSession);

const classInfo = (classId: string) =>
  classId === 'class-past'
    ? { id: classId, name: 'CSC108 · 2026 夏季', joinCode: 'H7KM2Q', label: '2026 夏季' }
    : { id: classId, name: 'CSC108 · 2026 秋季', joinCode: 'B4TRXN', label: '2026 秋季' };
const courseInfo = { id: 'course-csc108', name: '程序设计入门', courseCode: 'UTSG-CSC108' };
const problemChoice = (index: number) => ({
  id: pid(index),
  title: problems[index],
  type: problemRecord(index).type,
  difficulty: problemRecord(index).difficulty,
  number: index + 1,
  chapter: { id: chapterOf(index).chapterId, name: chapterOf(index).chapterName },
});
const classOverview = (classId: string) => ({
  class: {
    ...classInfo(classId),
    course: courseInfo,
    teacher: { id: 'qa-teacher', name: '董老师' },
  },
  roster: students.map((student, index) => ({
    ...student,
    email: `s${index}@mail.utoronto.ca`,
    avatarUrl: null,
    joinedAt: now - day * 30,
    source: 'code',
  })),
  visitors: [],
  sessions: mockSessions
    .filter((entry) => entry.classId === classId)
    .sort((left, right) => right.number - left.number)
    .map((entry) => ({
      id: entry.id,
      number: entry.number,
      status: entry.status,
      code: entry.code,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      participantCount: entry.present.length,
      itemCount: entry.problemIds.length,
    })),
  problems: problems.map((_, index) => problemChoice(index)),
  progress: students.flatMap((student, row) =>
    problems.slice(0, 5).flatMap((_, column) =>
      (row + column) % 3 === 2
        ? []
        : [
            {
              userId: student.userId,
              problemId: pid(column),
              status: (row + column) % 3 === 0 ? 'passed' : 'failed',
              score: null,
              attemptedCount: 1,
              lastAttemptAt: now - day,
            },
          ],
    ),
  ),
});
const dashboard = (sessionId: string) => {
  const entry = mockSessions.find((row) => row.id === sessionId)!;
  const rows = [
    ...students.filter((student) => entry.present.includes(student.userId)),
    ...students.filter((student) => !entry.present.includes(student.userId)),
  ];
  return {
    session: {
      id: entry.id,
      number: entry.number,
      status: entry.status,
      code: entry.code,
      locked: entry.locked,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      presentCount: entry.present.length,
      class: {
        id: entry.classId,
        name: classInfo(entry.classId).name,
        rosterCount: students.length,
      },
      course: courseInfo,
    },
    students: rows.map((student) => ({
      ...student,
      avatarUrl: null,
      present: entry.present.includes(student.userId),
      via: 'roster',
      joinedAt: entry.present.includes(student.userId) ? entry.startedAt : null,
    })),
    items: entry.problemIds.map((problemId, position) => {
      const index = Number(problemId.split('-')[1]);
      const results = rows.flatMap((student) => {
        const attempts = attemptStore.get(attemptKey(entry.id, problemId, student.userId));
        const last = attempts?.at(-1);
        return last
          ? [
              {
                userId: student.userId,
                status: last.status,
                score: last.score,
                submittedAt: last.createdAt,
                attempts: attempts!.length,
              },
            ]
          : [];
      });
      const count = (...statuses: MockStatus[]) =>
        results.filter((row) => statuses.includes(row.status)).length;
      const record = problemRecord(index);
      const content = record.publicContent as { options?: Array<{ id: string; label: string }> };
      return {
        id: `${entry.id}:${problemId}`,
        problemId,
        position: position + 1,
        title: problems[index],
        type: record.type,
        number: index + 1,
        addedAt: entry.startedAt ?? now,
        submittedCount: results.length,
        passedCount: count('passed'),
        partialCount: count('partial', 'pending'),
        failedCount: count('failed'),
        options:
          record.type === 'choice'
            ? (content.options ?? []).map((option) => ({
                ...option,
                correct: option.id === 'A',
                count: rows.filter((student) =>
                  (
                    attemptStore.get(attemptKey(entry.id, problemId, student.userId))?.at(-1)
                      ?.answer.selectedOptionIds as string[] | undefined
                  )?.includes(option.id),
                ).length,
              }))
            : null,
        results,
      };
    }),
  };
};
function teachGet(query: URLSearchParams) {
  const classId = query.get('classId');
  const sessionId = query.get('sessionId');
  const answers = query.get('answers');
  if (answers) {
    return {
      language: 'python',
      attempts: [
        ...(attemptStore.get(attemptKey(answers, query.get('problemId')!, query.get('userId')!)) ??
          []),
      ]
        .reverse()
        // 和服务器一样换算成 0~1：代码题存的是百分制。
        .map((attempt) => ({
          ...attempt,
          score:
            attempt.kind === 'submit' && attempt.score !== null
              ? attempt.score / 100
              : attempt.score,
        })),
    };
  }
  if (query.get('choices')) return { problems: problems.map((_, index) => problemChoice(index)) };
  if (query.get('importFor')) {
    return {
      classes: [
        {
          classId: 'class-past',
          label: '2026 夏季',
          sessions: mockSessions
            .filter((entry) => entry.classId === 'class-past')
            .map((entry) => ({
              id: entry.id,
              number: entry.number,
              itemCount: entry.problemIds.length,
              titles: entry.problemIds
                .slice(0, 3)
                .map((problemId) => problems[Number(problemId.split('-')[1])]),
            })),
        },
      ],
    };
  }
  if (query.get('liveCourse')) {
    const live = mockSessions.find((entry) => entry.status === 'live');
    return {
      live: live
        ? {
            sessionId: live.id,
            number: live.number,
            presentCount: live.present.length,
            problemIds: live.problemIds,
          }
        : null,
    };
  }
  if (sessionId) return dashboard(sessionId);
  if (classId) return classOverview(classId);
  return home;
}
function nextNumber(classId: string) {
  return (
    Math.max(0, ...mockSessions.filter((row) => row.classId === classId).map((row) => row.number)) +
    1
  );
}
type TeachBody = {
  action?: string;
  classId: string;
  sessionId?: string;
  sessionIds: string[];
  problemIds: string[];
  problemId: string;
  locked: boolean;
};
function teachPost(body: TeachBody) {
  const entry = mockSessions.find((row) => row.id === body.sessionId);
  switch (body.action) {
    case 'open-class':
      return { classId: 'class-now' };
    case 'create-draft': {
      const created = session(
        `d${Date.now()}`,
        body.classId,
        nextNumber(body.classId),
        'draft',
        [],
        0,
      );
      mockSessions.push(created);
      return { sessionId: created.id };
    }
    case 'delete-draft':
      mockSessions.splice(mockSessions.indexOf(entry!), 1);
      return { classId: entry!.classId };
    case 'import-sessions':
      for (const id of body.sessionIds) {
        const source = mockSessions.find((row) => row.id === id)!;
        mockSessions.push({
          ...session(`i${id}`, body.classId, nextNumber(body.classId), 'draft', [], 0),
          problemIds: [...source.problemIds],
        });
      }
      return classOverview(body.classId);
    case 'start-session': {
      const target =
        mockSessions.find((row) => row.id === body.sessionId) ??
        session(`n${Date.now()}`, body.classId, nextNumber(body.classId), 'live', [], 0);
      if (!mockSessions.includes(target)) mockSessions.push(target);
      target.status = 'live';
      target.code = '482915';
      target.startedAt = now;
      target.present = students.slice(0, 6).map((student) => student.userId);
      seedSession(target);
      return { sessionId: target.id };
    }
    case 'add':
      entry!.problemIds.push(...body.problemIds.filter((id) => !entry!.problemIds.includes(id)));
      if (entry!.status === 'live') seedSession(entry!);
      return dashboard(entry!.id);
    case 'remove':
      entry!.problemIds = entry!.problemIds.filter((id) => id !== body.problemId);
      return dashboard(entry!.id);
    case 'reorder':
      entry!.problemIds = body.problemIds;
      return dashboard(entry!.id);
    case 'lock':
      entry!.locked = body.locked;
      return dashboard(entry!.id);
    case 'end':
      entry!.status = 'ended';
      entry!.endedAt = Date.now();
      entry!.code = null;
      return dashboard(entry!.id);
    default:
      return classOverview(body.classId);
  }
}

if (screen === 'bank') {
  teachPost({ action: 'start-session', classId: 'class-now', sessionId: 'now-3' } as TeachBody);
}

/* ---------- 学生的课堂 ---------- */
const myStatus = new Map<string, MockStatus>([
  [pid(0), 'passed'],
  [pid(3), 'partial'],
]);
const classroomLive = {
  id: 'now-3',
  number: 3,
  status: 'live',
  joined: false,
  startedAt: now - 1_200_000,
  endedAt: null,
  className: 'CSC108 · 2026 秋季',
  courseId: 'course-csc108',
  courseName: 'CSC108',
  teacherName: '董老师',
  problemIds: [pid(0), pid(3), pid(4), pid(1)],
};
const classroomItem = (problemId: string) => {
  const index = Number(problemId.split('-')[1]);
  return {
    id: `live:${problemId}`,
    problemId,
    title: problems[index],
    type: problemRecord(index).type,
    number: index + 1,
    addedAt: now,
    myStatus: myStatus.get(problemId) ?? null,
    myAttempts: myStatus.has(problemId) ? 1 : 0,
  };
};
const classroomState = () => ({
  sessions: [
    {
      ...classroomLive,
      problemIds: undefined,
      items: classroomLive.joined ? classroomLive.problemIds.map(classroomItem) : [],
    },
  ],
  past: [
    {
      ...classroomLive,
      id: 'now-2',
      number: 2,
      status: 'ended',
      joined: true,
      startedAt: now - 7 * day,
      endedAt: now - 7 * day + 3_000_000,
      problemIds: undefined,
      items: [
        { ...classroomItem(pid(1)), myStatus: 'passed', myAttempts: 2 },
        { ...classroomItem(pid(4)), myStatus: null, myAttempts: 0 },
      ],
    },
  ],
});
Object.assign(window, {
  /** 模拟老师在课上加了一道题（QA 截图用）。 */
  __qaAddProblem: (index: number) => {
    classroomLive.problemIds.push(pid(index));
  },
});

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url, location.href);
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), {
      headers: { 'content-type': 'application/json' },
    });
  if (url.pathname === '/api/native/v1/teach') {
    if ((init?.method || 'GET') === 'POST') {
      return reply(teachPost(JSON.parse(String(init?.body || '{}'))));
    }
    return reply(teachGet(url.searchParams));
  }
  if (url.pathname === '/api/native/v1/classroom') {
    if ((init?.method || 'GET') === 'POST') {
      const payload = JSON.parse(String(init?.body || '{}'));
      if (payload.action === 'join-code' && payload.code !== '482915') {
        return new Response(
          JSON.stringify({ success: false, error: { message: '没有找到这节课，请核对课堂码。' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      classroomLive.joined = true;
      return reply({
        joined: { kind: 'session', courseId: 'course-csc108', sessionId: classroomLive.id },
        ...classroomState(),
      });
    }
    return reply(classroomState());
  }
  if (url.pathname === '/api/native/v1/notebooks')
    return reply(notebookArchive(url.searchParams.get('id') || 'notes-0'));
  if (url.pathname === '/api/native/v1/problems')
    return reply({
      courseId: 'course-csc108',
      serverTime: now,
      problemIds: problems.map((_, index) => `problems-${index}`),
      complete: true,
      problems: empty ? [] : problems.map((_, index) => problemRecord(index)),
      progress: [],
    });
  if (url.pathname === '/api/native/v1/store') {
    if ((init?.method || 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.payload?.action === 'release')
        return reply({ version: 8, text: '新增 2 道题，更新 1 道题和 1 本笔记。' });
      return reply({ publication, status: 'ok', saved: true });
    }
    if (url.searchParams.has('publicationOf')) return reply({ publication });
    if (url.searchParams.has('applicationsOf'))
      return reply({ applications, total: applications.length, page: 1, pageSize: 10 });
    if (url.searchParams.has('problemGroupsOf')) {
      const counts = new Map<string, number>();
      if (!empty)
        problems.forEach((_, index) => {
          const id = chapterOf(index).chapterId;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        });
      return reply({
        chapters: [
          ['c1', '第 1 章 · 函数'],
          ['c2', '第 2 章 · 循环'],
          ['c3', '第 3 章 · 列表与字典'],
          ['c4', '第 4 章 · 递归'],
        ].map(([id, name]) => ({ key: `c:${id}`, id, name, count: counts.get(id) ?? 0 })),
        notebooks: notes.map((name, index) => ({
          key: `n:notes-${index}`,
          id: `notes-${index}`,
          name: `第 ${index + 1} 讲 · ${name}`,
          count: 0,
        })),
        ungrouped: 0,
      });
    }
    if (url.searchParams.has('studentsOf') || url.searchParams.has('studentOf')) {
      const priv = new URLSearchParams(location.search).has('private');
      const names = [
        '李明',
        '张悦',
        '陈思远',
        '刘晨',
        '赵一鸣',
        '孙雨桐',
        '周可',
        '吴昊',
        '郑佳怡',
        '王子涵',
        '林嘉',
        '何思',
      ];
      const student = (index: number, joinedAt: number) => ({
        userId: `s${index}`,
        name: names[index % names.length],
        email: `s${index}@mail.utoronto.ca`,
        image: null,
        joinedAt: new Date(joinedAt).toISOString(),
        method: index % 3 ? 'approval' : 'open',
        lastActiveAt: priv ? null : new Date(now - (index * 7 + 2) * 3_600_000).toISOString(),
      });
      const fall = names.slice(0, 7).map((_, index) => student(index, now - index * day * 3));
      const summer = names
        .slice(7)
        .map((_, index) => student(index + 7, now - (90 + index * 5) * day));
      const userId = url.searchParams.get('userId');
      if (userId) {
        const base = [...fall, ...summer].find((item) => item.userId === userId) ?? fall[0];
        const statuses = ['passed', 'failed', 'partial', 'passed', 'passed', 'pending'] as const;
        return reply({
          student: {
            ...base,
            answers:
              base.method === 'approval'
                ? [
                    { id: 'sid', label: '学号', value: '1007342' },
                    { id: 'phone', label: '手机后四位', value: '3021' },
                  ]
                : [],
          },
          insights: priv
            ? null
            : {
                attempted: 23,
                passed: 17,
                accuracy: 17 / 23,
                attemptCount: 41,
                lastActiveAt: new Date(now - 2 * 3_600_000).toISOString(),
                attempts: problems.map((title, index) => ({
                  id: `at${index}`,
                  problemId: `problems-${index}`,
                  title: `${index + 1}. ${title}`,
                  chapterName: chapterOf(index).chapterName,
                  status: statuses[index % statuses.length],
                  score: null,
                  answerPreview:
                    index === 1
                      ? 'def sum_even_squares(nums):\n    return sum(n * n for n in nums if n % 2 == 0)'
                      : '',
                  createdAt: new Date(now - (index * 5 + 2) * 3_600_000).toISOString(),
                })),
                questions: [
                  ['为什么 7 // 2 的结果是 3 而不是 3.5？', '整数除法'],
                  ['for 循环里修改列表会发生什么？能举个例子吗', 'for 循环'],
                  ['字典的 get 和直接用 [] 取值有什么区别', '字典'],
                  ['递归一定要有 base case 吗？如果没有会怎样', '递归入门'],
                ].map(([text, title], index) => ({
                  id: `q${index}`,
                  text,
                  conversationTitle: title,
                  createdAt: new Date(now - (index * 9 + 1) * 3_600_000).toISOString(),
                })),
              },
        });
      }
      return reply(
        empty
          ? { total: 0, insights: !priv, terms: [] }
          : {
              total: fall.length + summer.length,
              insights: !priv,
              terms: [
                { key: '2026-fall', label: '2026 秋季', students: fall },
                { key: '2026-summer', label: '2026 夏季', students: summer },
              ],
            },
      );
    }
    if (url.searchParams.has('releaseOf'))
      return reply(
        empty
          ? {
              addedProblems: 0,
              updatedProblems: 0,
              addedNotebooks: 0,
              updatedNotebooks: 0,
              total: 0,
              canRelease: true,
              lastReleasedAt: null,
              version: 1,
            }
          : {
              addedProblems: 2,
              updatedProblems: 1,
              addedNotebooks: 0,
              updatedNotebooks: 1,
              total: 4,
              canRelease: true,
              lastReleasedAt: new Date(now - 3 * day).toISOString(),
              version: 7,
            },
      );
    if (url.searchParams.has('managementOf') && url.searchParams.get('group')) {
      const group = url.searchParams.get('group')!;
      const items = empty
        ? []
        : problems
            .map((_, index) => index)
            .filter((index) => `c:${chapterOf(index).chapterId}` === group)
            .map((index) => ({
              id: `problems-${index}`,
              title: `${index + 1}. ${problems[index]}`,
              updatedAt: new Date(now - index * day * 2).toISOString(),
              status: index % 3 === 2 ? 'draft' : 'published',
              ...chapterOf(index),
              notebookId: null,
            }));
      return reply({ total: items.length, page: 1, pageSize: 100, items });
    }
    if (url.searchParams.has('managementOf'))
      return reply(content(url.searchParams.get('kind') || 'notes'));
    return reply({ courses: [] });
  }
  return realFetch(input, init);
};

const noop = () => undefined;
const navigation = {
  active: 'teach' as const,
  avatarUrl: '',
  onOpenCalendar: noop,
  onOpenStore: noop,
  onOpenSettings: noop,
  onOpenClassroom: noop,
  onOpenTeach: noop,
};

function StudentFixture() {
  const classroom = useClassroomState(true, true);
  return (
    <StudentClassroomPage
      state={classroom.state}
      onState={classroom.setState}
      initialSessionId={null}
      onBack={noop}
      onJoinedCourse={async () => undefined}
      onOpenProblem={async ({ problemId }) => {
        // 这里不打开真的做题页：模拟做完回到课堂，弹珠变色。
        myStatus.set(problemId, 'passed');
        await classroom.refresh();
      }}
    />
  );
}

function BankFixture() {
  const [workspace] = useState(() => ({
    course: {
      id: 'course-csc108',
      name: '程序设计入门',
      description: '',
      language: 'zh-CN',
      tags: [],
      purpose: 'university',
      university: null,
      courseCode: 'CSC108',
      createdAt: now,
      updatedAt: now,
    },
    problems: problems.map((_, index) => problemRecord(index)) as unknown as LocalProblem[],
    notebooks: [],
    conversations: [],
    memories: [],
  }));
  const bank = useMemo(
    () => (
      <ProblemBankPage
        workspace={workspace as unknown as Parameters<typeof ProblemBankPage>[0]['workspace']}
        onBack={noop}
        onPractice={noop}
      />
    ),
    [workspace],
  );
  return bank;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppNavigationContext.Provider value={navigation}>
      <main className="syntara-native-shell has-global-navigation">
        <AppNavigationRail
          {...navigation}
          onOpenChat={noop}
          active={screen === 'student' ? 'classroom' : 'teach'}
        />
        <div className="native-global-page">
          {screen === 'student' ? (
            <StudentFixture />
          ) : screen === 'bank' ? (
            <BankFixture />
          ) : (
            <TeachPage onBack={noop} mode={screen === 'classroom' ? 'classroom' : 'teaching'} />
          )}
        </div>
      </main>
    </AppNavigationContext.Provider>
  </StrictMode>,
);
