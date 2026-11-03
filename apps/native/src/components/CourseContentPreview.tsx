import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { getNativeNotebook } from '../data/platform-api-client';
import type { NativeNotebookArchive } from '../data/platform-api-contracts';
import type { LocalProblem } from '../domain/models';
import { difficultyLabel, problemOptions, problemTypeLabel } from '../data/local-problem-grading';
import { problemSolution } from '../lib/problem-solution';
import { DIFFICULTY_MARBLES, marbleImages } from '../lib/learning-action-marbles';
import { assetResolver, MarkdownBlock } from './LocalResourceViewer';
import { ProblemImageAssets, ProblemRichText } from './problem-bank/problem-rich-text';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const records = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
      )
    : [];
const fence = (code: string, language = 'python') => '```' + language + '\n' + code + '\n```';

/** 读一本笔记的完整内容；revision 变了重读（保存之后）。 */
export function useNotebookArchive(notebookId: string, revision = 0, managedCourseId?: string) {
  const [state, setState] = useState<{
    key: string;
    archive?: NativeNotebookArchive;
    error?: string;
  } | null>(null);
  const key = `${notebookId}:${revision}`;
  useEffect(() => {
    if (!notebookId) return;
    let active = true;
    getNativeNotebook(notebookId, managedCourseId)
      .then((archive) => active && setState({ key, archive }))
      .catch(
        (cause) =>
          active && setState({ key, error: cause instanceof Error ? cause.message : '读取失败' }),
      );
    return () => {
      active = false;
    };
  }, [notebookId, key, managedCourseId]);
  return state?.key === key ? state : null;
}

export function sortedSections(archive: NativeNotebookArchive) {
  return [...archive.markdownSections].sort((a, b) => a.order - b.order);
}

/** 课程管理里笔记的只读预览：按小节显示 Markdown，幻灯片式笔记列出每页标题。 */
export function NotePreview({ archive }: { archive: NativeNotebookArchive }) {
  const resolveAsset = useMemo(() => assetResolver(archive.assets), [archive]);
  const sections = sortedSections(archive);
  const pages = [...archive.notebookPages].sort((a, b) => a.order - b.order);
  if (!sections.length && !pages.length) return <p className="ccp-muted">这本笔记还没有内容。</p>;
  return (
    <div className="ccp-note">
      {sections.map((section) => (
        <section key={section.id} className="ccp-note-section">
          {sections.length > 1 && section.title ? <h3>{section.title}</h3> : null}
          <MarkdownBlock markdown={section.markdown} resolveAsset={resolveAsset} />
        </section>
      ))}
      {!sections.length ? (
        <ol className="ccp-pages">
          {pages.map((page) => (
            <li key={page.id}>{page.title || '未命名页面'}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ProblemBody({ problem }: { problem: LocalProblem }) {
  const content = problem.publicContent;
  const correct = Array.isArray(problem.grading.correctOptionIds)
    ? (problem.grading.correctOptionIds as unknown[])
    : [];
  const options = problemOptions(problem);
  const signature = text(content.functionSignature);
  const constraints = Array.isArray(content.constraints)
    ? content.constraints.map(text).filter(Boolean)
    : [];
  const tests = [...records(content.sampleIO), ...records(content.publicTests)];
  const starter = text(content.starterCode);
  return (
    <>
      <ProblemRichText content={text(content.stem)} className="ccp-rich" />
      <ProblemImageAssets content={content as { assets?: { images?: [] } }} />
      {signature ? <ProblemRichText content={fence(signature)} className="ccp-rich" /> : null}
      {options.length ? (
        <ol className="ccp-options">
          {options.map((option) => (
            <li key={option.id} className={correct.includes(option.id) ? 'is-correct' : ''}>
              <span>{option.id}</span>
              <ProblemRichText content={option.label} className="ccp-rich" />
              {correct.includes(option.id) ? (
                <CheckCircle2 size={16} aria-label="正确答案" />
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {constraints.length ? (
        <ul className="ccp-constraints">
          {constraints.map((constraint) => (
            <li key={constraint}>{constraint}</li>
          ))}
        </ul>
      ) : null}
      {tests.length ? (
        <div className="ccp-block">
          <h4>示例与公开测试</h4>
          {tests.map((test, index) => {
            const input = text(test.input) || text(test.expression);
            const output = text(test.output) || text(test.expected) || text(test.expectedOutput);
            return (
              <div key={index} className="ccp-test">
                {input ? <pre>{input}</pre> : null}
                {output ? <pre className="is-output">{output}</pre> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {starter ? (
        <div className="ccp-block">
          <h4>初始代码</h4>
          <ProblemRichText content={fence(starter, text(content.language) || 'python')} />
        </div>
      ) : null}
    </>
  );
}

/** 课程管理里题目的只读预览：题干、选项、小问、答案和解析。没有作答区。 */
export function ProblemPreview({ problem }: { problem: LocalProblem }) {
  const solution = problemSolution(problem);
  const parts =
    problem.type === 'multipart'
      ? (records(problem.publicContent.parts) as Array<{
          label: string;
          content: Record<string, unknown>;
        }>)
      : [];
  const gradeParts = records(problem.grading.parts);
  return (
    <div className="ccp-problem">
      <div className="ccp-meta">
        <span>{problemTypeLabel(problem.type)}</span>
        <span>
          <img src={marbleImages[DIFFICULTY_MARBLES[problem.difficulty] ?? 'blue']} alt="" />
          {difficultyLabel(problem.difficulty)}
        </span>
        {problem.chapterName ? <span>{problem.chapterName}</span> : null}
      </div>
      <article className="ccp-card">
        {parts.length ? (
          <>
            <ProblemRichText content={text(problem.publicContent.stem)} className="ccp-rich" />
            {parts.map((part) => (
              <section key={part.label} className="ccp-part">
                <h4>小问 ({part.label})</h4>
                <ProblemBody
                  problem={{
                    ...problem,
                    type: String(part.content.type),
                    publicContent: part.content,
                    grading:
                      (gradeParts.find((grade) => grade.label === part.label)?.grading as Record<
                        string,
                        unknown
                      >) ?? {},
                  }}
                />
              </section>
            ))}
          </>
        ) : (
          <ProblemBody problem={problem} />
        )}
      </article>
      {solution.answer || solution.code || solution.explanation ? (
        <article className="ccp-card ccp-solution">
          <h4>答案与解析</h4>
          {solution.answer ? (
            <ProblemRichText content={solution.answer} className="ccp-rich" />
          ) : null}
          {solution.code ? <ProblemRichText content={fence(solution.code)} /> : null}
          {solution.explanation ? (
            <ProblemRichText content={solution.explanation} className="ccp-rich" />
          ) : null}
        </article>
      ) : (
        <p className="ccp-muted">这道题还没有参考答案。</p>
      )}
    </div>
  );
}
