/** 错题本和学习分析侧栏的本机预览：样例课程、做题记录和同班数据都在本机。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProblemBankPage, type ProblemBankLaunch } from '../components/ProblemBankPage';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { getLocalRepository } from '../data/repository';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION } from '../data/archive';
import type {
  LocalCourse,
  LocalProblem,
  LocalProblemAttempt,
  LocalProblemProgress,
} from '../domain/models';
import type { BankComparison } from '../../../../lib/problem-bank/bank-comparison';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';

if (!import.meta.env.DEV) throw new Error('仅供本机开发预览。');
const DAY = 86_400_000;
const now = Date.now();
const course: LocalCourse = {
  id: 'mistake-book-preview-course',
  name: 'CSCA08 错题本样例',
  description: '',
  language: 'zh-CN',
  tags: [],
  purpose: 'university',
  university: null,
  courseCode: 'CSCA08',
  createdAt: now,
  updatedAt: now,
};

const chapters = [
  ['03 · Functions', 6],
  ['04 · If / Booleans', 6],
  ['05 · Strings', 5],
  ['06 · Loops', 7],
  ['07 · Lists', 6],
  ['08 · Dictionaries', 5],
] as const;
const stems = [
  'while 循环什么时候结束？',
  'not (a and b) 等价于哪一个？',
  'Trace：for i in range(3) 之后 total 的值',
  's[1:4] 的结果是什么？',
  'count_vowels(s) 返回元音个数',
  'lst.append(x) 返回什么？',
  'd.get(k, 0) 什么时候返回 0？',
  'break 和 continue 的区别',
  'return 和 print 有什么不同？',
  'len("") 等于多少？',
];

// 每道题的作答：'p' 通过，'f' 错了，'x' 部分对，'fp' 先错后对，'' 没做；数字是几天前。
const plan: [string, number][][] = [
  [
    ['p', 6],
    ['fp', 5],
    ['f', 4],
    ['p', 6],
    ['', 0],
    ['', 0],
  ],
  [
    ['p', 3],
    ['f', 3],
    ['p', 2],
    ['fp', 2],
    ['f', 7],
    ['', 0],
  ],
  [
    ['p', 1],
    ['p', 1],
    ['p', 1],
    ['p', 2],
    ['p', 2],
  ],
  [
    ['f', 0],
    ['x', 2],
    ['p', 1],
    ['fp', 0],
    ['f', 5],
    ['p', 0],
    ['', 0],
  ],
  [
    ['f', 1],
    ['p', 1],
    ['', 0],
    ['', 0],
    ['', 0],
    ['', 0],
  ],
  [
    ['', 0],
    ['', 0],
    ['', 0],
    ['', 0],
    ['', 0],
  ],
];

const problems: LocalProblem[] = [];
const attempts: LocalProblemAttempt[] = [];
const progress: LocalProblemProgress[] = [];
let n = 0;
chapters.forEach(([chapterName, size], chapterIndex) => {
  for (let index = 0; index < size; index += 1) {
    const id = `mb-${chapterIndex}-${index}`;
    const code = index === 4;
    const stem = stems[(chapterIndex * 3 + index) % stems.length];
    problems.push({
      id,
      courseId: course.id,
      notebookId: null,
      chapterId: `ch-${chapterIndex}`,
      chapterName,
      order: index,
      title: stem,
      type: code ? 'code' : 'choice',
      status: 'published',
      difficulty: (['easy', 'medium', 'hard'] as const)[(index + chapterIndex) % 3],
      tags: [],
      publicContent: code
        ? { type: 'code', stem, language: 'python', starterCode: 'def f(s):\n    pass\n' }
        : {
            type: 'choice',
            stem,
            selectionMode: 'single',
            options: ['A', 'B', 'C', 'D'].map((optionId, i) => ({
              id: optionId,
              label: ['3', '4', 'True', 'None'][i],
            })),
          },
      grading: code ? { type: 'code' } : { type: 'choice', correctOptionIds: ['C'] },
      createdAt: now - 30 * DAY + n,
      updatedAt: now,
    });
    const [kind, daysAgo] = plan[chapterIndex][index] ?? ['', 0];
    n += 1;
    if (!kind) continue;
    const at = now - daysAgo * DAY - (n % 5) * 3_600_000;
    const steps =
      kind === 'fp'
        ? ['failed', 'passed']
        : kind === 'p'
          ? ['passed']
          : kind === 'x'
            ? ['partial']
            : ['failed', 'failed'].slice(0, 1 + (n % 2));
    steps.forEach((status, step) => {
      attempts.push({
        id: `${id}-a${step}`,
        problemId: id,
        kind: 'submit',
        answer: code
          ? { code: 'def f(s):\n    return 0\n' }
          : { selectedOptionIds: [status === 'passed' ? 'C' : 'B'] },
        result: code
          ? {
              publicSummary: { passed: status === 'passed' ? 5 : 3, total: 5 },
              caseResults: [
                { id: 'c1', description: '空字符串', passed: status === 'passed' },
                { id: 'c2', description: '大写字母', passed: status === 'passed' },
                { id: 'c3', description: '普通单词', passed: true },
              ],
            }
          : null,
        score: status === 'passed' ? 1 : status === 'partial' ? 0.5 : 0,
        status,
        createdAt: at - (steps.length - 1 - step) * DAY,
        updatedAt: at,
      });
    });
    const last = steps[steps.length - 1];
    progress.push({
      id: `${id}-progress`,
      problemId: id,
      latestAttemptId: `${id}-a${steps.length - 1}`,
      status: last,
      score: last === 'passed' ? 1 : 0,
      attemptedCount: steps.length,
      passedCount: steps.filter((s) => s === 'passed').length,
      lastAttemptAt: at,
      createdAt: at,
      updatedAt: at,
    });
  }
});

const comparison: BankComparison = {
  group: 'chapters',
  scope: 'store-term',
  peerCount: 37,
  termLabel: '2026 秋季',
  enrollmentCount: 38,
  coverage: { me: 0.45, median: 0.36, lower: 0.2, upper: 0.58 },
  firstTry: { me: 0.41, median: 0.55, lower: 0.38, upper: 0.7 },
  topics: chapters.slice(0, 5).map(([name], index) => ({
    name: name.replace(/^\d+ · /, ''),
    firstTry: {
      me: [0.72, 0.44, 0.9, 0.3, 0.5][index],
      median: [0.6, 0.58, 0.7, 0.51, 0.45][index],
      lower: null,
      upper: null,
    },
  })),
};

const repo = await getLocalRepository();
if (new URLSearchParams(window.location.search).get('fresh') !== '0') {
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
    problemAttempts: attempts,
    problemProgress: progress,
    conversations: [],
    messages: [],
    studyMemories: [],
    assets: [],
    pageAssets: [],
    notebookAssets: [],
    missingAssetPaths: [],
  });
}

function Preview() {
  const [launch, setLaunch] = useState<ProblemBankLaunch | null>(null);
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {launch ? (
        <ProblemPracticePage problems={problems} launch={launch} onBack={() => setLaunch(null)} />
      ) : (
        <ProblemBankPage
          workspace={{ course, problems, notebooks: [], conversations: [], memories: [] }}
          onBack={() => window.location.reload()}
          onPractice={setLaunch}
          previewComparison={comparison}
        />
      )}
    </div>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Preview />);
import.meta.hot?.dispose(() => root.unmount());
