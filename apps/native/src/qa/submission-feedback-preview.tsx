/** Local-only demo: isolated fixtures, real practice UI and offline grading. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { NativeToast } from '../components/NativeToast';
import { submissionFeedback } from '../lib/submission-feedback';
import { getLocalRepository } from '../data/repository';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION } from '../data/archive';
import { buildAdditionalPreviewProblems } from './problem-preview-fixtures';
import type { LocalProblem } from '../domain/models';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';
import './submission-feedback-preview.css';

if (!import.meta.env.DEV) throw new Error('仅供本机开发预览。');
const now = Date.now();
const common = {
  courseId: 'submission-feedback-demo-course',
  notebookId: null,
  status: 'published' as const,
  difficulty: 'easy' as const,
  tags: [],
  createdAt: now,
  updatedAt: now,
};
const choice = {
  type: 'choice',
  selectionMode: 'single',
  stem: '计算 $2+2$ 的结果。',
  options: [
    { id: 'A', label: '$3$' },
    { id: 'B', label: '$4$' },
    { id: 'C', label: '$5$' },
  ],
};
const choiceGrading = { type: 'choice', correctOptionIds: ['B'], analysis: '$2+2=4$。' };
const problems: LocalProblem[] = [
  {
    ...common,
    id: 'submission-feedback-demo-choice',
    type: 'choice',
    title: '选择题 · 提交反馈',
    publicContent: choice,
    grading: choiceGrading,
  },
  ...buildAdditionalPreviewProblems(common, 'submission-feedback-demo').filter(
    (problem) => problem.id === 'submission-feedback-demo-fill-inline',
  ),
  {
    ...common,
    id: 'submission-feedback-demo-parts',
    type: 'multipart',
    title: '分小问 · 仅反馈当前提交',
    publicContent: {
      type: 'multipart',
      stem: '分别完成下面两问。每问单独提交。',
      parts: ['i', 'ii'].map((label) => ({
        label,
        type: 'choice',
        points: 5,
        prompt: label === 'i' ? '计算 $2+2$。' : '再计算一次 $2+2$。',
        content: choice,
      })),
    },
    grading: {
      type: 'multipart',
      parts: ['i', 'ii'].map((label) => ({ label, grading: choiceGrading })),
    },
  },
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
      name: '提交反馈本地 Demo',
      description: '仅本机样例，不写入测试服',
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
  const [initial, setInitial] = useState(0);
  const [revision, setRevision] = useState(0);
  const [pendingPreview, setPendingPreview] = useState(false);
  return (
    <main className="feedback-demo">
      <nav className="feedback-demo-controls" aria-label="Demo 场景">
        <strong>提交反馈 Demo</strong>
        {['选择题', '填空题', '分小问'].map((name, index) => (
          <button
            key={name}
            type="button"
            aria-pressed={initial === index}
            onClick={() => {
              setInitial(index);
              setRevision((value) => value + 1);
              setPendingPreview(false);
            }}
          >
            {name}
          </button>
        ))}
        <button type="button" onClick={() => setPendingPreview((value) => !value)}>
          预览批改未完成
        </button>
        <span>选 4 答对，选 3 / 5 答错；填空答案 9、2x、4，可只填对部分。不会自动跳题。</span>
      </nav>
      <ProblemPracticePage
        key={revision}
        problems={problems}
        launch={{
          problemIds: problems.map((problem) => problem.id),
          initialProblemId: problems[initial].id,
          title: '提交反馈 · 本机样例',
        }}
        onBack={() => window.location.reload()}
      />
      {pendingPreview ? (
        <NativeToast
          {...submissionFeedback([{ status: 'pending', score: null }])}
          className="pp-submission-notice"
          onDismiss={() => setPendingPreview(false)}
        />
      ) : null}
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<Preview />);
import.meta.hot?.dispose(() => root.unmount());
