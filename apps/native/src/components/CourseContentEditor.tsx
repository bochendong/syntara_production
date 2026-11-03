import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Eye, Plus, X } from 'lucide-react';
import { updateManagedCourseNote, updateManagedCourseProblem } from '../data/platform-api-client';
import type { NativeNotebookArchive } from '../data/platform-api-contracts';
import type { LocalProblem } from '../domain/models';
import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import { DIFFICULTY_MARBLES, marbleImages } from '../lib/learning-action-marbles';
import { assetResolver, MarkdownBlock } from './LocalResourceViewer';
import { ProblemRichText } from './problem-bank/problem-rich-text';
import { sortedSections } from './CourseContentPreview';

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const list = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => Boolean(item) && typeof item === 'object')
    : [];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** 结构里可选的文字字段不能是空串（服务器要求至少 1 个字），空了就去掉。 */
function prune(value: Json, keys: string[]): Json {
  const next = { ...value };
  for (const key of keys) if (typeof next[key] === 'string' && !next[key].trim()) delete next[key];
  return next;
}
const OPTIONAL_CONTENT = ['explanation', 'functionSignature', 'starterCodeDescription'];
const OPTIONAL_GRADING = [
  'analysis',
  'referenceAnswer',
  'referenceProof',
  'solutionCode',
  'rubric',
];

/** 题目可以放进的分组：课程章节，或者某本笔记（学生题库先按章节、再按笔记分组）。 */
export type ProblemGroupTargets = {
  chapters: Array<{ id: string; name: string }>;
  notebooks: Array<{ id: string; name: string }>;
};
export type ProblemGroup = { chapterId: string | null; notebookId: string | null };

export function groupValue(group: ProblemGroup) {
  return group.chapterId ? `c:${group.chapterId}` : group.notebookId ? `n:${group.notebookId}` : '';
}

/** 选一个分组。选章节时保留原来的笔记；选笔记时清掉章节。 */
export function ProblemGroupPicker({
  value,
  targets,
  onChange,
  className = 'cce-select',
  disabled,
}: {
  value: ProblemGroup;
  targets: ProblemGroupTargets;
  onChange: (next: ProblemGroup) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      className={className}
      aria-label="移动到章节"
      value={groupValue(value)}
      disabled={disabled}
      onChange={(event) => {
        const [kind, id] = [event.target.value.slice(0, 1), event.target.value.slice(2)];
        onChange(
          kind === 'c'
            ? { chapterId: id, notebookId: value.notebookId }
            : kind === 'n'
              ? { chapterId: null, notebookId: id }
              : { chapterId: null, notebookId: null },
        );
      }}
    >
      <option value="">未分组</option>
      {targets.chapters.length ? (
        <optgroup label="章节">
          {targets.chapters.map((chapter) => (
            <option key={chapter.id} value={`c:${chapter.id}`}>
              {chapter.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {targets.notebooks.length ? (
        <optgroup label="笔记">
          {targets.notebooks.map((notebook) => (
            <option key={notebook.id} value={`n:${notebook.id}`}>
              {notebook.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cce-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function useWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setWide(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [query]);
  return wide;
}

/** 文本框 + 预览切换。预览用和只读视图一样的渲染；live 时宽屏左右并排实时预览。 */
function MarkdownField({
  label,
  value,
  onChange,
  rows = 6,
  render,
  live = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  render: (value: string) => ReactNode;
  live?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const wide = useWide();
  if (live && wide)
    return (
      <div className="cce-field">
        <span>{label}</span>
        <div className="cce-live">
          <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
          <div className="cce-preview">
            {value.trim() ? render(value) : <small>还没有内容</small>}
          </div>
        </div>
      </div>
    );
  return (
    <div className="cce-field">
      <span className="cce-field-head">
        {label}
        <button
          type="button"
          className={`cce-preview-toggle${preview ? ' is-on' : ''}`}
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          <Eye size={14} aria-hidden /> 预览
        </button>
      </span>
      {preview ? (
        <div className="cce-preview">
          {value.trim() ? render(value) : <small>还没有内容</small>}
        </div>
      ) : (
        <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

type SaveState = { saving: boolean; savedAt: number | null; error: string };

/** 编辑时的保存状态：⌘S / Ctrl+S 保存，失败可以重试。 */
function useSaveShortcut(save: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, enabled]);
}

function EditorActions({
  dirty,
  state,
  onClose,
  onSave,
}: {
  dirty: boolean;
  state: SaveState;
  onClose: () => void;
  onSave: () => void;
}) {
  const status = state.saving
    ? { tone: 'saving', text: '保存中…' }
    : state.error
      ? { tone: 'error', text: `保存失败：${state.error}` }
      : dirty
        ? { tone: 'dirty', text: '未保存' }
        : state.savedAt
          ? {
              tone: 'saved',
              text: `已保存 ${new Date(state.savedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}`,
            }
          : { tone: 'clean', text: '没有修改' };
  return (
    <div className="cce-actions">
      <span className={`cce-save-state is-${status.tone}`} role="status">
        <i aria-hidden />
        {status.text}
      </span>
      {state.error ? (
        <button type="button" className="ccm-ghost" disabled={state.saving} onClick={onSave}>
          重试
        </button>
      ) : null}
      <button type="button" className="ccm-ghost" disabled={state.saving} onClick={onClose}>
        {dirty ? '放弃修改' : '完成'}
      </button>
      <button
        type="button"
        className="ccm-primary"
        disabled={state.saving || !dirty}
        title="⌘S / Ctrl+S"
        onClick={onSave}
      >
        保存
      </button>
    </div>
  );
}

/** 改笔记：名称 + 每个小节的 Markdown。幻灯片式笔记只能改名。 */
export function NoteEditor({
  courseId,
  notebookId,
  title: initialTitle,
  archive,
  onDirty,
  onClose,
  onSaved,
}: {
  courseId: string;
  notebookId: string;
  title: string;
  archive: NativeNotebookArchive;
  onDirty: (dirty: boolean) => void;
  /** 完成 / 放弃修改（有修改时由外面确认）。 */
  onClose: () => void;
  /** 存好了；编辑框留着，外面刷新列表和预览。 */
  onSaved: () => void;
}) {
  const sections = useMemo(() => sortedSections(archive), [archive]);
  const resolveAsset = useMemo(() => assetResolver(archive.assets), [archive]);
  // 上次保存的内容；和它比有没有修改。
  const [baseline, setBaseline] = useState(() => ({
    title: initialTitle,
    markdown: Object.fromEntries(sections.map((section) => [section.id, section.markdown])),
  }));
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState<Record<string, string>>(baseline.markdown);
  const [state, setState] = useState<SaveState>({ saving: false, savedAt: null, error: '' });
  const changed = sections.filter(
    (section) => markdown[section.id] !== baseline.markdown[section.id],
  );
  const dirty = title.trim() !== baseline.title || changed.length > 0;
  const update = (apply: () => void) => {
    apply();
    onDirty(true);
  };
  const save = async () => {
    if (state.saving || !dirty) return;
    if (!title.trim()) return setState({ ...state, error: '名称不能为空' });
    setState({ ...state, saving: true, error: '' });
    try {
      await updateManagedCourseNote(courseId, notebookId, {
        ...(title.trim() !== baseline.title ? { title: title.trim() } : {}),
        ...(changed.length
          ? {
              sections: changed.map((section) => ({
                id: section.id,
                markdown: markdown[section.id],
              })),
            }
          : {}),
      });
      setBaseline({ title: title.trim(), markdown: { ...markdown } });
      setState({ saving: false, savedAt: Date.now(), error: '' });
      onDirty(false);
      onSaved();
    } catch (cause) {
      setState({
        saving: false,
        savedAt: state.savedAt,
        error: cause instanceof Error ? cause.message : '网络错误',
      });
    }
  };
  useSaveShortcut(() => void save(), true);
  return (
    <div className="cce">
      <Field label="名称">
        <input
          value={title}
          maxLength={200}
          onChange={(event) => update(() => setTitle(event.target.value))}
        />
      </Field>
      {sections.length ? (
        sections.map((section) => (
          <MarkdownField
            key={section.id}
            label={sections.length > 1 ? section.title || '小节' : '内容'}
            rows={22}
            live
            value={markdown[section.id] ?? ''}
            onChange={(value) =>
              update(() => setMarkdown((prev) => ({ ...prev, [section.id]: value })))
            }
            render={(value) => <MarkdownBlock markdown={value} resolveAsset={resolveAsset} />}
          />
        ))
      ) : (
        <p className="ccp-muted">这本笔记是幻灯片，这里只能改名称。</p>
      )}
      <EditorActions dirty={dirty} state={state} onClose={onClose} onSave={() => void save()} />
    </div>
  );
}

/** 一种题型的题面和答案（整题或大题里的一问）。只改认得的字段，其余字段原样保留。 */
function PieceEditor({
  content,
  grading,
  onChange,
}: {
  content: Json;
  grading: Json;
  onChange: (content: Json, grading: Json) => void;
}) {
  const type = str(content.type);
  const setContent = (patch: Json) => onChange({ ...content, ...patch }, grading);
  const setGrading = (patch: Json) => onChange(content, { ...grading, type, ...patch });
  const rich = (value: string) => <ProblemRichText content={value} className="ccp-rich" />;
  const options = list(content.options);
  const correct = Array.isArray(grading.correctOptionIds)
    ? (grading.correctOptionIds as string[])
    : [];
  const multiple = content.selectionMode === 'multiple';
  const nextOptionId = () => {
    const used = new Set(options.map((option) => str(option.id)));
    return 'ABCDEFGHIJKL'.split('').find((id) => !used.has(id)) ?? String(options.length + 1);
  };
  const tests = list(content.publicTests);
  const answerKey = type === 'proof' ? 'referenceProof' : 'referenceAnswer';
  return (
    <>
      <MarkdownField
        label="题干"
        value={str(content.stem)}
        onChange={(stem) => setContent({ stem })}
        render={rich}
      />
      {type === 'choice' ? (
        <div className="cce-field">
          <span className="cce-field-head">
            选项
            <span className="cce-seg">
              {(['single', 'multiple'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={(content.selectionMode ?? 'single') === mode}
                  onClick={() => {
                    setContent({ selectionMode: mode });
                    if (mode === 'single' && correct.length > 1)
                      onChange(
                        { ...content, selectionMode: mode },
                        { ...grading, type, correctOptionIds: correct.slice(0, 1) },
                      );
                  }}
                >
                  {mode === 'single' ? '单选' : '多选'}
                </button>
              ))}
            </span>
          </span>
          <div className="cce-options">
            {options.map((option, index) => {
              const id = str(option.id);
              const isCorrect = correct.includes(id);
              return (
                <div key={index} className={`cce-option${isCorrect ? ' is-correct' : ''}`}>
                  <button
                    type="button"
                    className="cce-option-key"
                    aria-pressed={isCorrect}
                    aria-label={`把 ${id} 设为${isCorrect ? '错误' : '正确'}答案`}
                    onClick={() =>
                      setGrading({
                        correctOptionIds: isCorrect
                          ? correct.filter((item) => item !== id)
                          : multiple
                            ? [...correct, id]
                            : [id],
                      })
                    }
                  >
                    {isCorrect ? <Check size={14} aria-hidden /> : id}
                  </button>
                  <input
                    value={str(option.label)}
                    placeholder={`选项 ${id}`}
                    onChange={(event) =>
                      setContent({
                        options: options.map((item, i) =>
                          i === index ? { ...item, label: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="ccm-remove"
                    aria-label={`删除选项 ${id}`}
                    disabled={options.length <= 2}
                    onClick={() =>
                      onChange(
                        { ...content, options: options.filter((_, i) => i !== index) },
                        {
                          ...grading,
                          type,
                          correctOptionIds: correct.filter((item) => item !== id),
                        },
                      )
                    }
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              );
            })}
            {options.length < 12 ? (
              <button
                type="button"
                className="cce-add"
                onClick={() =>
                  setContent({ options: [...options, { id: nextOptionId(), label: '' }] })
                }
              >
                <Plus size={14} aria-hidden /> 加一个选项
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {type === 'code' ? (
        <>
          <Field label="函数签名">
            <input
              className="is-mono"
              value={str(content.functionSignature)}
              onChange={(event) => setContent({ functionSignature: event.target.value })}
            />
          </Field>
          <Field label="初始代码">
            <textarea
              className="is-mono"
              rows={6}
              value={str(content.starterCode)}
              onChange={(event) => setContent({ starterCode: event.target.value })}
            />
          </Field>
          <div className="cce-field">
            <span>公开测试</span>
            <div className="cce-tests">
              {tests.map((test, index) => (
                <div key={index} className="cce-test">
                  <input
                    className="is-mono"
                    placeholder="表达式"
                    value={str(test.expression)}
                    onChange={(event) =>
                      setContent({
                        publicTests: tests.map((item, i) =>
                          i === index ? { ...item, expression: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <input
                    className="is-mono"
                    placeholder="期望结果"
                    value={str(test.expected)}
                    onChange={(event) =>
                      setContent({
                        publicTests: tests.map((item, i) =>
                          i === index ? { ...item, expected: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="ccm-remove"
                    aria-label="删除这条测试"
                    onClick={() => setContent({ publicTests: tests.filter((_, i) => i !== index) })}
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              ))}
              {tests.length < 24 ? (
                <button
                  type="button"
                  className="cce-add"
                  onClick={() =>
                    setContent({
                      publicTests: [
                        ...tests,
                        { id: `t${Date.now()}`, expression: '', expected: '' },
                      ],
                    })
                  }
                >
                  <Plus size={14} aria-hidden /> 加一条测试
                </button>
              ) : null}
            </div>
          </div>
          <Field label="参考代码">
            <textarea
              className="is-mono"
              rows={6}
              value={str(grading.solutionCode)}
              onChange={(event) => setGrading({ solutionCode: event.target.value })}
            />
          </Field>
        </>
      ) : null}
      {['short_answer', 'calculation', 'proof'].includes(type) ? (
        <MarkdownField
          label="参考答案"
          rows={4}
          value={str(grading[answerKey])}
          onChange={(value) => setGrading({ [answerKey]: value })}
          render={rich}
        />
      ) : null}
      {['fill_blank', 'table'].includes(type) ? (
        <p className="ccp-muted">这种题型的答案请在网页题库里改。</p>
      ) : null}
      <MarkdownField
        label="解析"
        rows={4}
        value={str(grading.analysis)}
        onChange={(analysis) => setGrading({ analysis })}
        render={rich}
      />
    </>
  );
}

function cleanPiece(content: Json, grading: Json) {
  const tests = list(content.publicTests).filter(
    (test) => str(test.expression).trim() && str(test.expected).trim(),
  );
  const nextContent = prune(
    {
      ...content,
      ...(Array.isArray(content.options)
        ? { options: list(content.options).filter((option) => str(option.label).trim()) }
        : {}),
      ...(Array.isArray(content.publicTests) ? { publicTests: tests } : {}),
    },
    OPTIONAL_CONTENT,
  );
  return { content: nextContent, grading: prune(grading, OPTIONAL_GRADING) };
}

/** 改题：名称、状态、难度、章节，加上题面和答案。没有作答区。 */
export function ProblemEditor({
  courseId,
  problem,
  targets,
  onDirty,
  onClose,
  onSaved,
}: {
  courseId: string;
  problem: LocalProblem;
  targets: ProblemGroupTargets;
  onDirty: (dirty: boolean) => void;
  /** 完成 / 放弃修改（有修改时由外面确认）。 */
  onClose: () => void;
  /** 存好了；编辑框留着，外面刷新列表和预览。 */
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    title: problem.title,
    status: problem.status === 'published' ? 'published' : 'draft',
    difficulty: problem.difficulty,
    chapterId: problem.chapterId ?? null,
    notebookId: problem.notebookId ?? null,
    content: clone<Json>(problem.publicContent),
    grading: clone<Json>({ type: problem.type, ...problem.grading }),
  }));
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<SaveState>({ saving: false, savedAt: null, error: '' });
  const edit = (patch: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    onDirty(true);
  };
  const parts = list(draft.content.parts);
  const gradeParts = list(draft.grading.parts);
  const save = async () => {
    if (state.saving || !dirty) return;
    if (!draft.title.trim()) return setState({ ...state, error: '名称不能为空' });
    setState({ ...state, saving: true, error: '' });
    try {
      let content = draft.content;
      let grading = draft.grading;
      if (problem.type === 'multipart') {
        const cleaned = parts.map((part) => {
          const grade = gradeParts.find((item) => item.label === part.label);
          const piece = cleanPiece(
            part.content as Json,
            (grade?.grading as Json) ?? { type: (part.content as Json).type },
          );
          return {
            part: { ...part, content: piece.content },
            grade: { label: part.label, grading: piece.grading },
          };
        });
        content = prune({ ...content, parts: cleaned.map((item) => item.part) }, OPTIONAL_CONTENT);
        grading = prune({ ...grading, parts: cleaned.map((item) => item.grade) }, OPTIONAL_GRADING);
      } else {
        ({ content, grading } = cleanPiece(content, grading));
      }
      await updateManagedCourseProblem(courseId, problem.id, {
        title: draft.title.trim(),
        status: draft.status as 'draft' | 'published',
        difficulty: draft.difficulty,
        chapterId: draft.chapterId,
        notebookId: draft.notebookId,
        publicContent: content,
        grading,
      });
      setDirty(false);
      setState({ saving: false, savedAt: Date.now(), error: '' });
      onDirty(false);
      onSaved();
    } catch (cause) {
      setState({
        saving: false,
        savedAt: state.savedAt,
        error: cause instanceof Error ? cause.message : '网络错误',
      });
    }
  };
  useSaveShortcut(() => void save(), true);
  return (
    <div className="cce">
      <div className="cce-meta">
        <span className="cce-type">{problemTypeLabel(problem.type)}</span>
        <span className="cce-seg" aria-label="学生可见状态">
          {(['draft', 'published'] as const).map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={draft.status === status}
              onClick={() => edit({ status })}
            >
              <img src={status === 'published' ? marbleImages.green : marbleImages.amber} alt="" />
              {status === 'published' ? '待发布' : '草稿'}
            </button>
          ))}
        </span>
        <span className="cce-seg" aria-label="难度">
          {(['easy', 'medium', 'hard'] as const).map((difficulty) => (
            <button
              key={difficulty}
              type="button"
              aria-pressed={draft.difficulty === difficulty}
              onClick={() => edit({ difficulty })}
            >
              <img src={marbleImages[DIFFICULTY_MARBLES[difficulty]]} alt="" />
              {difficultyLabel(difficulty)}
            </button>
          ))}
        </span>
        <ProblemGroupPicker
          value={{ chapterId: draft.chapterId, notebookId: draft.notebookId }}
          targets={targets}
          onChange={(group) => edit(group)}
        />
      </div>
      <Field label="名称">
        <input
          value={draft.title}
          maxLength={200}
          onChange={(event) => edit({ title: event.target.value })}
        />
      </Field>
      {problem.type === 'multipart' ? (
        <>
          <MarkdownField
            label="共同题干"
            value={str(draft.content.stem)}
            onChange={(stem) => edit({ content: { ...draft.content, stem } })}
            render={(value) => <ProblemRichText content={value} className="ccp-rich" />}
          />
          {parts.map((part, index) => {
            const grade = gradeParts.find((item) => item.label === part.label);
            const partContent = part.content as Json;
            return (
              <section key={str(part.label) || index} className="cce-part">
                <h4>小问 ({str(part.label)})</h4>
                <PieceEditor
                  content={partContent}
                  grading={(grade?.grading as Json) ?? { type: partContent.type }}
                  onChange={(content, grading) =>
                    edit({
                      content: {
                        ...draft.content,
                        parts: parts.map((item, i) => (i === index ? { ...item, content } : item)),
                      },
                      grading: {
                        ...draft.grading,
                        parts: [
                          ...gradeParts.filter((item) => item.label !== part.label),
                          { label: part.label, grading },
                        ],
                      },
                    })
                  }
                />
              </section>
            );
          })}
        </>
      ) : (
        <PieceEditor
          content={draft.content}
          grading={draft.grading}
          onChange={(content, grading) => edit({ content, grading })}
        />
      )}
      <EditorActions dirty={dirty} state={state} onClose={onClose} onSave={() => void save()} />
    </div>
  );
}
