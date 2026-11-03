import type { LocalProblem } from '../../domain/models';
import type { NotebookCodeFile } from '../../../../../lib/problem-bank/schema';
import type { NotebookProblemPublicContent } from './types';
import { problemOptions } from '../../data/local-problem-grading';
import { problemSolution } from '../../lib/problem-solution';
import { marbleImages } from '../../lib/learning-action-marbles';
import { fillBlankPrompt } from '../../../../../lib/problem-bank/fill-blank-presentation';
import { CodeProblemStatement } from './code-problem-statement';
import { ProblemImageAssets, ProblemRichText } from './problem-rich-text';

export function asCodeContent(
  content: Record<string, unknown>,
): Extract<NotebookProblemPublicContent, { type: 'code' }> {
  return {
    type: 'code',
    stem: typeof content.stem === 'string' ? content.stem : '',
    language: typeof content.language === 'string' ? content.language : 'python',
    files: Array.isArray(content.files) ? (content.files as NotebookCodeFile[]) : [],
    stdin: typeof content.stdin === 'string' ? content.stdin : undefined,
    starterCode: typeof content.starterCode === 'string' ? content.starterCode : undefined,
    functionSignature:
      typeof content.functionSignature === 'string' ? content.functionSignature : undefined,
    constraints: Array.isArray(content.constraints)
      ? content.constraints.filter((item): item is string => typeof item === 'string')
      : [],
    publicTests: Array.isArray(content.publicTests)
      ? (content.publicTests as Extract<
          NotebookProblemPublicContent,
          { type: 'code' }
        >['publicTests'])
      : [],
    sampleIO: Array.isArray(content.sampleIO)
      ? (content.sampleIO as Extract<NotebookProblemPublicContent, { type: 'code' }>['sampleIO'])
      : [],
    statementSections: Array.isArray(content.statementSections)
      ? (content.statementSections as Extract<
          NotebookProblemPublicContent,
          { type: 'code' }
        >['statementSections'])
      : [],
    starterCodeDescription:
      typeof content.starterCodeDescription === 'string'
        ? content.starterCodeDescription
        : undefined,
    explanation: typeof content.explanation === 'string' ? content.explanation : undefined,
    assets:
      content.assets && typeof content.assets === 'object'
        ? (content.assets as Extract<NotebookProblemPublicContent, { type: 'code' }>['assets'])
        : undefined,
  };
}

/** Shared question presentation; no grading, progress, repository or network side effects. */
export function ProblemStatement({
  content,
  stem,
  locale = 'zh-CN',
}: {
  content: Record<string, unknown>;
  stem?: string;
  locale?: 'zh-CN' | 'en-US';
}) {
  const raw =
    typeof content.stem === 'string' && content.stem.trim()
      ? content.stem
      : typeof content.stemTemplate === 'string'
        ? content.stemTemplate
        : '';
  const prompt =
    stem ??
    (content.type === 'fill_blank'
      ? fillBlankPrompt(
          raw,
          Array.isArray(content.blanks)
            ? content.blanks.map((b) => String((b as { id: string }).id))
            : [],
        )
      : raw);
  return (
    <>
      {content.type === 'code' ? (
        <CodeProblemStatement content={asCodeContent(content)} locale={locale} />
      ) : (
        <ProblemRichText content={prompt} className="text-[15px] leading-7 text-slate-800" />
      )}
      <ProblemImageAssets content={content as NotebookProblemPublicContent} />
    </>
  );
}

/** The same choice rows for answering and read-only management preview. */
export function ProblemChoices({
  problem,
  selectedIds = [],
  onSelect,
}: {
  problem: LocalProblem;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="native-problem-practice-choices" role="group" aria-label="选项">
      {problemOptions(problem).map((option) => {
        const selected = selectedIds.includes(option.id);
        const className = `native-problem-choice${selected ? ' native-problem-choice-selected' : ''}`;
        const content = (
          <>
            <strong>{selected ? <img src={marbleImages.blue} alt="" /> : option.id}</strong>
            <span>
              <ProblemRichText content={option.label} />
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={option.id}
            type="button"
            className={className}
            aria-pressed={selected}
            onClick={() => onSelect(option.id)}
          >
            {content}
          </button>
        ) : (
          <div key={option.id} className={`${className} is-readonly`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** Reference content is rendered separately from option labels, so fenced code stays valid. */
export function ProblemReferenceAnswer({
  problem,
  notice,
}: {
  problem: LocalProblem;
  notice?: string | null;
}) {
  const solution = problemSolution(problem);
  const parts =
    problem.type === 'multipart' && Array.isArray(problem.publicContent.parts)
      ? (problem.publicContent.parts as Array<{ label: string; content: Record<string, unknown> }>)
      : [];
  const grades = Array.isArray(problem.grading.parts)
    ? (problem.grading.parts as Array<{ label: string; grading: Record<string, unknown> }>)
    : [];
  const correct = Array.isArray(problem.grading.correctOptionIds)
    ? problem.grading.correctOptionIds
    : [];
  const choices =
    problem.type === 'choice' ? problemOptions(problem).filter((o) => correct.includes(o.id)) : [];
  return (
    <section className="pp-solution-content" aria-label="参考答案">
      <h3>参考答案</h3>
      {notice ? (
        <p className="pp-solution-notice" role="status">
          {notice}
        </p>
      ) : null}
      {parts.length ? (
        parts.map((part) => (
          <section key={part.label} className="problem-reference-part">
            <h4>小问 ({part.label})</h4>
            <ProblemReferenceAnswer
              problem={{
                ...problem,
                type: String(part.content.type),
                publicContent: part.content,
                grading: grades.find((g) => g.label === part.label)?.grading ?? {},
              }}
            />
          </section>
        ))
      ) : (
        <>
          {choices.length ? (
            <div className="native-problem-practice-choices">
              {choices.map((option) => (
                <div key={option.id} className="native-problem-choice is-readonly">
                  <strong>{option.id}</strong>
                  <span>
                    <ProblemRichText content={option.label} />
                  </span>
                </div>
              ))}
            </div>
          ) : solution.answer ? (
            <ProblemRichText content={solution.answer} />
          ) : null}
          {solution.code ? (
            <pre className="pp-solution-code">
              <code>{solution.code}</code>
            </pre>
          ) : null}
          {solution.explanation ? (
            <>
              <h4>解析</h4>
              <ProblemRichText content={solution.explanation} />
            </>
          ) : null}
          {!solution.answer && !solution.code && !solution.explanation ? (
            <p className="pp-solution-notice">这道题还没有参考答案。</p>
          ) : null}
        </>
      )}
    </section>
  );
}
