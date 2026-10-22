/** Disposable browser-only fixture. Run on a fresh loopback origin; never uses native SQLite or auth. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { getLocalRepository } from '../src/data/repository';
import { localDayKey } from '../src/components/LearningCalendarGrid';
import { writeStoredCourseAvatarId } from '../src/assets';
import '../src/tailwind.css';
import '../src/components/marble-tokens.css';
import '../src/styles.css';
import '../src/components/avatar-theme.css';

if (
  !import.meta.env.DEV ||
  '__TAURI_INTERNALS__' in window ||
  !['127.0.0.1', 'localhost'].includes(location.hostname)
) {
  throw new Error('This fixture is restricted to a disposable loopback browser preview.');
}
const definitions = [
  ['MAT136', '微积分', '分部积分'],
  ['CSC148', '计算机科学', '递归'],
  ['BUS200', '商业基础', '机会成本'],
  ['ECO101', '微观经济学', '供给与需求'],
  ['STA130', '统计学导论', '均值和中位数'],
  ['PSY100', '心理学导论', '认知'],
  ['PHY131', '物理学', '运动'],
  ['CHM135', '化学', '分子'],
  ['HIS101', '历史', '历史'],
  ['ENG100', '大学写作', '论文结构'],
  ['POL101', '政治学', '制度'],
  ['BIO120', '生物学', '细胞'],
  ['MAT102', '数学证明', '归纳法'],
  ['CSC108', '程序设计', '函数'],
  ['SOC100', '社会学', '社会结构'],
  ['AST101', '天文学', '恒星'],
  ['PHL101', '哲学', '逻辑'],
  ['ENV100', '环境科学', '生态'],
  ['ANT100', '人类学', '文化'],
  ['LIN101', '名称很长的语言学入门与跨文化语言研究课程', '语法'],
];
const requested = Number(new URLSearchParams(location.search).get('count') ?? 12);
const count = [0, 1, 12, 20].includes(requested) ? requested : 12;
const now = Date.now();
const courses = definitions.slice(0, count).map(([courseCode, name], i) => ({
  id: `qa-native-home-${count}-${courseCode}`,
  courseCode,
  name,
  description: '',
  language: 'zh-CN' as const,
  tags: [],
  purpose: 'university' as const,
  university: null,
  createdAt: 1,
  updatedAt: now - i * 3600000,
}));
const repository = await getLocalRepository();
await repository.bootstrap();
await repository.upsertPlatformCourses(courses);
await repository.setPlatformCourseIds(courses.map((course) => course.id));
for (const [i, course] of courses.entries()) {
  const conversationId = `qa-native-chat-${count}-${course.courseCode}`;
  await repository.mergeSyncedConversation(
    {
      id: conversationId,
      courseId: course.id,
      notebookId: null,
      title: definitions[i][2],
      createdAt: 1,
      updatedAt: now - i * 3600000,
    },
    [
      {
        id: `${conversationId}-user`,
        conversationId,
        role: 'user',
        text: `一起复习${definitions[i][2]}`,
        createdAt: now - 60000,
      },
      {
        id: `${conversationId}-assistant`,
        conversationId,
        role: 'assistant',
        text: '这是保存在隔离预览库中的验收对话。',
        createdAt: now - 30000,
      },
    ],
  );
  writeStoredCourseAvatarId(course.id, ['R07', 'SR02', 'R14', 'R04'][i % 4]);
}
if (courses.length) {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  await repository.upsertCourseEvents(
    [0, 2, 4].map((offset, i) => {
      const day = new Date(monday);
      day.setDate(day.getDate() + offset);
      const course = courses[[2, 0, 1][i] % courses.length];
      return {
        id: `${course.id}:qa-native-event-${i}`,
        courseId: course.id,
        title: ['课堂讨论', '微积分课', '课程讨论'][i],
        date: localDayKey(day),
        note: '',
        kind: 'tutorial',
        source: 'manual',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
    }),
  );
}
const previewRoot =
  import.meta.hot?.data.previewRoot ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.previewRoot = previewRoot;
previewRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
