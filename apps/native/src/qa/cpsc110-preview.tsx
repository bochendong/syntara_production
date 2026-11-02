import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProblemPracticePage } from '../components/ProblemPracticePage';
import { getLocalRepository } from '../data/repository';
import { problemCodeDraftKey } from '../data/problem-code-draft';
import type { LocalProblem } from '../domain/models';
import { cleanRacketStarterInstructions } from '../../../../lib/problem-bank/racket-starter-presentation';
import data from './cpsc110-staging-data.json';
import removedInstructionComments from './cpsc110-starter-instruction-comments.json';
import '../tailwind.css';
import '../components/marble-tokens.css';
import '../styles.css';
import '../components/compact-layout.css';

if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) {
  throw new Error('仅限本机预览');
}
const problems = data.problems as LocalProblem[];
// Apply the same requested cleanup to existing preview drafts, preserving other edits.
for (const problem of problems) {
  const key = problemCodeDraftKey('syntara.problem-code-draft.v1', problem.courseId, problem.id);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const draft = JSON.parse(raw);
    if (typeof draft.code !== 'string') continue;
    const metadataCleaned = draft.code
      .replace(/^[\t ]*\(@(?:assignment|problem)\b[^\r\n]*\)[\t ]*(?:;[^\r\n]*)?(?:\r?\n|$)/gm, '')
      .replace(/\n{3,}/g, '\n\n');
    const knownComments =
      (removedInstructionComments as Record<string, string[]>)[problem.id] ?? [];
    const code = cleanRacketStarterInstructions(metadataCleaned, knownComments).code;
    if (code !== draft.code) localStorage.setItem(key, JSON.stringify({ ...draft, code }));
  } catch (error) {
    console.warn('预览代码草稿清理失败', error);
  }
}
const repo = await getLocalRepository();
await repo.importArchive({
  format: 'syntara-native-archive',
  version: 1,
  exportedAt: Date.now(),
  source: { kind: 'postgresql' },
  courses: [
    {
      id: problems[0].courseId,
      name: 'UBC-CPSC110',
      courseCode: 'CPSC110',
      description: '测试服接口只读快照',
      language: 'zh-CN',
      tags: [],
      purpose: 'university',
      university: 'UBC',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
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
  const [chapter, setChapter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const filtered = problems.filter((p) => !chapter || p.chapterId === chapter);
  if (selected)
    return (
      <main style={{ height: '100dvh', padding: 12 }}>
        <ProblemPracticePage
          key={selected}
          problems={filtered}
          launch={{
            problemIds: filtered.map((p) => p.id),
            initialProblemId: selected,
            title: 'CPSC110 · 测试服真实题目',
          }}
          onBack={() => setSelected(null)}
        />
      </main>
    );
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 24px', color: '#202a35' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UBC-CPSC110 题库</h1>
      <p style={{ margin: '12px 0 24px' }}>
        来自测试服课程接口 · {problems.length} 道已发布题目 · 本地独立预览
      </p>
      <label>
        章节{' '}
        <select
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          style={{ padding: 10, border: '1px solid #ccd4dc', borderRadius: 8 }}
        >
          <option value="">全部章节（{problems.length}）</option>
          {data.chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（{problems.filter((p) => p.chapterId === c.id).length}）
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
        {filtered.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            style={{
              textAlign: 'left',
              padding: '16px 20px',
              border: '1px solid #dde2e8',
              borderRadius: 12,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <strong>
              {i + 1}. {p.title}
            </strong>
            <div style={{ fontSize: 13, color: '#657180', marginTop: 5 }}>
              {p.chapterName} · {p.type}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
