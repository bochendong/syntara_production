/** Local mock: real bank, practice, badge and celebration components; disposable data. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  Brain,
  FolderOpen,
  Home,
  MessageSquarePlus,
  PanelLeft,
  Radio,
  Search,
  Store,
  Target,
  CalendarDays,
} from 'lucide-react';
import { ProblemBankPage, type ProblemBankLaunch } from '../components/ProblemBankPage';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { PracticeOverlay } from '../components/PracticeOverlay';
import { ClassroomLiveBadge } from '../components/ClassroomPanel';
import { PracticeCelebration } from '../components/problem-bank/PracticeCelebration';
import { getLocalRepository } from '../data/repository';
import { setBrowserAccount, browserApp } from '../data/browser-runtime';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION } from '../data/archive';
import type { LocalCourse, LocalProblem } from '../domain/models';
import type { NativeClassroomSession } from '../data/platform-api-client';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';
import '../components/app-navigation-rail.css';
import './practice-celebration-preview.css';

if (!import.meta.env.DEV || !browserApp || !['localhost', '127.0.0.1'].includes(location.hostname))
  throw new Error('仅供本机 Mock；请使用 VITE_SYNTARA_WEB_APP=1。');
// A dedicated account database; never import fixtures into an existing account.
const account = 'practice-celebration-mock-v1';
setBrowserAccount(account);
await new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(`Syntara-Web-Staging-${account}`);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('请先关闭其他本地庆祝 Mock 标签页。'));
});
const now = Date.now();
const course: LocalCourse = {
  id: 'celebration-mock-course',
  name: 'CSC 108',
  courseCode: 'CSC108',
  description: '',
  language: 'zh-CN',
  tags: [],
  purpose: 'university',
  university: null,
  createdAt: now,
  updatedAt: now,
};
const chapters = [
  ['基础类型与表达式', 17],
  ['字符串与切片', 26],
  ['函数、返回值与文档字符串', 27],
  ['布尔逻辑与条件分支', 37],
  ['循环基础', 55],
  ['列表索引与切片', 9],
  ['别名与可变性', 15],
  ['列表循环', 65],
  ['嵌套列表与矩阵', 43],
  ['文件输入输出与 CSV 数据处理', 41],
  ['测试用例与程序正确性', 1],
] as const;
const questions = [
  ['字符串的长度', '表达式 len("hello") 的结果是什么？', '4', '5'],
  ['读取第一个字符', '表达式 "python"[0] 的结果是什么？', 'y', 'p'],
  ['字符串切片', '表达式 "python"[1:4] 的结果是什么？', 'pyt', 'yth'],
  ['读取最后一个字符', '表达式 "hello"[-1] 的结果是什么？', 'h', 'o'],
  ['切片步长', '表达式 "abcdef"[::2] 的结果是什么？', 'bdf', 'ace'],
  ['字符串拼接', '表达式 "hello" + "!" 的结果是什么？', 'hello !', 'hello!'],
] as const;
const problems: LocalProblem[] = chapters.flatMap(([chapter, count], chapterIndex) =>
  Array.from({ length: count }, (_, index) => {
    const [title, stem, wrong, right] = questions[index % questions.length];
    return {
      id: `celebration-mock-${chapterIndex}-${index}`,
      courseId: course.id,
      notebookId: null,
      chapterId: `chapter-${chapterIndex}`,
      chapterName: `${String(chapterIndex + 1).padStart(2, '0')} ${chapter}`,
      title,
      difficulty: 'easy',
      type: 'choice',
      status: 'published',
      tags: ['TT2 复习'],
      publicContent: {
        type: 'choice',
        stem,
        selectionMode: 'single',
        options: [
          { id: 'A', label: wrong },
          { id: 'B', label: right },
        ],
      },
      grading: { type: 'choice', correctOptionIds: ['B'] },
      createdAt: now + index,
      updatedAt: now,
    } satisfies LocalProblem;
  }),
);
const repo = await getLocalRepository();
await repo.importArchive({
  format: SYNTARA_ARCHIVE_FORMAT,
  version: SYNTARA_ARCHIVE_VERSION,
  exportedAt: now,
  source: { kind: 'postgresql' },
  courses: [course],
  problems,
  notebooks: [],
  notebookPages: [],
  markdownSections: [],
  problemAttempts: [],
  problemProgress: [],
  conversations: [],
  messages: [],
  studyMemories: [],
  assets: [],
  pageAssets: [],
  notebookAssets: [],
  missingAssetPaths: [],
});
await repo.setPlatformCourseIds([]);
const seeds = ['2-0', '4-0', '6-0', '8-0', '8-1', '8-2', '8-3', '9-0', '9-1', '10-0'];
for (const suffix of seeds)
  await repo.saveProblemAttempt({
    problemId: `celebration-mock-${suffix}`,
    answer: { kind: 'choice', selectedOptionIds: ['B'] },
    status: 'passed',
    score: 1,
    feedback: '本地模拟通过',
  });
const practiceProblems = problems.filter((problem) => problem.chapterId === 'chapter-1');
const sessions: NativeClassroomSession[] = [
  {
    id: 'mock-session',
    number: 2,
    name: 'TT2 复习',
    status: 'live',
    joined: true,
    startedAt: now,
    endedAt: null,
    className: 'CSC108',
    courseId: course.id,
    courseName: course.name,
    teacherName: '老师',
    items: practiceProblems.slice(0, 5).map((problem, index) => ({
      id: `mock-item-${index}`,
      problemId: problem.id,
      title: problem.title,
      type: 'choice',
      number: index + 1,
      addedAt: now,
      myStatus: null,
      myAttempts: 0,
    })),
  },
];

function Preview() {
  const [launch, setLaunch] = useState<ProblemBankLaunch | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [example, setExample] = useState(
    new URLSearchParams(location.search).get('scene') === 'celebrate',
  );
  const [notice, setNotice] = useState('');
  const [classroomOpen, setClassroomOpen] = useState(false);
  const [classroomDismissed, setClassroomDismissed] = useState(false);
  const expanded = Boolean(launch && !minimized);
  const openPractice = (next: ProblemBankLaunch) => {
    setLaunch(next);
    setMinimized(false);
  };
  return (
    <div className="mock-page">
      <div className="mock-shell">
        <nav className="mock-rail" aria-label="全局导航">
          <span className="is-active">
            <Home size={20} />
            首页
          </span>
          <span>
            <Store size={20} />
            商城
          </span>
          <span>
            <CalendarDays size={20} />
            日历
          </span>
          <span>
            <Radio size={20} />
            上课
          </span>
        </nav>
        <div className="app-chat-surface" inert={expanded || example}>
          <div className="mock-workspace">
            <aside className="mock-sidebar">
              <h1>
                Syntara <small>测试版</small>
                <Search size={18} />
              </h1>
              <p>
                <MessageSquarePlus size={17} /> 新聊天
              </p>
              <div className="mock-sidebar-label">
                课程 <span>＋ 新课程</span>
              </div>
              <strong className="mock-course">🌐　CSC 108</strong>
              <small className="mock-empty">暂无聊天</small>
              <div className="mock-sidebar-label">最近</div>
              <p>r+ 是什么模式</p>
            </aside>
            <div className="mock-main">
              <header className="mock-toolbar">
                <PanelLeft size={19} />
                <div className="mock-tabs">
                  <span>
                    <FolderOpen size={17} />
                    资料
                  </span>
                  <span className="is-active">
                    <Target size={17} />
                    题库
                  </span>
                  <span>
                    <BookOpen size={17} />
                    笔记
                  </span>
                  <span>
                    <Target size={17} />
                    进度
                  </span>
                  <span>
                    <Brain size={17} />
                    记忆
                  </span>
                </div>
                <button type="button" onClick={() => setNotice('本地 Mock，聊天不连接真实服务。')}>
                  <MessageSquarePlus size={16} /> 新聊天
                </button>
              </header>
              <ProblemBankPage
                workspace={{ course, problems, notebooks: [], conversations: [], memories: [] }}
                onBack={() => setNotice('当前是本地题库 Mock。')}
                onPractice={openPractice}
                onUpload={() => setNotice('本地 Mock，不上传文件。')}
              />
            </div>
          </div>
        </div>
        {expanded || classroomDismissed ? null : (
          <ClassroomLiveBadge
            sessions={sessions}
            abovePractice={Boolean(launch && minimized)}
            onDismiss={() => setClassroomDismissed(true)}
            onOpen={() => setClassroomOpen(true)}
          />
        )}
        {classroomOpen && !expanded ? (
          <section className="mock-classroom" aria-label="正在进行的课堂 · 本地模拟">
            <header>
              <button type="button" onClick={() => setClassroomOpen(false)}>
                ← 回题库
              </button>
              <span>课堂 · 本地 Mock</span>
            </header>
            <h2>TT2 复习</h2>
            <p>CSC 108</p>
            <div className="mock-classroom-items">
              {practiceProblems.slice(0, 5).map((problem, index) => (
                <button
                  type="button"
                  key={problem.id}
                  onClick={() =>
                    openPractice({
                      problemIds: practiceProblems.slice(0, 5).map((p) => p.id),
                      initialProblemId: problem.id,
                      title: 'TT2 复习',
                    })
                  }
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{problem.title}</strong>
                  <span>开始做题 →</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {launch ? (
          <PracticeOverlay
            key={launch.initialProblemId}
            minimized={minimized}
            onClose={() => setMinimized(true)}
            onRestore={() => setMinimized(false)}
            onDismiss={() => {
              setLaunch(null);
              setMinimized(false);
            }}
          >
            <ProblemPracticePage
              problems={problems}
              launch={launch}
              onBack={() => setMinimized(true)}
              onMinimize={() => setMinimized(true)}
            />
          </PracticeOverlay>
        ) : null}
        {example ? (
          <PracticeCelebration
            snapshot={{ newlyPassed: 5, passed: 5, attempted: 5, total: 26, title: '字符串与切片' }}
            onClose={() => setExample(false)}
            onContinue={() => setExample(false)}
          />
        ) : null}
      </div>
      <footer className="mock-controls">
        <span>
          <b>本地 Mock · 模拟数据</b>
          <small>{notice || '每新通过 5 道题触发一次；本页作答仅保存在独立本机数据库。'}</small>
        </span>
        <button type="button" onClick={() => location.assign(location.pathname)}>
          重置
        </button>
        <button type="button" onClick={() => setExample(true)}>
          看礼花与卡片
        </button>
        <button
          type="button"
          className="mock-primary"
          onClick={() =>
            openPractice({
              problemIds: practiceProblems.map((p) => p.id),
              initialProblemId: practiceProblems[0].id,
              title: '字符串与切片',
            })
          }
        >
          体验本地提交 →
        </button>
      </footer>
    </div>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Preview />);
import.meta.hot?.dispose(() => root.unmount());
