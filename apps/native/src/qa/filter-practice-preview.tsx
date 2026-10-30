/** Local fixtures exercise the real bank-to-practice flow without platform writes. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProblemBankPage, type ProblemBankLaunch } from '../components/ProblemBankPage';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { getLocalRepository } from '../data/repository';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION } from '../data/archive';
import type { LocalCourse, LocalProblem } from '../domain/models';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';

if (!import.meta.env.DEV) throw new Error('仅供本机开发预览。');
const now = Date.now();
const course: LocalCourse = {
  id: 'filter-practice-preview-course',
  name: '筛选练习本机样例',
  description: '',
  language: 'zh-CN',
  tags: [],
  purpose: 'university',
  university: null,
  courseCode: null,
  createdAt: now,
  updatedAt: now,
};
const specs = [
  ['函数A1', 'functions', '函数', 'medium', 'choice', 'TT1模拟A卷'],
  ['函数B排除题', 'functions', '函数', 'medium', 'choice', 'TT1模拟B卷'],
  ['函数A2', 'functions', '函数', 'hard', 'proof', 'TT1模拟A卷'],
  ['关系A1', 'relations', '关系', 'medium', 'choice', 'TT1模拟A卷'],
  ['关系A2', 'relations', '关系', 'hard', 'proof', 'TT1模拟A卷'],
  ['函数A3', 'functions', '函数', 'hard', 'choice', 'TT1模拟A卷'],
] as const;
const problems: LocalProblem[] = specs.map(
  ([title, chapterId, chapterName, difficulty, type, series], index) => ({
    id: `filter-preview-${index}`,
    courseId: course.id,
    notebookId: null,
    chapterId,
    chapterName,
    title,
    difficulty,
    type,
    status: 'published',
    tags: [series],
    publicContent:
      type === 'choice'
        ? {
            type: 'choice',
            stem: `${title}：计算 2+2。`,
            selectionMode: 'single',
            options: [
              { id: 'A', label: '3' },
              { id: 'B', label: '4' },
            ],
          }
        : { type: 'proof', stem: `${title}：证明样例。` },
    grading:
      type === 'choice'
        ? { type: 'choice', correctOptionIds: ['B'] }
        : { type: 'proof', referenceProof: '样例。' },
    createdAt: now + index,
    updatedAt: now,
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

function Preview() {
  const [launch, setLaunch] = useState<ProblemBankLaunch | null>(null);
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div style={launch ? { display: 'none' } : { display: 'contents' }}>
        <ProblemBankPage
          workspace={{ course, problems, notebooks: [], conversations: [], memories: [] }}
          onBack={() => window.location.reload()}
          onPractice={setLaunch}
        />
      </div>
      {launch ? (
        <ProblemPracticePage problems={problems} launch={launch} onBack={() => setLaunch(null)} />
      ) : null}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
