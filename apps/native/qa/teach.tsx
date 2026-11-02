/** Disposable browser-only fixture for the 教学 pages. Loopback dev server only; all data is fake. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppNavigationRail } from '../src/components/AppNavigationRail';
import { TeachPage } from '../src/components/TeachPage';
import { setBrowserAccount } from '../src/data/browser-runtime';
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
const now = Date.now();
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
];
const statuses = ['passed', 'partial', 'failed', 'pending'] as const;
const chapters = [
  { id: 'c1', name: '函数与变量' },
  { id: 'c2', name: '循环' },
  { id: 'c3', name: '列表与字典' },
];
const titles = [
  '表达式求值',
  '函数定义',
  '返回值',
  'while 循环',
  'for 循环',
  '累加器',
  '嵌套循环',
  '列表切片',
  '列表方法',
  '字典计数',
  '内存模型',
  '综合题',
];
const problems = titles.map((title, index) => ({
  id: `p${index + 1}`,
  title,
  type: 'code',
  number: index + 1,
  chapter: chapters[Math.min(2, Math.floor(index / 4))],
}));
const empty = new URLSearchParams(location.search).has('empty');
const roster = (empty ? [] : names).map((name, index) => ({
  userId: `u${index}`,
  name,
  email: `s${index}@mail.utoronto.ca`,
  avatarUrl: null,
  joinedAt: now - index * 86_400_000,
  source: index % 3 ? 'code' : 'teacher',
}));
let seed = 7;
const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const progress = roster.flatMap((person) =>
  problems
    .filter((_, index) => index < 9 && rand() > 0.28)
    .map((problem) => {
      const r = rand();
      return {
        userId: person.userId,
        problemId: problem.id,
        status: r < 0.55 ? 'passed' : r < 0.75 ? 'partial' : r < 0.93 ? 'failed' : 'pending',
        score: null,
        attemptedCount: 1 + Math.floor(rand() * 3),
      };
    }),
);
void statuses;
const teachClass = {
  class: {
    id: 'class1',
    name: 'CSC108 2026 秋季',
    joinCode: 'GLU5CZ',
    label: '2026 秋季',
    course: { id: 'course-csc108', name: '程序设计', courseCode: 'UTSG-CSC108' },
  },
  roster,
  visitors: empty ? [] : [{ userId: 'v1', name: '旁听同学', email: null, avatarUrl: null }],
  sessions: empty
    ? []
    : [
        {
          id: 's2',
          status: 'live',
          code: '482913',
          startedAt: now - 20 * 60_000,
          endedAt: null,
          participantCount: 7,
          itemCount: 3,
        },
        {
          id: 's1',
          status: 'ended',
          code: null,
          startedAt: now - 2 * 86_400_000,
          endedAt: now - 2 * 86_400_000 + 50 * 60_000,
          participantCount: 9,
          itemCount: 5,
        },
        {
          id: 's0',
          status: 'ended',
          code: null,
          startedAt: now - 9 * 86_400_000,
          endedAt: now - 9 * 86_400_000 + 50 * 60_000,
          participantCount: 8,
          itemCount: 4,
        },
      ],
  problems,
  progress,
};
const home = {
  currentPeriod: { label: '2026 秋季' },
  courses: [
    {
      id: 'course-csc108',
      name: '程序设计',
      courseCode: 'UTSG-CSC108',
      avatarUrl: null,
      problemCount: 80,
      currentClass: {
        id: 'class1',
        name: 'x',
        mine: true,
        memberCount: roster.length,
        liveSessionId: null,
      },
      pastClasses: [{ id: 'class0', name: 'x', label: '2026 夏季', memberCount: 14 }],
    },
  ],
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url, location.href);
  if (url.pathname === '/api/native/v1/teach') {
    const method = init?.method || 'GET';
    let data: unknown = home;
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      data = body.action === 'open-class' ? { classId: 'class1' } : teachClass;
    } else if (url.searchParams.get('classId')) data = teachClass;
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(input, init);
};

const noop = () => undefined;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="syntara-native-shell has-global-navigation">
      <AppNavigationRail
        active="teach"
        avatarUrl=""
        onOpenChat={noop}
        onOpenCalendar={noop}
        onOpenStore={noop}
        onOpenSettings={noop}
        onOpenClassroom={noop}
        onOpenTeach={noop}
      />
      <div className="native-global-page">
        <TeachPage onBack={noop} />
      </div>
    </main>
  </StrictMode>,
);
