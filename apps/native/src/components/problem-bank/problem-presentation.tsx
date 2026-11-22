import type { LocalProblem } from '../../domain/models';
import type {
  NotebookCodeFile,
  NotebookProblemGradingFillBlank,
} from '../../../../../lib/problem-bank/schema';
import type { NotebookProblemPublicContent } from './types';
import { problemOptions } from '../../data/local-problem-grading';
import { problemSolution } from '../../lib/problem-solution';
import { marbleImages } from '../../lib/learning-action-marbles';
import { fillBlankPrompt } from '../../../../../lib/problem-bank/fill-blank-presentation';
import {
  memoryDiagramBlankIds,
  memoryDiagramQuestionView,
  readProblemMemoryDiagram,
} from '../../../../../lib/problem-bank/memory-diagram';
import { CodeProblemStatement } from './code-problem-statement';
import { ProblemImageAssets, ProblemRichText } from './problem-rich-text';
import { ProblemMemoryIllustration, ProblemMemoryModel } from './problem-memory-diagram';
import type { ProblemContentLanguage } from '../../lib/problem-language';

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
  content: storedContent,
  stem,
  locale = 'zh-CN',
  showEditableDiagram = false,
}: {
  content: Record<string, unknown>;
  stem?: string;
  locale?: 'zh-CN' | 'en-US';
  showEditableDiagram?: boolean;
}) {
  const { content, prompt: diagramPrompt } = memoryDiagramQuestionView(storedContent, locale);
  const raw =
    diagramPrompt ??
    (typeof content.stem === 'string' && content.stem.trim()
      ? content.stem
      : typeof content.stemTemplate === 'string'
        ? content.stemTemplate
        : '');
  const prompt =
    (diagramPrompt === undefined ? stem : undefined) ??
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
      <ProblemMemoryIllustration
        content={content}
        locale={locale}
        showEditable={showEditableDiagram}
      />
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

function memoryModelReference(problem: LocalProblem) {
  const model = readProblemMemoryDiagram(problem.publicContent);
  if (!model?.editable) return null;
  const grading = problem.grading as Partial<NotebookProblemGradingFillBlank>;
  const blanks = Array.isArray(grading.blanks) ? grading.blanks : [];
  const values =
    grading.answerVariants?.[0] ??
    Object.fromEntries(blanks.map(({ id, acceptedAnswers }) => [id, acceptedAnswers?.[0]]));
  if (
    !memoryDiagramBlankIds(model.diagram).every(
      (id) => typeof values[id] === 'string' && values[id].trim(),
    )
  ) {
    return null;
  }
  return { diagram: model.diagram, values };
}

/** Reference content is rendered separately from option labels, so fenced code stays valid. */
export function ProblemReferenceAnswer({
  problem,
  notice,
  locale = 'zh-CN',
}: {
  problem: LocalProblem;
  notice?: string | null;
  locale?: ProblemContentLanguage;
}) {
  const solution = problemSolution(problem);
  const memoryReference = memoryModelReference(problem);
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
              locale={locale}
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
          ) : memoryReference ? (
            <ProblemMemoryModel
              diagram={memoryReference.diagram}
              locale={locale}
              referenceValues={memoryReference.values}
            />
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
