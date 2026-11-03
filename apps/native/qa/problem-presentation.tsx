/** Loopback-only presentation fixture; no account or network mutations. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProblemPreview } from '../src/components/CourseContentPreview';
import { ProblemChoices } from '../src/components/problem-bank/problem-presentation';
import { buildAdditionalPreviewProblems } from '../src/qa/problem-preview-fixtures';
import type { LocalProblem } from '../src/domain/models';
import '../src/tailwind.css';
import '../src/components/marble-tokens.css';
import '../src/styles.css';
import '../src/components/course-content-manager.css';
if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname))
  throw new Error('Local QA only');
const common = {
  courseId: 'presentation-qa',
  notebookId: null,
  status: 'published' as const,
  difficulty: 'medium' as const,
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const choice: LocalProblem = {
  ...common,
  id: 'fenced-choice',
  title: 'Numeric result types',
  type: 'choice',
  publicContent: {
    type: 'choice',
    stem: 'What is the type of `value` immediately after this assignment?\n\n```python\nvalue = 7 // 2 + 0.0\n```',
    options: [
      { id: 'a', text: '```python\nint\n```' },
      { id: 'b', text: '```python\nfloat\n```' },
      { id: 'c', text: '```python\nbool\n```' },
    ],
  },
  grading: {
    type: 'choice',
    correctOptionIds: ['b'],
    analysis: 'Integer division gives an int; adding 0.0 produces a float.',
  },
};
const problems = [choice, ...buildAdditionalPreviewProblems(common, 'presentation-qa')];
function Preview() {
  const [selected, setSelected] = useState(choice);
  const [answer, setAnswer] = useState<string[]>([]);
  return (
    <main style={{ padding: 24, maxWidth: 1300, margin: 'auto' }}>
      <h1>题库组件复用验收</h1>
      <label>
        题型{' '}
        <select
          value={selected.id}
          onChange={(e) => setSelected(problems.find((p) => p.id === e.target.value)!)}
        >
          {problems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <div
        className="ccm-split is-detail"
        style={{ height: 'auto', gridTemplateColumns: 'minmax(0,1fr)', marginTop: 20 }}
      >
        <section className="ccm-detail">
          <header className="ccm-detail-head">
            <h2>{selected.title}</h2>
          </header>
          <div className="ccm-detail-body">
            <ProblemPreview key={selected.id} problem={selected} />
          </div>
        </section>
      </div>
      <details>
        <summary>做题选项交互检查</summary>
        <ProblemChoices problem={choice} selectedIds={answer} onSelect={(id) => setAnswer([id])} />
        <output aria-label="已选择">{answer.join(',')}</output>
      </details>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
