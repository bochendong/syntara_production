import mathResult from '@/features/problems/qa/problem-import-test/fixtures/math-api-result.json';
import figuresResult from '@/features/problems/qa/problem-import-test/fixtures/figures-api-result.json';
import Link from 'next/link';
import { ProblemImageAssets, ProblemRichText } from '@/components/problem-bank/problem-rich-text';
import type { NotebookProblemImportDraft } from '@/lib/problem-bank';

export const dynamic = 'force-dynamic';

const samples = {
  math: { title: 'UBC 微积分期中卷', seconds: 121, description: '5 道大题 · 12 个子题' },
  figures: { title: 'MIT 多图力学题集', seconds: 184, description: '5 道大题 · 11 个子题' },
};
const findings: Record<string, Record<string, string>> = {
  math: {
    '2c': '人工复核：1/4 与 LaTeX 分数等价，自动答案不一致属于误报。',
    '4a': '人工复核：最终答案正确，但解析最后的壳法积分少乘了 2。',
  },
  figures: {
    '1': '人工复核：原卷有弹簧圆环图，导入结果丢图。',
    '4c': '人工复核：原题问卫星速度，这里错误重复了 4(b) 的抛射物题。原题答案应为 √(Gmₑ/(2Rₑ))，自动验证未发现。',
    '5a': '人工复核：原题要求学生画图，没有提供图；缺少图表上下文属于误报。',
    '5b': '人工复核：力的公式正确，但解析对负 x 的方向解释有误，力应指向原点。',
  },
};

export default async function ProblemImportResults({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string }>;
}) {
  const params = await searchParams;
  const sample = params.sample === 'figures' ? 'figures' : 'math';
  const info = samples[sample];
  const result = (sample === 'math' ? mathResult : figuresResult) as unknown as {
    data: {
      model: string;
      problems: NotebookProblemImportDraft[];
      quality_report: { passed: number; needsReview: number; figuresAttached: number };
    };
  };
  const { data } = result;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-5 py-10">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">Syntara · 上传题目 API 实测</p>
        <h1 className="text-3xl font-semibold">{info.title}</h1>
        <p className="text-muted-foreground">
          {info.description} · {info.seconds} 秒 · {data.model}
        </p>
        <nav className="flex gap-3">
          {Object.entries(samples).map(([key, value]) => (
            <Link
              key={key}
              href={`/test/problem-import-results?sample=${key}`}
              className={`rounded-lg border px-4 py-2 text-sm ${sample === key ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
              aria-current={sample === key ? 'page' : undefined}
            >
              {value.title}
            </Link>
          ))}
        </nav>
      </header>
      <div className="rounded-xl border bg-muted/40 p-4 text-sm">
        自动通过 {data.quality_report.passed} 题 · 待复核 {data.quality_report.needsReview} 题 ·
        配图挂载 {data.quality_report.figuresAttached}{' '}
        次。以下保留原始生成结果，黄色提示为人工复核。
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="题目导航">
        {data.problems.map((problem, index) => (
          <a key={index} href={`#problem-${index}`} className="rounded border px-3 py-1 text-sm">
            {String(problem.sourceMeta.topLevelLabel ?? index + 1)}
          </a>
        ))}
      </nav>
      {data.problems.map((problem, index) => {
        const label = String(problem.sourceMeta.topLevelLabel ?? index + 1);
        const grading = problem.grading as Record<string, unknown>;
        const review = problem.sourceMeta.importReview as { status?: string } | undefined;
        const answer = String(grading.referenceAnswer ?? grading.referenceProof ?? '');
        return (
          <article
            key={index}
            id={`problem-${index}`}
            className="scroll-mt-8 rounded-xl border bg-card p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold">
                {label} · {problem.title}
              </h2>
              <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs">
                {review?.status === 'passed' ? '自动通过' : '待复核'}
              </span>
            </div>
            {findings[sample][label] ? (
              <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                {findings[sample][label]}
              </p>
            ) : null}
            <ProblemRichText
              content={
                problem.publicContent.type === 'fill_blank'
                  ? problem.publicContent.stemTemplate
                  : problem.publicContent.stem
              }
            />
            <ProblemImageAssets content={problem.publicContent} className="mt-4" />
            {problem.validationErrors.length ? (
              <ul className="mt-4 list-inside list-disc text-sm text-muted-foreground">
                {problem.validationErrors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            ) : null}
            <details className="mt-5 border-t pt-4">
              <summary className="cursor-pointer font-medium">查看答案与解析</summary>
              <div className="mt-4 space-y-4">
                <ProblemRichText content={answer} />
                {typeof grading.analysis === 'string' ? (
                  <ProblemRichText content={grading.analysis} />
                ) : null}
              </div>
            </details>
          </article>
        );
      })}
    </main>
  );
}
