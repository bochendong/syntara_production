/** Local CSV fixture; uses the production practice editor and Python runtimes. */
import { createRoot } from 'react-dom/client';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { getLocalRepository } from '../data/repository';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION } from '../data/archive';
import type { LocalProblem } from '../domain/models';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';

if (!import.meta.env.DEV) throw new Error('仅供本机开发预览。');
const now = Date.now();
const csv = 'name,score,attendance\nAlice,80,8\nBob,90,10\nCharlie,70,7\nDiana,100,9\n';
const solutionCode = `import csv


def average_column(filename, column):
    with open(filename, newline='', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        values = [float(row[column]) for row in reader
                  if row[column].strip()]
    return sum(values) / len(values) if values else 0.0


if __name__ == '__main__':
    print(f"score 平均值: {average_column('scores.csv', 'score'):.2f}")
    print(f"attendance 平均值: {average_column('scores.csv', 'attendance'):.2f}")
`;
const courseId = 'csv-input-demo-course';
const problem: LocalProblem = {
  id: 'csv-input-demo-average',
  courseId,
  notebookId: null,
  type: 'code',
  title: 'CSV 文件 · 某列平均值',
  status: 'published',
  difficulty: 'easy',
  tags: [],
  createdAt: now,
  updatedAt: now,
  publicContent: {
    type: 'code',
    language: 'python',
    stem: '读取题目附带的 `scores.csv`，计算指定列的平均值。实现 `average_column(filename, column)`。空文件（只有表头）返回 `0.0`。\n\n这里已经填好一份可运行示例，可以直接点击上方「运行」，再去「测试」运行公开测试。展开文件名可查看 CSV 表格。',
    starterCode: solutionCode,
    functionSignature: 'average_column(filename, column) -> float',
    files: [
      { path: 'scores.csv', content: csv, format: 'csv', role: 'input', visible: true },
      {
        path: 'data/extra.csv',
        content: 'name,score\nEve,10\nFrank,20\nGrace,30\n',
        format: 'csv',
        role: 'input',
        visible: true,
      },
      { path: 'empty.csv', content: 'name,score\n', format: 'csv', role: 'input', visible: true },
    ],
    constraints: ['只使用 Python 标准库 csv。', '文件由题目提供，在隔离运行环境中读取。'],
    publicTests: [
      { id: 'score', expression: "average_column('scores.csv', 'score')", expected: '85.0' },
      {
        id: 'attendance',
        expression: "average_column('scores.csv', 'attendance')",
        expected: '8.5',
      },
      { id: 'nested', expression: "average_column('data/extra.csv', 'score')", expected: '20.0' },
      { id: 'empty', expression: "average_column('empty.csv', 'score')", expected: '0.0' },
    ],
    sampleIO: [],
    secretConfigPresent: false,
  },
  grading: {
    type: 'code',
    solutionCode,
    publishRequirementsMet: false,
    analysis: '使用 DictReader 按列名取值，转为浮点数后计算总和除以行数。',
  },
};
const repo = await getLocalRepository();
await repo.importArchive({
  format: SYNTARA_ARCHIVE_FORMAT,
  version: SYNTARA_ARCHIVE_VERSION,
  exportedAt: now,
  source: { kind: 'postgresql' },
  courses: [
    {
      id: courseId,
      name: 'CSV 文件输入 Demo',
      description: '本机运行样例',
      language: 'zh-CN',
      tags: [],
      purpose: 'university',
      university: null,
      courseCode: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  problems: [problem],
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
const root = createRoot(document.getElementById('root')!);
root.render(
  <main style={{ height: '100dvh', padding: 12 }}>
    <ProblemPracticePage
      problems={[problem]}
      launch={{
        problemIds: [problem.id],
        initialProblemId: problem.id,
        title: 'CSV 文件输入 · 本机 Demo',
      }}
      onBack={() => {
        window.location.href = '/submission-feedback-preview.html';
      }}
      loadHiddenTests={async () => ({ cases: [], hasScript: false })}
    />
  </main>,
);
import.meta.hot?.dispose(() => root.unmount());
