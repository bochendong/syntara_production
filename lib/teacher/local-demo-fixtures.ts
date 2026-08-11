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
    createdAt: homeCourse.createdAt,
    updatedAt: homeCourse.updatedAt,
  } satisfies TeacherStudioCourse;

  const content: TeacherStudioContentItem[] = [
    {
      id: `${courseId}-source-syllabus`,
      type: 'source',
      title: `${courseCode} 课程大纲.pdf`,
      description: 'application/pdf · 1.8 MB',
      sourceCategory: 'school_teacher_notes',
      sourceFileId: `${courseId}-source-syllabus`,
      mimeType: 'application/pdf',
      size: 1_887_436,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - 14 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 8 * 86_400_000,
      reference: localDemoContentReference(courseId, `${courseId}-source-syllabus`),
    },
    {
      id: `${courseId}-source-lecture`,
      type: 'source',
      title: `${courseName}第 1-4 周讲义.pdf`,
      description: 'application/pdf · 4.2 MB',
      sourceCategory: 'school_teacher_notes',
      sourceFileId: `${courseId}-source-lecture`,
      mimeType: 'application/pdf',
      size: 4_372_921,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - 12 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 5 * 86_400_000,
      reference: localDemoContentReference(courseId, `${courseId}-source-lecture`),
    },
    {
      id: `${courseId}-source-crash-course`,
      type: 'source',
      title: `${courseCode} 期中速成复习.md`,
      description: 'text/markdown · 86 KB',
      sourceCategory: 'crash_course_teacher_notes',
      sourceFileId: `${courseId}-source-crash-course`,
      mimeType: 'text/markdown',
      size: 88_064,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - 8 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 2 * 86_400_000,
      reference: localDemoContentReference(courseId, `${courseId}-source-crash-course`),
    },
    {
      id: `${courseId}-source-problems`,
      type: 'source',
      title: `${courseCode} 历年试题精选.pdf`,
      description: 'application/pdf · 2.6 MB',
      sourceCategory: 'problem_bank',
      sourceFileId: `${courseId}-source-problems`,
      mimeType: 'application/pdf',
      size: 2_721_382,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - 7 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 86_400_000,
      reference: localDemoContentReference(courseId, `${courseId}-source-problems`),
    },
    ...[1, 2, 3].map(
      (index) =>
        ({
          id: `${courseId}-notebook-${index}`,
          type: 'notebook',
          title: `${courseName}学习笔记 ${index}`,
          description:
            index === 1
              ? '核心概念、课堂例题与常见误区'
              : index === 2
                ? '分步推导与期中复习重点'
                : '综合练习与考前检查清单',
          sourceFileId: index === 1 ? `${courseId}-source-lecture` : `${courseId}-source-syllabus`,
          notebookSections: [
            {
              id: `${courseId}-notebook-${index}-section-1`,
              title: index === 1 ? '核心概念' : index === 2 ? '分步推导' : '综合练习',
              summary: '本地预览章节，可用于检查教师端资料阅读界面。',
              markdown: `# ${courseName}学习笔记 ${index}\n\n这是本地演示数据，用于在数据库不可达时预览教师工作台。\n\n## 教学重点\n\n- 建立概念之间的联系\n- 用例题检查理解\n- 记录学生常见薄弱点`,
              sourcePages: [index, index + 1],
            },
          ],
          generation: {
            providerId: 'openai',
            model: 'gpt-5.6-terra',
            inputTokens: 12_400 + index * 800,
            outputTokens: 3_200 + index * 400,
            cachedInputTokens: 2_100,
            totalTokens: 15_600 + index * 1_200,
            qualityScore: 0.92,
            generatedAt: LOCAL_DEMO_NOW - index * 86_400_000,
          },
          createdAt: LOCAL_DEMO_NOW - (6 - index) * 86_400_000,
          updatedAt: LOCAL_DEMO_NOW - index * 3_600_000,
          reference: localDemoContentReference(
            courseId,
            `${courseId}-notebook-${index}`,
            'active',
            index,
          ),
        }) satisfies TeacherStudioContentItem,
    ),
    {
      id: `${courseId}-problem-bank`,
      type: 'problem_bank',
      title: `${courseCode} 练习题库`,
      description: '42 道练习题 · 按章节与难度整理',
      createdAt: LOCAL_DEMO_NOW - 5 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 2 * 3_600_000,
      reference: localDemoContentReference(courseId, `${courseId}-problem-bank`),
    },
  ];

  const removedContent: TeacherStudioContentItem[] = [
    {
      id: `${courseId}-removed-source`,
      type: 'source',
      title: `${courseCode} 旧版复习资料.pdf`,
      description: '已移除的本地预览资料',
      sourceCategory: 'crash_course_teacher_notes',
      sourceFileId: `${courseId}-removed-source`,
      mimeType: 'application/pdf',
      size: 745_221,
      ingestStatus: 'completed',
      createdAt: LOCAL_DEMO_NOW - 30 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 86_400_000,
      reference: localDemoContentReference(courseId, `${courseId}-removed-source`, 'hidden'),
    },
  ];

  const tasks: TeacherStudioTask[] = [
    {
      id: `${courseId}-task-notebook`,
      notebookId: `${courseId}-notebook-1`,
      kind: 'knowledge_notebook',
      sourceId: `${courseId}-source-lecture`,
      sourceTitle: `${courseName}第 1-4 周讲义.pdf`,
      sourceFileId: `${courseId}-source-lecture`,
      sourceAssetId: `${courseId}-source-lecture`,
      requestedBy: teacherId,
      courseId,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      attemptCount: 1,
      persistenceStatus: 'complete',
      persistenceStorage: 'postgresql',
      createdAt: LOCAL_DEMO_NOW - 5 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 4 * 86_400_000,
      completedAt: LOCAL_DEMO_NOW - 4 * 86_400_000,
    },
    {
      id: `${courseId}-task-problems`,
      notebookId: `${courseId}-notebook-3`,
      kind: 'knowledge_notebook',
      sourceId: `${courseId}-source-problems`,
      sourceTitle: `${courseCode} 历年试题精选.pdf`,
      sourceFileId: `${courseId}-source-problems`,
      sourceAssetId: `${courseId}-source-problems`,
      requestedBy: teacherId,
      courseId,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      attemptCount: 1,
      persistenceStatus: 'complete',
      persistenceStorage: 'postgresql',
      createdAt: LOCAL_DEMO_NOW - 3 * 86_400_000,
      updatedAt: LOCAL_DEMO_NOW - 2 * 86_400_000,
      completedAt: LOCAL_DEMO_NOW - 2 * 86_400_000,
    },
  ];

  return { course, content, removedContent, tasks };
}

export function getLocalDemoCourseHardRules(
  courseId: string,
  teacherId: string,
): LocalDemoCourseHardRule[] {
  const updatedAt = new Date(LOCAL_DEMO_NOW).toISOString();
  return [
    '所有定义先给直观解释，再给形式化表达。',
    '练习题只提供分步提示，不直接展示最终答案。',
    '涉及考试范围时，优先依据课程大纲与教师讲义。',
  ].map((content, position) => ({
    id: `${courseId}-hard-rule-${position + 1}`,
    courseId,
    ownerId: teacherId,
    content,
    position,
    createdAt: updatedAt,
    updatedAt,
  }));
}
