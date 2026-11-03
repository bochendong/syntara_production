import { useEffect, useId, useMemo, useState } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import { getNativeNotebook } from '../data/platform-api-client';
import type { NativeNotebookArchive } from '../data/platform-api-contracts';
import type { LocalProblem } from '../domain/models';
import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import { DIFFICULTY_MARBLES, marbleImages } from '../lib/learning-action-marbles';
import { assetResolver, MarkdownBlock } from './LocalResourceViewer';
import { ProblemRichText } from './problem-bank/problem-rich-text';
import {
  ProblemStatement,
  ProblemChoices,
  ProblemReferenceAnswer,
} from './problem-bank/problem-presentation';
import './course-pages.css';

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

/** Management uses the same question and reference components as the practice page. */
export function ProblemPreview({ problem }: { problem: LocalProblem }) {
  const [tab, setTab] = useState<'description' | 'solution'>('description');
  const id = useId();
  return (
    <div className="ccm-problem-preview">
      <div className="ccm-problem-toolbar">
        <div className="pp-tabs" role="tablist" aria-label="题目预览">
          {(['description', 'solution'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`pp-tab${tab === value ? ' is-active' : ''}`}
              role="tab"
              id={`${id}-${value}`}
              aria-selected={tab === value}
              tabIndex={tab === value ? 0 : -1}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'description'
                    : event.key === 'End'
                      ? 'solution'
                      : tab === 'description'
                        ? 'solution'
                        : 'description';
                setTab(next);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                buttons?.[next === 'description' ? 0 : 1].focus();
              }}
            >
              {value === 'description' ? <FileText size={14} /> : <BookOpen size={14} />}
              {value === 'description' ? '题目' : '参考答案'}
            </button>
          ))}
        </div>
        <span className="ccm-problem-type">{problemTypeLabel(problem.type)}</span>
        <span className="ccm-problem-difficulty">
          <img src={marbleImages[DIFFICULTY_MARBLES[problem.difficulty] ?? 'blue']} alt="" />
          {difficultyLabel(problem.difficulty)}
        </span>
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        tabIndex={0}
        className="ccm-problem-content"
      >
        {tab === 'solution' ? (
          <ProblemReferenceAnswer problem={problem} />
        ) : (
          <ManagedProblemStatement problem={problem} />
        )}
      </div>
    </div>
  );
}

function ManagedProblemStatement({ problem }: { problem: LocalProblem }) {
  const content = problem.publicContent;
  const parts = problem.type === 'multipart' ? records(content.parts) : [];
  const rows = records(content.rows);
  const columns = records(content.columns);
  return (
    <div className="ccm-problem-statement">
      <ProblemStatement content={{ ...content, type: problem.type }} />
      {problem.type === 'choice' ? <ProblemChoices problem={problem} /> : null}
      {parts.map((part) => (
        <section key={String(part.label)} className="ccm-problem-part">
          <h3>小问 ({String(part.label)})</h3>
          <ManagedProblemStatement
            problem={{
              ...problem,
              type: String((part.content as Record<string, unknown>).type),
              publicContent: part.content as Record<string, unknown>,
            }}
          />
        </section>
      ))}
      {problem.type === 'table' && rows.length && columns.length ? (
        <div className="ccm-problem-table">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={String(column.id)}>{text(column.label) || text(column.id)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  {columns.map((column) => (
                    <td key={String(column.id)}>
                      <ProblemRichText
                        content={
                          text(
                            (row.cells as Record<string, unknown> | undefined)?.[String(column.id)],
                          ) || '—'
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {typeof content.starterCode === 'string' && content.starterCode.trim() ? (
        <section className="ccm-problem-part">
          <h3>初始代码</h3>
          <ProblemRichText
            content={fence(content.starterCode, text(content.language) || 'python')}
          />
        </section>
      ) : null}
    </div>
  );
}
