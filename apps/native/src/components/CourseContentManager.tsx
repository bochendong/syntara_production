import { useState, useEffect, useLayoutEffect, useRef, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  addManagedCourseContent,
  deleteManagedCourseContent,
  undoManagedCourseContent,
  getManagedCourseContent,
  getManagedProblemGroups,
  getNativeProblems,
  updateManagedCourseProblem,
  type ManagedContentKind,
  type ManagedContentPage,
  type ManagedProblemGroups,
} from '../data/platform-api-client';
import type { LocalProblem } from '../domain/models';
import { marbleImages } from '../lib/learning-action-marbles';
import { NotePreview, ProblemPreview, useNotebookArchive } from './CourseContentPreview';
import {
  NoteEditor,
  ProblemEditor,
  ProblemGroupPicker,
  type ProblemGroup,
  type ProblemGroupTargets,
} from './CourseContentEditor';
import { CourseModal } from './CourseModal';
import { GlassSkeletonRows } from './GlassLoadMore';
import './course-content-manager.css';

type Item = ManagedContentPage['items'][number];
type GroupState = { rev: number; items: Item[]; total: number; page: number; loading: boolean };

const statusMarble = (status: string | null) =>
  status ? (status === 'published' ? marbleImages.green : marbleImages.amber) : marbleImages.blue;
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

/**
 * 课程笔记和题库的管理：左边是列表（搜索、新增；题库按章节分组），右边是选中条目的预览或编辑。
 * 窄屏只显示一栏，点条目推入详情。上传在课程管理页头部的单独入口里。
 */
export function CourseContentManager({
  courseId,
  kind,
  revision: outerRevision = 0,
  onChanged,
  onDirtyChange,
}: {
  courseId: string;
  kind: ManagedContentKind;
  /** 外面（比如上传）改了内容时加一，这里重新读。 */
  revision?: number;
  onChanged?: () => Promise<void> | void;
  /** 正在编辑且有没保存的修改；外面切标签或返回前要确认。 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [localRevision, setRevision] = useState(0);
  const revision = localRevision + outerRevision;
  const [data, setData] = useState<ManagedContentPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<{ id: string; title: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [problems, setProblems] = useState<Map<string, LocalProblem> | 'error' | null>(null);
  const [groups, setGroups] = useState<ManagedProblemGroups | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [groupItems, setGroupItems] = useState<Record<string, GroupState>>({});
  const [editing, setEditing] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [moving, setMoving] = useState(false);
  const setDirty = (value: boolean) => {
    setDirtyState(value);
    onDirtyChange?.(value);
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  /** 有没保存的修改时先确认，再离开编辑。 */
  const leaveEditing = () => {
    if (editing && dirty && !window.confirm('有没保存的修改，确定放弃吗？')) return false;
    setEditing(false);
    setDirty(false);
    return true;
  };
  // 左右两栏铺满到窗口底部，各自滚动。
  const splitRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const split = splitRef.current;
    if (!split) return;
    const fit = () => {
      const top = split.getBoundingClientRect().top + window.scrollY;
      split.style.setProperty('--ccm-fill', `${Math.max(420, window.innerHeight - top - 16)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // 题库：不搜索时按章节分组浏览；搜索时跨全部题目、按页列出。
  const browsing = kind === 'problems' && !query.trim();
  useEffect(() => {
    if (kind !== 'problems') return;
    let active = true;
    getNativeProblems(courseId, undefined, true)
      .then((snapshot) => {
        if (active) setProblems(new Map(snapshot.problems.map((problem) => [problem.id, problem])));
      })
      .catch(() => active && setProblems('error'));
    getManagedProblemGroups(courseId)
      .then((result) => {
        if (!active) return;
        setGroups(result);
        // 第一次打开时展开第一个有题的分组。
        setOpen((current) => {
          if (Object.keys(current).length) return current;
          const first = [...result.chapters, ...result.notebooks].find((group) => group.count);
          return first ? { [first.key]: true } : result.ungrouped ? { none: true } : current;
        });
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : '读取失败'));
    return () => {
      active = false;
    };
  }, [courseId, kind, revision]);
  const loadGroup = (key: string, nextPage = 1) => {
    setGroupItems((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { items: [], total: 0, page: 0 }),
        rev: revision,
        loading: true,
      },
    }));
    getManagedCourseContent(courseId, 'problems', nextPage, '', key)
      .then((result) =>
        setGroupItems((current) => ({
          ...current,
          [key]: {
            rev: revision,
            items:
              nextPage === 1 ? result.items : [...(current[key]?.items ?? []), ...result.items],
            total: result.total,
            page: nextPage,
            loading: false,
          },
        })),
      )
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : '读取失败');
        setGroupItems((current) => ({
          ...current,
          [key]: { ...current[key], loading: false },
        }));
      });
  };
  useEffect(() => {
    if (!browsing) return;
    for (const key of Object.keys(open))
      if (open[key] && (!groupItems[key] || groupItems[key].rev !== revision)) loadGroup(key);
    // loadGroup 每次渲染都是新函数；只在展开的分组或版本变化时读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing, open, revision]);

  // 笔记，以及题库里的搜索结果。
  useEffect(() => {
    if (browsing) return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        getManagedCourseContent(courseId, kind, page, query)
          .then((result) => {
            if (active) {
              setData(result);
              setError('');
            }
          })
          .catch((cause) => {
            if (active) {
              setData(null);
              setError(cause instanceof Error ? cause.message : '读取失败');
            }
          });
      },
      query ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [browsing, courseId, kind, page, query, revision]);

  const refresh = () => {
    setRevision((value) => value + 1);
    void Promise.resolve(onChanged?.()).catch(() => {});
  };
  const deleteItem = async () => {
    if (!remove || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteManagedCourseContent(courseId, kind, remove.id);
      setRemove(null);
      setSelectedId(null);
      setShowDetail(false);
      setEditing(false);
      setDirty(false);
      if (page > 1 && data?.items.length === 1) setPage(page - 1);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const noun = kind === 'notes' ? '笔记' : '题目';
  const groupList = groups
    ? [
        ...groups.chapters,
        ...groups.notebooks.filter((group) => group.count),
        ...(groups.ungrouped
          ? [{ key: 'none', id: '', name: '未分组', count: groups.ungrouped }]
          : []),
      ]
    : [];
  const items: Item[] = browsing
    ? groupList.flatMap((group) => (open[group.key] ? (groupItems[group.key]?.items ?? []) : []))
    : (data?.items ?? []);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const problemMap = problems && problems !== 'error' ? problems : null;
  const selectedProblem = selected && problemMap ? problemMap.get(selected.id) : undefined;
  const archive = useNotebookArchive(
    kind === 'notes' && selected ? selected.id : '',
    revision,
    courseId,
  );
  const targets: ProblemGroupTargets = {
    chapters: groups?.chapters ?? [],
    notebooks: groups?.notebooks ?? [],
  };
  const moveProblem = async (problem: LocalProblem, group: ProblemGroup) => {
    setMoving(true);
    setError('');
    try {
      await updateManagedCourseProblem(courseId, problem.id, group);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移动失败');
    } finally {
      setMoving(false);
    }
  };
  const loadingList = browsing ? !groups : !data && !error;
  const empty = browsing
    ? Boolean(groups) && !groupList.some((group) => group.count)
    : Boolean(data) && !data?.items.length;

  const row = (item: Item) => (
    <button
      type="button"
      className="ccm-row"
      key={item.id}
      aria-current={selected?.id === item.id ? 'true' : undefined}
      onClick={() => {
        if (item.id !== selected?.id && !leaveEditing()) return;
        setSelectedId(item.id);
        setShowDetail(true);
      }}
    >
      <img className="ccm-row-marble" src={statusMarble(item.status)} alt="" />
      <span className="ccm-row-copy">
        <strong>{item.title}</strong>
        <small>
          {item.status
            ? (item.status === 'published' ? (item.pending ? '待发布' : '已发布') : '草稿') + ' · '
            : ''}
          {item.pending
            ? item.pending === 'delete'
              ? '待删除 · '
              : item.pending === 'add'
                ? '待发布新增 · '
                : '有未发布修改 · '
            : ''}
          {shortDate(item.updatedAt)}
        </small>
      </span>
      <ChevronRight className="ccm-row-chevron" size={15} aria-hidden />
    </button>
  );

  return (
    <div className="ccm">
      <div ref={splitRef} className={`ccm-split${showDetail ? ' is-detail' : ''}`}>
        <aside className="ccm-side" aria-label={`${noun}列表`}>
          <div className="ccm-side-top">
            <label className="phone-search ccm-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                aria-label={`搜索${noun}`}
                placeholder={kind === 'problems' ? '搜索全部题目' : '搜索笔记'}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <button
              className="ccm-primary ccm-add"
              type="button"
              aria-label={`新增${noun}`}
              title={`新增${noun}`}
              onClick={() => {
                setError('');
                setAdding(true);
              }}
            >
              <Plus size={18} aria-hidden />
            </button>
          </div>
          {error && !remove ? (
            <p className="phone-page-error" role="alert">
              {error}
            </p>
          ) : null}
          {loadingList ? <GlassSkeletonRows rows={6} height={48} /> : null}
          {!browsing && data && !data.items.length && query ? (
            <p className="ccm-side-empty">没有匹配的{noun}</p>
          ) : null}
          {browsing && groups ? (
            <div className="ccm-list">
              {groupList.map((group) => {
                const state = groupItems[group.key];
                const isOpen = Boolean(open[group.key]);
                return (
                  <div key={group.key} className={`ccm-chapter${isOpen ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="ccm-chapter-head"
                      aria-expanded={isOpen}
                      onClick={() => setOpen((current) => ({ ...current, [group.key]: !isOpen }))}
                    >
                      <ChevronDown size={15} aria-hidden />
                      <strong>{group.name}</strong>
                      <span>{group.count}</span>
                    </button>
                    {isOpen ? (
                      <div className="ccm-group">
                        {state?.items.map(row)}
                        {state?.loading && !state.items.length ? (
                          <GlassSkeletonRows rows={2} height={44} />
                        ) : null}
                        {!state?.loading && state && !state.items.length ? (
                          <p className="ccm-side-empty">这一章还没有题目</p>
                        ) : null}
                        {state && state.items.length < state.total ? (
                          <button
                            type="button"
                            className="ccm-more"
                            disabled={state.loading}
                            onClick={() => loadGroup(group.key, state.page + 1)}
                          >
                            {state.loading
                              ? '加载中…'
                              : `再显示 ${state.total - state.items.length} 道`}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {!browsing && data?.items.length ? (
            <div className="ccm-list">
              <div className="ccm-group">{data.items.map(row)}</div>
            </div>
          ) : null}
          {!browsing && data && data.total > data.pageSize ? (
            <nav className="tcv-pager" aria-label="内容分页">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span>
                {page} / {Math.ceil(data.total / data.pageSize)}
              </span>
              <button
                type="button"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </nav>
          ) : null}
        </aside>
        <section className="ccm-detail" aria-label={`${noun}内容`}>
          {selected ? (
            <>
              <header className="ccm-detail-head">
                <button
                  type="button"
                  className="ccm-detail-back"
                  aria-label={`返回${noun}列表`}
                  onClick={() => leaveEditing() && setShowDetail(false)}
                >
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <img className="ccm-row-marble" src={statusMarble(selected.status)} alt="" />
                <h2>{selected.title}</h2>
                {selected.status ? (
                  <span
                    className={`ccm-status${selected.status === 'published' ? '' : ' is-draft'}`}
                  >
                    {selected.status === 'published'
                      ? selected.pending
                        ? '待发布'
                        : '已发布'
                      : '草稿'}
                  </span>
                ) : null}
                <time dateTime={selected.updatedAt}>{shortDate(selected.updatedAt)}</time>
                {selectedProblem && !editing ? (
                  <ProblemGroupPicker
                    className="ccm-move"
                    value={{
                      chapterId: selectedProblem.chapterId ?? null,
                      notebookId: selectedProblem.notebookId,
                    }}
                    targets={targets}
                    disabled={moving}
                    onChange={(group) => void moveProblem(selectedProblem, group)}
                  />
                ) : null}
                {!editing &&
                selected.pending !== 'delete' &&
                (kind === 'notes' ? archive?.archive : selectedProblem) ? (
                  <button
                    type="button"
                    className="ccm-ghost ccm-edit"
                    onClick={() => {
                      setError('');
                      setEditing(true);
                    }}
                  >
                    <Pencil size={14} aria-hidden /> 编辑
                  </button>
                ) : null}
                {selected.pending ? (
                  <button
                    type="button"
                    className="ccm-ghost"
                    disabled={busy}
                    onClick={() => {
                      if (!leaveEditing()) return;
                      setBusy(true);
                      void undoManagedCourseContent(courseId, kind, selected.id)
                        .then(refresh)
                        .catch((cause) =>
                          setError(cause instanceof Error ? cause.message : '撤销失败'),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    {selected.pending === 'delete' ? '撤销删除' : '放弃待发布修改'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ccm-remove"
                    aria-label={`删除${selected.title}`}
                    title="删除"
                    onClick={() => {
                      setError('');
                      setRemove(selected);
                    }}
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                )}
              </header>
              <div className="ccm-detail-body">
                {kind === 'notes' ? (
                  !archive ? (
                    <GlassSkeletonRows rows={4} height={72} />
                  ) : archive.error ? (
                    <p className="phone-page-error">{archive.error}</p>
                  ) : editing ? (
                    <NoteEditor
                      key={selected.id}
                      courseId={courseId}
                      notebookId={selected.id}
                      title={selected.title}
                      archive={archive.archive!}
                      onDirty={setDirty}
                      onClose={leaveEditing}
                      onSaved={refresh}
                    />
                  ) : (
                    <NotePreview archive={archive.archive!} />
                  )
                ) : selectedProblem ? (
                  editing ? (
                    <ProblemEditor
                      key={selected.id}
                      courseId={courseId}
                      problem={selectedProblem}
                      targets={targets}
                      onDirty={setDirty}
                      onClose={leaveEditing}
                      onSaved={refresh}
                    />
                  ) : (
                    <ProblemPreview key={selected.id} problem={selectedProblem} />
                  )
                ) : problems === null ? (
                  <GlassSkeletonRows rows={4} height={72} />
                ) : (
                  <p className="ccp-muted">这道题暂时无法预览。</p>
                )}
              </div>
            </>
          ) : empty ? (
            <div className="ccm-empty-hero">
              <img src={kind === 'notes' ? marbleImages.blue : marbleImages.purple} alt="" />
              <strong>{query ? `没有匹配的${noun}` : `还没有${noun}`}</strong>
              <span>用右上角的「上传」导入文件，或者新增一条。</span>
              <button type="button" className="ccm-primary" onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden /> 新增{noun}
              </button>
            </div>
          ) : browsing && groups ? (
            <p className="ccm-pick">从左边选一道题</p>
          ) : null}
        </section>
      </div>
      {adding ? (
        <CourseModal title={`新增${noun}`} onClose={() => setAdding(false)}>
          <CourseContentForm
            courseId={courseId}
            kind={kind}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              setPage(1);
              refresh();
            }}
          />
        </CourseModal>
      ) : null}
      {remove ? (
        <CourseModal title="删除课程内容" onClose={() => setRemove(null)} busy={busy}>
          <p>确定删除「{remove.title}」？此操作会标记为待删除，发布课程更新后学生才无法查看。</p>
          {kind === 'problems' ? (
            <p>发布时题目会归档，保留学生的作答和进度。</p>
          ) : (
            <p>发布前可在此撤销删除。</p>
          )}
          {error ? (
            <p className="phone-page-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="ccm-actions">
            <button type="button" onClick={() => setRemove(null)} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="ccm-danger"
              onClick={() => void deleteItem()}
              disabled={busy}
            >
              {busy ? '删除中…' : '确认删除'}
            </button>
          </div>
        </CourseModal>
      ) : null}
    </div>
  );
}

const contentLimit = (kind: ManagedContentKind) => (kind === 'problems' ? 12000 : 1000000);

/** 新增 / 上传一条笔记或题目。传 `kind` 时类型固定，不传时可以在表单里选。 */
export function CourseContentForm({
  courseId,
  kind: fixedKind,
  initialFile = null,
  onCancel,
  onSaved,
}: {
  courseId: string;
  kind?: ManagedContentKind;
  initialFile?: File | null;
  onCancel?: () => void;
  onSaved: (kind: ManagedContentKind) => void;
}) {
  const [ownKind, setKind] = useState<ManagedContentKind>('notes');
  const kind = fixedKind ?? ownKind;
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tooLong = text.length > contentLimit(kind);
  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1000000) {
      setError('文件不能超过 1 MB。');
      return;
    }
    void file
      .text()
      .then((content) => {
        setText(content);
        setFileName(file.name);
        setTitle((current) => current || file.name.replace(/\.[^.]+$/, ''));
        setError('');
      })
      .catch(() => setError('读取文件失败。'));
  };
  useEffect(() => {
    if (initialFile) readFile(initialFile);
    // 只在打开表单时读一次拖进来的文件。
  }, [initialFile]);
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  };
  const save = async () => {
    if (busy || !title.trim() || !text.trim() || tooLong) return;
    setBusy(true);
    setError('');
    try {
      await addManagedCourseContent(courseId, kind, title.trim(), text.trim());
      setTitle('');
      setText('');
      setFileName('');
      onSaved(kind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ccm-form">
      {fixedKind ? null : (
        <div className="ccm-tabs" role="tablist" aria-label="内容类型">
          {(['notes', 'problems'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              onClick={() => setKind(option)}
            >
              {option === 'notes' ? '笔记' : '题目'}
            </button>
          ))}
        </div>
      )}
      <label
        className={`ccm-drop${dragging ? ' is-dragging' : ''}${fileName ? ' has-file' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <input
          type="file"
          accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
          onChange={(event) => readFile(event.target.files?.[0])}
        />
        <UploadCloud size={26} aria-hidden />
        <strong>{fileName || '拖入文件，或点击选择'}</strong>
        <small>{fileName ? '已读取，可在下面修改' : '.txt · .md · .csv，不超过 1 MB'}</small>
      </label>
      <label>
        名称
        <input
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="输入名称"
        />
      </label>
      <label>
        内容
        <textarea
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            kind === 'notes' ? '输入或粘贴笔记内容，支持 Markdown' : '输入或粘贴题目内容'
          }
        />
      </label>
      {kind === 'problems' ? (
        <p className="cp-muted">
          新增的题目保存为草稿，暂不会向学生显示。编辑时设为“待发布”并保存，再发布课程更新，学生才能查看。
        </p>
      ) : null}
      {tooLong ? (
        <p role="alert" className="phone-page-error">
          内容过长，请缩短后保存。
        </p>
      ) : null}
      {error ? (
        <p className="phone-page-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ccm-actions">
        {onCancel ? (
          <button type="button" className="ccm-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
        ) : null}
        <button
          type="button"
          className="ccm-primary"
          disabled={busy || !title.trim() || !text.trim() || tooLong}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : `保存${kind === 'notes' ? '笔记' : '题目'}`}
        </button>
      </div>
    </div>
  );
}
