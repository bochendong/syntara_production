import type {
  AcademicCourseSummary,
  AcademicTermSummary,
} from '@/lib/teacher/online-course-archive';
import type { CourseRecord } from '@/lib/utils/database';
import type {
  TeacherStudioContentItem,
  TeacherStudioCourse,
  TeacherStudioTask,
} from '@/lib/teacher/online-course-studio';

const LOCAL_DEMO_NOW = Date.UTC(2026, 7, 11, 9, 0, 0);

export const LOCAL_DEMO_TEACHER_HOME_COURSES: CourseRecord[] = [
  ['demo-csc148', 'CSC148', '程序设计基础', '多伦多大学'],
  ['demo-mat136', 'MAT136', '积分与应用', '多伦多大学'],
  ['demo-mat102', 'MAT102', '数学证明导论', '多伦多大学'],
  ['demo-csc236', 'CSC236', '理论计算机科学', '多伦多大学'],
  ['demo-mat223', 'MAT223', '线性代数', '多伦多大学'],
  ['demo-sta257', 'STA257', '概率与统计', '多伦多大学'],
  ['demo-research', 'RESEARCH', '研究方法', '本地预览课程'],
  ['demo-group-theory', 'GROUP', '群论专题', '本地预览课程'],
].map(([id, courseCode, name, university], index) => ({
  id,
  courseCode,
  name,
  description: `${courseCode} · 2026 Summer 本地 UI 预览`,
  language: 'zh-CN' as const,
  tags: [courseCode, '本地预览'],
  purpose: 'university' as const,
  university,
  academicYear: 2026,
  academicTerm: 'summer' as const,
  notebookCount: 3 + (index % 4),
  problemCount: 18 + index * 5,
  createdAt: LOCAL_DEMO_NOW - (index + 1) * 86_400_000,
  updatedAt: LOCAL_DEMO_NOW - index * 3_600_000,
}));

export const LOCAL_DEMO_CURRENT_COURSE_SUMMARIES: AcademicCourseSummary[] =
  LOCAL_DEMO_TEACHER_HOME_COURSES.map((course, index) => ({
    id: course.id,
    code: course.courseCode || `COURSE${index + 1}`,
    name: course.name,
    academicYear: course.academicYear || 2026,
    term: course.academicTerm || 'summer',
    builderName: '本地预览老师',
    contentCount: (course.notebookCount || 0) + 2,
    inheritedCount: index % 3,
    studentCount: 18 + index * 4,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  }));

export const LOCAL_DEMO_PAST_COURSES: AcademicCourseSummary[] = [
  ['demo-past-csc148-winter', 'CSC148', '程序设计基础', 2026, 'winter', 8, 2, 42],
  ['demo-past-mat136-winter', 'MAT136', '积分与应用', 2026, 'winter', 6, 1, 38],
  ['demo-past-mat102-winter', 'MAT102', '数学证明导论', 2026, 'winter', 7, 3, 51],
  ['demo-past-csc148-fall', 'CSC148', '程序设计基础', 2025, 'fall', 9, 4, 47],
  ['demo-past-mat223-fall', 'MAT223', '线性代数', 2025, 'fall', 5, 1, 34],
  ['demo-past-sta257-fall', 'STA257', '概率与统计', 2025, 'fall', 6, 2, 31],
  ['demo-past-research-summer', 'RESEARCH', '研究方法', 2025, 'summer', 4, 0, 22],
].map(
  ([id, code, name, academicYear, term, contentCount, inheritedCount, studentCount], index) => ({
    id: String(id),
    code: String(code),
    name: String(name),
    academicYear: Number(academicYear),
    term: term as AcademicCourseSummary['term'],
    builderName: index % 2 === 0 ? '课程组' : '本地预览老师',
    contentCount: Number(contentCount),
    inheritedCount: Number(inheritedCount),
    studentCount: Number(studentCount),
    createdAt: LOCAL_DEMO_NOW - (index + 30) * 86_400_000,
    updatedAt: LOCAL_DEMO_NOW - (index + 10) * 86_400_000,
  }),
);

export const LOCAL_DEMO_PAST_TERMS: AcademicTermSummary[] = [
  { key: '2026-winter', academicYear: 2026, term: 'winter', courseCount: 3 },
  { key: '2025-fall', academicYear: 2025, term: 'fall', courseCount: 3 },
  { key: '2025-summer', academicYear: 2025, term: 'summer', courseCount: 1 },
];

export type LocalDemoCourseHardRule = {
  id: string;
  courseId: string;
  ownerId: string;
  content: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

function localDemoContentReference(
  courseId: string,
  assetId: string,
  status: 'active' | 'hidden' = 'active',
  learningOrder?: number,
) {
  return {
    id: `local-demo-reference:${assetId}`,
    courseId,
    assetId,
    status,
    learningOrder,
    hiddenAt: status === 'hidden' ? LOCAL_DEMO_NOW - 86_400_000 : undefined,
    createdAt: LOCAL_DEMO_NOW - 14 * 86_400_000,
    updatedAt: LOCAL_DEMO_NOW - 3_600_000,
  } satisfies TeacherStudioContentItem['reference'];
}

/** Stress-test fixtures: many rows + intentionally long titles/bodies for overflow QA. */
const LONG_UNBROKEN =
  '超长无空格文件名用于测试截断与overflow_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_连字符与下划线混合_期末速成冲刺讲义完整版含附录与勘误';

function stressTitle(prefix: string, index: number, long: boolean) {
  if (!long) return `${prefix} ${String(index).padStart(2, '0')}`;
  return `${prefix} ${String(index).padStart(2, '0')} · ${LONG_UNBROKEN} · 第${index}周课堂补充材料与作业讲评合集.pdf`;
}

export function getLocalDemoTeacherStudio(courseId: string, teacherId: string) {
  const homeCourse =
    LOCAL_DEMO_TEACHER_HOME_COURSES.find((candidate) => candidate.id === courseId) ??
    LOCAL_DEMO_TEACHER_HOME_COURSES[0];
  const courseCode = homeCourse.courseCode || 'DEMO101';
  const courseName = homeCourse.name;
  const course = {
    id: courseId,
    code: courseCode,
    name: courseName,
    description: `${courseCode} · ${courseName}的本地教师工作台预览`,
    academicYear: homeCourse.academicYear || 2026,
    term: homeCourse.academicTerm || 'summer',
    problemCount: homeCourse.problemCount || 0,
    createdAt: homeCourse.createdAt,
    updatedAt: homeCourse.updatedAt,
  } satisfies TeacherStudioCourse;

  const schoolSources: TeacherStudioContentItem[] = Array.from({ length: 14 }, (_, index) => {
    const n = index + 1;
    const id = `${courseId}-source-school-${n}`;
    const long = n % 3 === 1;
    return {
      id,
      type: 'source',
      title: stressTitle(`${courseCode} ${courseName}学校老师讲义`, n, long),
      description: long
        ? `application/pdf · ${(1.2 + n * 0.35).toFixed(1)} MB · 含章节目录、例题详解、勘误表与往年对照说明，用于列表副标题换行/截断测试`
        : `application/pdf · ${(1.2 + n * 0.35).toFixed(1)} MB`,
      sourceCategory: 'school_teacher_notes',
      sourceFileId: id,
      mimeType: 'application/pdf',
      size: 1_200_000 + n * 180_000,
      ingestStatus: n % 5 === 0 ? 'processing' : 'completed',
      createdAt: LOCAL_DEMO_NOW - (20 - n) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - n * 3_600_000,
      reference: localDemoContentReference(courseId, id),
    } satisfies TeacherStudioContentItem;
  });

  const crashSources: TeacherStudioContentItem[] = Array.from({ length: 10 }, (_, index) => {
    const n = index + 1;
    const id = `${courseId}-source-crash-${n}`;
    const long = n % 2 === 0;
    return {
      id,
      type: 'source',
      title: stressTitle(`${courseCode} 期中速成复习`, n, long),
      description: long
        ? 'text/markdown · 冲刺班讲义 · 覆盖高频考点与易错题型清单以及口述讲解提纲'
        : 'text/markdown · 128 KB',
      sourceCategory: 'crash_course_teacher_notes',
      sourceFileId: id,
      mimeType: 'text/markdown',
      size: 64_000 + n * 12_000,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - (16 - n) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - n * 2_400_000,
      reference: localDemoContentReference(courseId, id),
    } satisfies TeacherStudioContentItem;
  });

  const problemSources: TeacherStudioContentItem[] = Array.from({ length: 11 }, (_, index) => {
    const n = index + 1;
    const id = `${courseId}-source-problems-${n}`;
    const long = n === 1 || n === 7;
    return {
      id,
      type: 'source',
      title: stressTitle(`${courseCode} 历年试题精选`, n, long),
      description: `application/pdf · ${(2 + n * 0.2).toFixed(1)} MB`,
      sourceCategory: 'problem_bank',
      sourceFileId: id,
      mimeType: 'application/pdf',
      size: 2_000_000 + n * 90_000,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - (12 - n) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - n * 1_800_000,
      reference: localDemoContentReference(courseId, id),
    } satisfies TeacherStudioContentItem;
  });

  const notebooks: TeacherStudioContentItem[] = Array.from({ length: 12 }, (_, index) => {
    const n = index + 1;
    const id = `${courseId}-notebook-${n}`;
    const long = n % 4 === 1;
    const sourceFileId = schoolSources[Math.min(n - 1, schoolSources.length - 1)]!.id;
    return {
      id,
      type: 'notebook',
      title: long
        ? `${courseName}学习笔记 ${n} · 核心概念课堂例题常见误区分步推导综合练习与考前检查清单完整合集（本地 UI 压力测试标题）`
        : `${courseName}学习笔记 ${n}`,
      description: long
        ? '核心概念、课堂例题、常见误区、分步推导、期中复习重点、综合练习与考前检查清单；本条描述故意拉长以观察列表与阅读页副标题是否换行或裁切。'
        : n % 3 === 0
          ? '综合练习与考前检查清单'
          : n % 3 === 1
            ? '核心概念、课堂例题与常见误区'
            : '分步推导与期中复习重点',
      sourceFileId,
      notebookSections: [
        {
          id: `${id}-section-1`,
          title: long
            ? `第 ${n} 章 · 超长章节标题用于侧栏截断测试：从定义到证明再到例题与易错点汇总`
            : n % 3 === 1
              ? '核心概念'
              : n % 3 === 2
                ? '分步推导'
                : '综合练习',
          summary: long
            ? '本地预览章节摘要故意写得很长，用来检查侧栏 line-clamp 与教师端资料阅读界面在窄宽度下是否溢出或撑破布局。'
            : '本地预览章节，可用于检查教师端资料阅读界面。',
          markdown: `# ${courseName}学习笔记 ${n}\n\n这是本地演示数据，用于在数据库不可达时预览教师工作台。\n\n## 教学重点\n\n- 建立概念之间的联系\n- 用例题检查理解\n- 记录学生常见薄弱点\n\n## 补充说明\n\n${long ? `${LONG_UNBROKEN}\n\n` : ''}本笔记本条目用于列表密度与长文本溢出测试。`,
          sourcePages: [n, n + 1, n + 2],
        },
        {
          id: `${id}-section-2`,
          title: '例题精讲',
          summary: '第二段章节，便于切换侧栏。',
          markdown: `## 例题精讲\n\n第 ${n} 本笔记的第二段内容。`,
          sourcePages: [n + 3],
        },
      ],
      generation: {
        providerId: 'openai',
        model: 'gpt-5.6-terra',
        inputTokens: 12_400 + n * 800,
        outputTokens: 3_200 + n * 400,
        cachedInputTokens: 2_100,
        totalTokens: 15_600 + n * 1_200,
        qualityScore: 0.88 + (n % 10) / 100,
        generatedAt: LOCAL_DEMO_NOW - n * 86_400_000,
      },
      createdAt: LOCAL_DEMO_NOW - (14 - n) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - n * 3_600_000,
      reference: localDemoContentReference(courseId, id, 'active', n),
    } satisfies TeacherStudioContentItem;
  });

  const problemBanks: TeacherStudioContentItem[] = Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    const id = `${courseId}-problem-bank-${n}`;
    return {
      id,
      type: 'problem_bank',
      title:
        n === 1
          ? `${courseCode} 练习题库 · 按章节与难度整理并附带超长说明标题用于卡片溢出检查`
          : `${courseCode} 练习题库 ${n}`,
      description: `${30 + n * 12} 道练习题 · 按章节与难度整理`,
      createdAt: LOCAL_DEMO_NOW - (8 - n) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - n * 3_600_000,
      reference: localDemoContentReference(courseId, id),
    } satisfies TeacherStudioContentItem;
  });

  const content: TeacherStudioContentItem[] = [
    ...schoolSources,
    ...crashSources,
    ...problemSources,
    ...notebooks,
    ...problemBanks,
  ];

  const removedContent: TeacherStudioContentItem[] = Array.from({ length: 10 }, (_, index) => {
    const n = index + 1;
    const id = `${courseId}-removed-${n}`;
    const long = n % 3 === 0;
    return {
      id,
      type: n % 2 === 0 ? 'notebook' : 'source',
      title: long
        ? `${courseCode} 已移除资料 ${n} · ${LONG_UNBROKEN} · 旧版复习与废弃大纲备份.pdf`
        : `${courseCode} 旧版复习资料 ${n}.pdf`,
      description: long
        ? '已移除的本地预览资料，描述文本较长以便检查副标题与操作按钮并排时的布局。'
        : '已移除的本地预览资料',
      sourceCategory: 'crash_course_teacher_notes',
      sourceFileId: id,
      mimeType: 'application/pdf',
      size: 500_000 + n * 40_000,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - (40 - n) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - n * 86_400_000,
      reference: {
        ...localDemoContentReference(courseId, id, 'hidden'),
        hiddenAt: LOCAL_DEMO_NOW - n * 86_400_000,
      },
    } satisfies TeacherStudioContentItem;
  });

  const taskStatuses: Array<TeacherStudioTask['status']> = [
    'completed',
    'running',
    'queued',
    'failed',
    'completed',
    'running',
    'queued',
    'failed',
    'completed',
    'queued',
    'running',
    'failed',
  ];
  const taskSources = [...schoolSources, ...problemSources].slice(0, 12);
  const tasks: TeacherStudioTask[] = taskSources.map((source, index) => {
    const status = taskStatuses[index] ?? 'queued';
    const kind: TeacherStudioTask['kind'] = index % 3 === 0 ? 'mind_map' : 'knowledge_notebook';
    const longTitle = index % 2 === 0;
    return {
      id: `${courseId}-task-${index + 1}`,
      notebookId: notebooks[index % notebooks.length]?.id,
      kind,
      sourceId: source.id,
      sourceTitle: longTitle ? `${source.title} · 队列条目超长文件名截断测试` : source.title,
      sourceFileId: source.sourceFileId || source.id,
      sourceAssetId: source.id,
      requestedBy: teacherId,
      courseId,
      status,
      stage:
        status === 'completed'
          ? 'completed'
          : status === 'failed'
            ? 'failed'
            : status === 'running'
              ? 'extracting_structure'
              : 'queued',
      progress:
        status === 'completed' ? 100 : status === 'failed' ? 42 : status === 'running' ? 63 : 8,
      attemptCount: status === 'failed' ? 3 : 1,
      persistenceStatus:
        status === 'completed' ? 'complete' : status === 'failed' ? 'failed' : 'pending',
      persistenceStorage: 'postgresql',
      errorReason:
        status === 'failed'
          ? '本地预览：解析超时，错误信息故意写得很长以便检查队列行内错误文案是否被 line-clamp 截断而不撑破布局。'
          : undefined,
      createdAt: LOCAL_DEMO_NOW - (12 - index) * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - index * 3_600_000,
      completedAt: status === 'completed' ? LOCAL_DEMO_NOW - index * 3_600_000 : undefined,
    } satisfies TeacherStudioTask;
  });

  return { course, content, removedContent, tasks };
}

export function getLocalDemoCourseHardRules(
  courseId: string,
  teacherId: string,
): LocalDemoCourseHardRule[] {
  const base = new Date(LOCAL_DEMO_NOW).toISOString();
  const rules = [
    '所有定义先给直观解释，再给形式化表达。',
    '练习题只提供分步提示，不直接展示最终答案。',
    '涉及考试范围时，优先依据课程大纲与教师讲义。',
    '回答中如需代码，先说明输入输出与边界条件，再给出最小可运行示例；不要一次贴出完整作业解答。',
    '当学生追问“标准答案”时，改为给出检查清单与自测问题，引导其自行推导。',
    `长规则溢出测试：${LONG_UNBROKEN}；讲解时必须引用讲义章节编号，并在结尾用一句话复述学生当前卡点，同时避免剧透最终证明步骤与评分细则。`,
    '公式朗读时改用口语表达（例如 “a 的平方”），不要直接读 LaTeX 命令。',
    '若问题超出本学期大纲，明确说明范围，并给出可查阅的课程内资料入口，而不是编造课外内容。',
    '多轮对话中保持术语一致：同一概念不要混用多个别名，除非先解释等价关系。',
    '对学生上传的截图或作业片段，先确认读到的内容再作答；看不清时要求补充清晰图片。',
    'HardRule超长无空格连续文本测试_' +
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.repeat(3) +
      '_必须被truncate而不是撑破列表行',
    '课堂讨论风格：先复述问题，再给思路框架，最后给一个小练习；语气简洁、避免冗长寒暄。',
  ];
  return rules.map((content, position) => ({
    id: `${courseId}-hard-rule-${position + 1}`,
    courseId,
    ownerId: teacherId,
    content,
    position,
    createdAt: base,
    updatedAt: new Date(LOCAL_DEMO_NOW - position * 3_600_000).toISOString(),
  }));
}
