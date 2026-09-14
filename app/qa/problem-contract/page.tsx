'use client';

import { StrictMode, useState } from 'react';
import { InteractiveFillBlank } from '@/components/problem-bank/interactive-fill-blank';
import type { NotebookProblemPublicFillBlank } from '@/lib/problem-bank';

const fixtures = [
  {
    title: '表格内作答',
    stemTemplate:
      '| Expression | Value |\n| --- | --- |\n| `len("abc")` | {{a}} |\n| `False or True` | {{b}} |',
    blanks: [
      { id: 'a', answerKind: 'text' },
      { id: 'b', answerKind: 'text' },
    ],
  },
  {
    title: '代码内多空',
    stemTemplate:
      '保持代码上下文，填写两个参数。\n\n```python\ndef summarize(items):\n    return combine({{a}}, {{b}})\n```',
    blanks: [
      { id: 'a', answerKind: 'code_token' },
      { id: 'b', answerKind: 'code_token' },
    ],
  },
  {
    title: '代码条件与缩进',
    stemTemplate: '补全条件，保留下面的缩进。\n\n```python\nif {{a}}:\n    print("Valid")\n```',
    blanks: [{ id: 'a', answerKind: 'code_token' }],
  },
] as const;

export default function ProblemContractPreview() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [renamed, setRenamed] = useState(false);
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">题面交互验证</h1>
      <button className="rounded border p-2" onClick={() => setVersion((value) => value + 1)}>
        切换题面版本
      </button>
      <button className="rounded border p-2" onClick={() => setRenamed((value) => !value)}>
        切换空格编号
      </button>
      <StrictMode>
        {fixtures.map((fixture, index) => (
          <section
            key={fixture.title}
            data-testid={`fixture-${index}`}
            className="rounded-xl border bg-white p-6 dark:bg-slate-900"
          >
            <h2 className="mb-4 font-semibold">{fixture.title}</h2>
            <InteractiveFillBlank
              content={
                {
                  type: 'fill_blank',
                  stemTemplate:
                    fixture.stemTemplate.replace(
                      /\{\{([^{}]+)\}\}/g,
                      (_, id) => `{{${renamed ? 'new-' : ''}${id}}}`,
                    ) + (version ? `\n\n版本 ${version}` : ''),
                  blanks: fixture.blanks.map((blank) => ({
                    ...blank,
                    id: `${renamed ? 'new-' : ''}${blank.id}`,
                  })),
                } as unknown as NotebookProblemPublicFillBlank
              }
              values={Object.fromEntries(
                fixture.blanks.map((blank) => [
                  `${renamed ? 'new-' : ''}${blank.id}`,
                  values[`${index}-${blank.id}`] || '',
                ]),
              )}
              disabled={false}
              locale="zh-CN"
              onFocusBlank={() => {}}
              onChangeBlank={(id, value) =>
                setValues((previous) => ({
                  ...previous,
                  [`${index}-${id.replace(/^new-/, '')}`]: value,
                }))
              }
            />
          </section>
        ))}
      </StrictMode>
      <output data-testid="answers">{JSON.stringify(values)}</output>
    </main>
  );
}
