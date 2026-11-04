/** Disposable browser-only fixture for the student join flow. Loopback dev server only; fake data. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StorePage } from '../src/components/StorePage';
import { PendingCourseApplications } from '../src/components/PendingCourseApplications';
import { resolveNativeCourseAvatar } from '../src/assets';
import { setBrowserAccount } from '../src/data/browser-runtime';
import '../src/tailwind.css';
import '../src/components/marble-tokens.css';
import '../src/styles.css';
import '../src/components/compact-layout.css';
import '../src/components/avatar-theme.css';
import '../src/components/chat-visual-hierarchy.css';

if (
  !import.meta.env.DEV ||
  '__TAURI_INTERNALS__' in window ||
  !['127.0.0.1', 'localhost'].includes(location.hostname)
) {
  throw new Error('This fixture is restricted to a disposable loopback browser preview.');
}

setBrowserAccount('qa-student');
const now = Date.now();
const fields = [
  { id: 'sid', label: '学号', kind: 'text' as const },
  { id: 'phone', label: '手机后四位', kind: 'phone_last4' as const },
];
const org = { id: 'o1', name: 'SpeedUp', logoUrl: null, verified: true };
const storeCourse = (id: string, name: string, code: string, extra: object) => ({
  id,
  name,
  courseCode: code,
  description: '从函数、循环到列表和字典，配套笔记和练习题。',
  avatarUrl: '',
  organization: org,
  notebookCount: 12,
  sceneCount: 0,
  problemCount: 80,
  learnerCount: 46,
  averageRating: 4.8,
  reviewCount: 12,
  purpose: 'course',
  university: 'UofT',
  tags: ['编程'],
  joined: false,
  campus: 'UTSG',
  admission: { mode: 'approval', fields },
  applicationStatus: null,
  updatedAt: new Date(now).toISOString(),
  ...extra,
});
const courses = [
  storeCourse('c-mat', '微积分', 'MAT137', {}),
  storeCourse('c-csc', '程序设计入门', 'CSC108', { applicationStatus: 'pending' }),
  storeCourse('c-sta', '统计学导论', 'STA130', { admission: { mode: 'open', fields: [] } }),
];
const applications = [
  {
    id: 'a1',
    status: 'pending',
    updatedAt: new Date(now - 3_600_000).toISOString(),
    answers: { sid: '1007342', phone: '3021' },
    course: {
      id: 'c-csc',
      name: '程序设计入门',
      courseCode: 'CSC108',
      avatarUrl: null,
      admission: { mode: 'approval', fields },
      organization: org,
    },
  },
  {
    id: 'a2',
    status: 'rejected',
    updatedAt: new Date(now - 86_400_000).toISOString(),
    answers: { sid: '10073', phone: '30' },
    course: {
      id: 'c-eco',
      name: '微观经济学',
      courseCode: 'ECO101',
      avatarUrl: null,
      admission: { mode: 'approval', fields },
      organization: org,
    },
  },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url, location.href);
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), {
      headers: { 'content-type': 'application/json' },
    });
  if (url.pathname === '/api/native/v1/store') {
    if ((init?.method || 'GET') === 'POST') return reply({ courseId: 'c-csc', status: 'pending' });
    if (url.searchParams.has('myApplications')) return reply({ applications });
    const id = url.searchParams.get('courseId');
    if (id) {
      const course = courses.find((item) => item.id === id) ?? courses[0];
      return reply({
        course: {
          ...course,
          notebooks: [
            {
              id: 'n1',
              name: '第 1 讲 · 函数',
              description: null,
              sceneCount: 0,
              problemCount: 12,
            },
          ],
          reviews: [],
        },
      });
    }
    return reply({ courses });
  }
  return realFetch(input, init);
};

const enrolled = [
  ['c-1', 'CSC148'],
  ['c-2', 'MAT136'],
];
function Fixture() {
  const [store, setStore] = useState(new URLSearchParams(location.search).has('store'));
  return (
    <main className="syntara-native-shell" style={{ display: 'flex', height: '100vh' }}>
      <nav className="phone-drawer" style={{ position: 'relative', width: 300, flex: 'none' }}>
        <div style={{ padding: 12 }}>
          <h3 style={{ margin: '4px 8px 8px', fontSize: 13, color: '#64748b' }}>课程</h3>
          {enrolled.map(([id, code]) => (
            <div key={id} className="pca-row" style={{ color: '#0f172a', cursor: 'default' }}>
              <img
                src={resolveNativeCourseAvatar(id, code)}
                alt=""
                style={{ filter: 'none', opacity: 1 }}
              />
              <span className="pca-label">{code}</span>
            </div>
          ))}
          <PendingCourseApplications />
          <button type="button" style={{ margin: 12 }} onClick={() => setStore(true)}>
            打开商城
          </button>
        </div>
      </nav>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {store ? (
          <StorePage
            onBack={() => setStore(false)}
            onJoined={async () => undefined}
            onOpenCourse={() => undefined}
          />
        ) : null}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
