/** Local QA entry (offline unless the dev grading bridge is explicitly enabled). Vite's production entry remains index.html. */
import { createRoot } from 'react-dom/client';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { getLocalRepository } from '../data/repository';
import type { LocalProblem } from '../domain/models';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION } from '../data/archive';
import { buildAdditionalPreviewProblems } from './problem-preview-fixtures';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';

if (!import.meta.env.DEV) throw new Error('仅供本机开发预览。');
const gradingCheck = new URLSearchParams(window.location.search).get('grading-check') === '1';
const fixturePrefix = gradingCheck ? 'browser-grading-qa' : 'handwriting-qa';
const now = Date.now();
const common = {
  courseId: `${fixturePrefix}-course`,
  notebookId: null,
  status: 'published' as const,
  difficulty: 'medium' as const,
  tags: [],
  createdAt: now,
  updatedAt: now,
};
const problems: LocalProblem[] = [
  {
    ...common,
    id: `${fixturePrefix}-single`,
    title: '单题 · 手写证明',
    type: gradingCheck ? 'short_answer' : 'proof',
    publicContent: {
      type: gradingCheck ? 'short_answer' : 'proof',
      stem: gradingCheck
        ? '计算 $2+2$，只写出结果。'
        : '证明：若 $f:A \\to B$ 与 $g:B \\to C$ 都是单射，则 $g \\circ f$ 也是单射。',
    },
    grading: gradingCheck ? { referenceAnswer: '4', points: 5 } : {},
  },
  {
    ...common,
    id: `${fixturePrefix}-parts`,
    title: '小问 · 手写解答',
    type: 'multipart',
    publicContent: {
      type: 'multipart',
      stem: '设 $f(x)=x^2$。请回答下面各问。',
      parts: [
        {
          label: 'i',
          type: 'short_answer',
          points: 5,
          prompt: '在实数集上，$f$ 是单射吗？说明理由。',
          content: { type: 'short_answer', stem: '在实数集上是单射吗？' },
        },
        {
          label: 'ii',
          type: gradingCheck ? 'short_answer' : 'proof',
          points: 5,
          prompt: gradingCheck
            ? '计算 $2+2$，只写出结果。'
            : '限制定义域为非负实数后，证明 $f$ 是单射。',
          content: {
            type: gradingCheck ? 'short_answer' : 'proof',
            stem: gradingCheck ? '计算 $2+2$，只写出结果。' : '证明限制定义域后是单射。',
          },
        },
      ],
    },
    grading: { type: 'multipart', parts: [] },
  },
  ...buildAdditionalPreviewProblems(common, fixturePrefix),
];
const repo = await getLocalRepository();
await repo.importArchive({
  format: SYNTARA_ARCHIVE_FORMAT,
  version: SYNTARA_ARCHIVE_VERSION,
  exportedAt: now,
  source: { kind: 'postgresql' },
  courses: [
    {
      id: common.courseId,
      name: '手写作答本机试用',
      description: '离线 QA 样例',
      language: 'zh-CN',
      tags: [],
      purpose: 'university',
      university: null,
      courseCode: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  notebooks: [],
  notebookPages: [],
  markdownSections: [],
  problems,
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
  return (
    <main style={{ height: '100dvh', padding: 12 }}>
      <ProblemPracticePage
        problems={problems}
        launch={{
          problemIds: problems.map((p) => p.id),
          initialProblemId: problems[0].id,
          title: '全题型作答预览 · 本机样例',
        }}
        onBack={() => {
          window.location.href = '/handwriting-preview.html';
        }}
      />
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Preview />);
import.meta.hot?.dispose(() => root.unmount());
