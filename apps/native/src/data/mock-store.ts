import { MARBLE_AVATAR_CATALOG } from '../../../../lib/constants/marble-avatars';
import { platformAvailable } from './browser-runtime';
import type { NativeStoreCourseDetail } from './platform-api-contracts';
import { getLocalRepository } from './repository';

/** Only the offline browser development preview uses this catalog. */
export const mockStoreEnabled = import.meta.env.DEV && !platformAvailable();

const catalog = [
  [
    'CSC108',
    'Python 程序设计',
    '从第一行代码开始，掌握函数、循环与文件处理。',
    ['函数与变量', '条件与循环', '列表与文件'],
  ],
  [
    'CSC148',
    '数据结构与面向对象',
    '用递归和数据结构，建立解决复杂问题的思路。',
    ['类与对象', '递归思维', '树与链表'],
  ],
  [
    'MAT102',
    '数学证明入门',
    '从集合与逻辑出发，写出清晰、严谨的数学证明。',
    ['集合与逻辑', '证明方法', '数学归纳法'],
  ],
  [
    'MAT136',
    '积分学',
    '理解积分的意义，连接计算技巧与实际应用。',
    ['积分基础', '积分技巧', '积分应用'],
  ],
  [
    'STA130',
    '统计与数据探索',
    '用真实问题认识数据、概率和统计推断。',
    ['数据可视化', '概率基础', '统计推断'],
  ],
  [
    'ECO101',
    '微观经济学',
    '从供需到市场结构，理解每一次选择背后的逻辑。',
    ['供给与需求', '消费者选择', '市场结构'],
  ],
  [
    'ECO102',
    '宏观经济学',
    '读懂经济增长、通货膨胀和货币政策。',
    ['国民收入', '经济增长', '货币与政策'],
  ],
  [
    'RSM100',
    '商业管理入门',
    '探索战略、组织与运营，建立商业分析的基础。',
    ['商业环境', '组织与管理', '企业战略'],
  ],
  [
    'RSM219',
    '财务会计',
    '从交易记录到财务报表，一步步读懂企业财务。',
    ['会计等式', '交易与分录', '财务报表'],
  ],
  [
    'PHY131',
    '大学物理：力学',
    '从运动与受力出发，用模型解释身边的世界。',
    ['运动学', '牛顿定律', '能量与动量'],
  ],
  [
    'PSY100',
    '心理学导论',
    '探索感知、记忆与行为，理解我们如何认识世界。',
    ['感知与注意', '学习与记忆', '社会心理'],
  ],
  [
    'PHL101',
    '哲学与批判性思维',
    '辨析论证、提出问题，练习有根据地表达观点。',
    ['论证与逻辑', '知识与怀疑', '伦理与选择'],
  ],
] as const;

export const mockStoreCourses: NativeStoreCourseDetail[] = catalog.map(
  ([code, name, description, chapters], index) => ({
    id: `mock-store-${code.toLowerCase()}`,
    name,
    courseCode: code,
    description: `${description}\n\n课程包括章节笔记、知识点梳理和分层练习，适合课前预习与考前复习。`,
    avatarUrl: MARBLE_AVATAR_CATALOG[(index * 3 + 2) % MARBLE_AVATAR_CATALOG.length].url,
    organization: { id: 'mock-syntara', name: 'Syntara 示例学院', logoUrl: null, verified: true },
    notebookCount: chapters.length,
    sceneCount: 0,
    problemCount: 0,
    learnerCount: 320 + ((index * 743) % 4100),
    averageRating: (46 + (index % 4)) / 10,
    reviewCount: 38 + index * 17,
    purpose: 'university',
    university: 'University of Toronto',
    tags: ['示例课程', code, name],
    joined: false,
    updatedAt: '2026-10-31T18:00:00.000Z',
    notebooks: chapters.map((chapter, chapterIndex) => ({
      id: `mock-store-${code}-${chapterIndex}`,
      name: chapter,
      description: `${chapter}的核心概念与复习提纲。`,
      sceneCount: 0,
      problemCount: 0,
    })),
    reviews: [
      {
        id: `${code}-review-1`,
        rating: 5,
        comment: '章节顺序很清楚，适合跟着课程一点点复习。',
        reviewerName: '示例学生 · 小林',
      },
      {
        id: `${code}-review-2`,
        rating: 4,
        comment: '重点整理得很直观，预习时用起来很方便。',
        reviewerName: '示例学生 · Alex',
      },
    ],
  }),
);

async function findLocalCourse(course: NativeStoreCourseDetail) {
  const repository = await getLocalRepository();
  const courses = await repository.listCourseSummaries();
  return courses.find((item) => item.courseCode === course.courseCode);
}

export async function listMockStoreCourses() {
  const repository = await getLocalRepository();
  const local = await repository.listCourseSummaries();
  return mockStoreCourses.map((course) => ({
    ...course,
    joined: local.some((item) => item.courseCode === course.courseCode),
  }));
}

export async function getMockStoreCourse(id: string) {
  const course = mockStoreCourses.find((item) => item.id === id);
  if (!course) throw new Error('找不到这门示例课程。');
  return { ...course, joined: Boolean(await findLocalCourse(course)) };
}

export async function joinMockStoreCourse(id: string): Promise<string> {
  const course = await getMockStoreCourse(id);
  const existing = await findLocalCourse(course);
  if (existing) return existing.id;
  const repository = await getLocalRepository();
  const created = await repository.createCourse({
    name: course.name,
    description: course.description ?? '',
    purpose: 'university',
  });
  await repository.updateCourse({
    id: created.id,
    name: course.name,
    description: course.description ?? '',
    courseCode: course.courseCode,
  });
  for (const notebook of course.notebooks) {
    await repository.importTextMaterial({
      courseId: created.id,
      name: notebook.name,
      source: 'notes',
      text: `# ${notebook.name}\n\n${notebook.description}\n\n这是一份本地商城示例笔记，供界面与交互调试使用。\n\n## 复习提纲\n\n- 整理本章的核心概念\n- 用自己的话解释概念之间的联系\n- 记录需要进一步练习的问题`,
    });
  }
  return created.id;
}
