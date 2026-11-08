import { ProblemPracticePage } from './ProblemPracticePage';
import { PracticeOverlay } from './PracticeOverlay';
import { ClassroomSession } from './StudentClassroomPage';
import { createTeacherPracticeStore } from '../data/teacher-practice-store';
import { progressStatus } from './problem-bank/answer-sheet';
import type { ClassroomOpenProblem } from './ClassroomPanel';
import type { ProblemBankLaunch } from './ProblemBankPage';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Lock,
  LockOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import {
  deleteTeachDraft,
  getTeachProblemChoices,
  getTeachProblemPreview,
  getTeachProblemPreviews,
  getTeachSession,
  getTeachStudentAnswers,
  startTeachSession,
  teachSessionAction,
  type TeachProblemChoice,
  type TeachSession,
  type TeachSessionItem,
  type TeachStudentAnswers,
} from '../data/platform-api-client';
import { paperLabels, problemPaperSeries } from '../data/problem-bank-filters';
import type { LocalProblem, LocalProblemAttempt, LocalProblemProgress } from '../domain/models';
import { difficultyLabel, problemStem, problemTypeLabel } from '../data/local-problem-grading';
import { classSessionLabel } from '../lib/class-session-label';
import { GlassSkeletonRows } from './GlassLoadMore';
import { ProblemPreview } from './CourseContentPreview';
import { PhoneConfirm, PhoneEmpty, PhonePage } from './PhonePages';
import { AttemptHistory } from './problem-bank/attempt-history';
import { ProblemRichText, ProblemTitleText } from './problem-bank/problem-rich-text';
import {
  clock,
  courseLabel,
  Legend,
  Marble,
  problemName,
  teachResultStatus,
  usePolled,
} from './teach-shared';
import './teach-session.css';
import './course-content-manager.css';

/**
 * 一节课：备课（draft）时排题单；上课（live）和回看（ended）时是学生 × 题目的弹珠表和每题统计。
 * 点弹珠看这个学生这道题提交过的答案，只看提交，不看草稿。
 */

type Tab = 'grid' | 'stats';

export function TeachSessionView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: (classId: string | null) => void;
}) {
  const load = useCallback(() => getTeachSession(sessionId), [sessionId]);
  const { data, setData, error, setError, reload } = usePolled<TeachSession>(load, 3_000);
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('grid');
  const [showPracticeList, setShowPracticeList] = useState(false);
  const [practice, setPractice] = useState<{
    id: string;
    problems: LocalProblem[];
    launch: ProblemBankLaunch;
  } | null>(null);
  const [practiceMinimized, setPracticeMinimized] = useState(false);
  const practiceLoad = useRef(0);
  const [practiceProgress, setPracticeProgress] = useState<Record<string, LocalProblemProgress>>(
    {},
  );
  const [teacherPracticeStore] = useState(() =>
    createTeacherPracticeStore([], (progress) => {
      setPracticeProgress((previous) => ({ ...previous, [progress.problemId]: progress }));
    }),
  );
  const launchPractice = (problems: LocalProblem[], launch: ProblemBankLaunch) => {
    teacherPracticeStore.addProblems(problems);
    setPractice({ id: crypto.randomUUID(), problems, launch: { ...launch, teacherPreview: true } });
    setPracticeMinimized(false);
  };
  const openPractice = (problem: LocalProblem) =>
    launchPractice([problem], {
      problemIds: [problem.id],
      initialProblemId: problem.id,
      title: '老师试做',
    });
  const openPracticeProblem: ClassroomOpenProblem = async ({ problemIds, problemId, title }) => {
    const loadId = ++practiceLoad.current;
    const problems = await getTeachProblemPreviews(sessionId);
    if (loadId !== practiceLoad.current) return;
    const available = new Set(problems.map((problem) => problem.id));
    if (!available.has(problemId)) throw new Error('这道题已移出课堂，请刷新题单。');
    launchPractice(problems, {
      problemIds: problemIds.filter((id) => available.has(id)),
      initialProblemId: problemId,
      title,
      numbers: Object.fromEntries(
        (data?.items ?? []).flatMap((item) =>
          item.number === null ? [] : [[item.problemId, item.number]],
        ),
      ),
    });
  };
  const [picking, setPicking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<{ userId: string; problemId: string } | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  const act = async (key: string, payload: Parameters<typeof teachSessionAction>[0]) => {
    setBusy(key);
    setError('');
    try {
      setData(await teachSessionAction(payload));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
      return false;
    } finally {
      setBusy('');
    }
  };

  const status = data?.session.status;
  const editable = status === 'draft' || status === 'live';

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const start = async () => {
    if (!data) return;
    setBusy('start');
    setError('');
    try {
      await startTeachSession(data.session.class.id, sessionId);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开课失败');
    } finally {
      setBusy('');
    }
  };

  const openStats = (problemId: string) => {
    setTab('stats');
    window.setTimeout(() => {
      statsRef.current
        ?.querySelector(`[data-problem="${CSS.escape(problemId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  };

  const viewingItem = viewing
    ? (data?.items.find((item) => item.problemId === viewing.problemId) ?? null)
    : null;

  const practiceOverlay = practice
    ? createPortal(
        <PracticeOverlay
          key={practice.id}
          minimized={practiceMinimized}
          onClose={() => setPracticeMinimized(true)}
          onRestore={() => setPracticeMinimized(false)}
          onDismiss={() => setPractice(null)}
        >
          <ProblemPracticePage
            problems={practice.problems}
            launch={practice.launch}
            teacherPracticeStore={teacherPracticeStore}
            onBack={() => setPracticeMinimized(true)}
            onMinimize={() => setPracticeMinimized(true)}
          />
        </PracticeOverlay>,
        document.body,
      )
    : null;

  if (showPracticeList && data) {
    return (
      <>
        <ClassroomSession
          session={{
            id: sessionId,
            number: data.session.number,
            name: data.session.name,
            status: data.session.status,
            courseId: data.session.course.id,
            courseName: data.session.course.name,
            items: data.items.map((item) => {
              const progress = practiceProgress[item.problemId];
              return {
                ...item,
                myStatus: progressStatus(progress?.status),
                myAttempts: progress?.attemptedCount ?? 0,
              };
            }),
          }}
          teacherPreview
          onBack={() => {
            practiceLoad.current += 1;
            setPractice(null);
            setShowPracticeList(false);
          }}
          onOpenProblem={openPracticeProblem}
        />
        {practiceOverlay}
      </>
    );
  }

  return (
    <PhonePage
      title={data ? classSessionLabel(data.session) : '上课'}
      overlay
      wide
      largeTitle
      onBack={() => onBack(data?.session.class.id ?? null)}
    >
      <div className="tp-page ts-page">
        <header className="phone-large-head tp-head ts-session-head">
          {data ? (
            <SessionNameEditor
              key={sessionId}
              session={data.session}
              busy={Boolean(busy)}
              onSave={(name) => act('rename', { action: 'rename', sessionId, name })}
            />
          ) : (
            <h1>上课</h1>
          )}
          {data ? <span className="tp-term">{courseLabel(data.session.course)}</span> : null}
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data && status === 'draft' ? (
          <DraftEditor
            data={data}
            busy={busy}
            onPractice={openPractice}
            onStart={() => void start()}
            onAdd={() => setPicking(true)}
            onDelete={() => setDeleting(true)}
            onMove={(index, delta) => {
              const ids = data.items.map((item) => item.problemId);
              const [moved] = ids.splice(index, 1);
              ids.splice(index + delta, 0, moved);
              void act('reorder', { action: 'reorder', sessionId, problemIds: ids });
            }}
            onRemove={(problemId) =>
              void act(`remove:${problemId}`, { action: 'remove', sessionId, problemId })
            }
          />
        ) : null}
        {data && status !== 'draft' ? (
          <>
            <section className="ts-bar">
              {status === 'live' ? (
                <div className="ts-bar-code">
                  <small>课堂码</small>
                  <strong>{data.session.code}</strong>
                </div>
              ) : (
                <div className="ts-bar-ended">
                  <small>已下课</small>
                  <strong>{data.session.startedAt ? clock(data.session.startedAt) : '—'}</strong>
                </div>
              )}
              <div className="ts-bar-count">
                <strong>{data.session.presentCount}</strong>
                <small>{status === 'live' ? '人在场' : '人来过'}</small>
              </div>
              <div className="ts-bar-actions">
                <button
                  type="button"
                  className="ts-pill ts-refresh"
                  disabled={refreshing || Boolean(busy)}
                  aria-busy={refreshing}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} aria-hidden />
                  <span aria-live="polite">{refreshing ? '刷新中…' : '刷新'}</span>
                </button>
                {status === 'live' ? (
                  <>
                    <button
                      type="button"
                      className="ts-pill is-primary"
                      onClick={() => setPicking(true)}
                    >
                      <Plus size={15} aria-hidden />
                      加题
                    </button>
                    <button
                      type="button"
                      className="ts-pill"
                      disabled={busy === 'lock'}
                      onClick={() =>
                        void act('lock', {
                          action: 'lock',
                          sessionId,
                          locked: !data.session.locked,
                        })
                      }
                    >
                      {data.session.locked ? (
                        <LockOpen size={15} aria-hidden />
                      ) : (
                        <Lock size={15} aria-hidden />
                      )}
                      {data.session.locked ? '开门' : '锁门'}
                    </button>
                    <button
                      type="button"
                      className="ts-pill is-end"
                      onClick={() => setEnding(true)}
                    >
                      <Square size={13} aria-hidden />
                      下课
                    </button>
                  </>
                ) : null}
              </div>
            </section>

            <div className="ts-tabs" role="group" aria-label="显示方式">
              <button type="button" aria-pressed={tab === 'grid'} onClick={() => setTab('grid')}>
                答题
              </button>
              <button type="button" aria-pressed={tab === 'stats'} onClick={() => setTab('stats')}>
                统计
              </button>
              <button type="button" onClick={() => setShowPracticeList(true)}>
                老师试做
              </button>
            </div>

            {tab === 'grid' ? (
              <SessionGrid
                data={data}
                editable={status === 'live'}
                onOpenStats={openStats}
                onOpenAnswer={(userId, problemId) => setViewing({ userId, problemId })}
                onRemove={(problemId) =>
                  void act(`remove:${problemId}`, { action: 'remove', sessionId, problemId })
                }
              />
            ) : (
              <div className="ts-stats" ref={statsRef}>
                {data.items.length ? (
                  data.items.map((item, index) => (
                    <ProblemStats
                      key={item.id}
                      item={item}
                      index={index}
                      studentCount={data.students.length}
                    />
                  ))
                ) : (
                  <PhoneEmpty title="这节课还没有题" hint="" />
                )}
              </div>
            )}
          </>
        ) : null}
      </div>

      {practiceOverlay}
      {picking && data && editable ? (
        <ProblemPicker
          sessionId={sessionId}
          existing={data.items.map((item) => item.problemId)}
          busy={busy === 'add'}
          submissionError={error}
          onClose={() => setPicking(false)}
          onAdd={async (problemIds) => {
            if (await act('add', { action: 'add', sessionId, problemIds })) setPicking(false);
          }}
        />
      ) : null}

      {viewing && viewingItem && data ? (
        <AnswerDialog
          key={viewing.problemId}
          sessionId={sessionId}
          item={viewingItem}
          students={data.students}
          userId={viewing.userId}
          onSelect={(userId) => setViewing({ userId, problemId: viewing.problemId })}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {ending ? (
        <PhoneConfirm
          title="下课？"
          message="课堂码会失效。学生之后从课堂入口交的题还算这节课。"
          confirmLabel="下课"
          destructive
          busy={busy === 'end'}
          onCancel={() => setEnding(false)}
          onConfirm={async () => {
            await act('end', { action: 'end', sessionId });
            setEnding(false);
          }}
        />
      ) : null}

      {deleting && data ? (
        <PhoneConfirm
          title={`删除「${classSessionLabel(data.session)}」？`}
          message="只删除这份备课，题库里的题不受影响。"
          confirmLabel="删除"
          destructive
          busy={busy === 'delete'}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            setBusy('delete');
            try {
              onBack((await deleteTeachDraft(sessionId)).classId);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '删除失败');
              setDeleting(false);
              setBusy('');
            }
          }}
        />
      ) : null}
    </PhonePage>
  );
}

function SessionNameEditor({
  session,
  busy,
  onSave,
}: {
  session: TeachSession['session'];
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasEdited = useRef(false);
  const label = classSessionLabel(session);
  useEffect(() => {
    if (editing) inputRef.current?.select();
    else if (hasEdited.current) buttonRef.current?.focus();
  }, [editing]);

  return editing ? (
    <form
      className="ts-name-form"
      aria-label="修改课堂名称"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !name.trim()) return;
        if (name.trim() === label || (await onSave(name.trim()))) setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          setEditing(false);
        }
      }}
    >
      <input
        ref={inputRef}
        aria-label="课堂名称"
        value={name}
        maxLength={80}
        required
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" className="ts-pill is-primary" disabled={busy || !name.trim()}>
        {busy ? '保存中…' : '保存'}
      </button>
      <button type="button" className="ts-pill" disabled={busy} onClick={() => setEditing(false)}>
        取消
      </button>
    </form>
  ) : (
    <h1 className="ts-session-title">
      <button
        ref={buttonRef}
        type="button"
        className="ts-name-button"
        aria-label={`修改课堂名称：${label}`}
        title="修改课堂名称"
        disabled={busy}
        onClick={() => {
          hasEdited.current = true;
          setName(label);
          setEditing(true);
        }}
      >
        <span>{label}</span>
        <Pencil size={18} aria-hidden />
      </button>
    </h1>
  );
}

function SessionProblemPreview({
  sessionId,
  item,
  onPractice,
}: {
  sessionId: string;
  item: TeachSessionItem;
  onPractice: (problem: LocalProblem) => void;
}) {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [problem, setProblem] = useState<LocalProblem | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    getTeachProblemPreview(sessionId, item.problemId)
      .then((result) => active && setProblem(result))
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取题目失败');
      });
    return () => {
      active = false;
    };
  }, [sessionId, item.problemId, revision, visible]);

  return (
    <div ref={ref} className="ts-problem-preview" role="region" aria-label={problemName(item)}>
      {error ? (
        <div role="alert">
          <p className="phone-page-error">{error}</p>
          <button
            type="button"
            className="ts-pill"
            onClick={() => {
              setError('');
              setRevision((value) => value + 1);
            }}
          >
            重试
          </button>
        </div>
      ) : problem ? (
        <>
          <div id={detailsId}>
            {expanded ? (
              <ProblemPreview problem={problem} />
            ) : (
              <div className="ts-problem-summary">
                <ProblemRichText content={problemStem(problem)} />
              </div>
            )}
          </div>
          <div className="ts-problem-preview-footer">
            <button
              type="button"
              className="ts-pill is-primary"
              onClick={() => onPractice(problem)}
            >
              <Play size={14} aria-hidden />
              老师试做
            </button>
            {!expanded ? (
              <span>
                {problemTypeLabel(problem.type)} · {difficultyLabel(problem.difficulty)}
              </span>
            ) : null}
            <button
              type="button"
              className="ts-problem-details-toggle"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起详情' : '展开详情'}
              {expanded ? (
                <ChevronUp size={15} aria-hidden />
              ) : (
                <ChevronDown size={15} aria-hidden />
              )}
            </button>
          </div>
        </>
      ) : (
        <div role="status" aria-label="正在读取题目">
          <GlassSkeletonRows rows={2} height={24} />
        </div>
      )}
    </div>
  );
}

function DraftEditor({
  onPractice,
  data,
  busy,
  onStart,
  onAdd,
  onDelete,
  onMove,
  onRemove,
}: {
  data: TeachSession;
  onPractice: (problem: LocalProblem) => void;
  busy: string;
  onStart: () => void;
  onAdd: () => void;
  onDelete: () => void;
  onMove: (index: number, delta: number) => void;
  onRemove: (problemId: string) => void;
}) {
  return (
    <>
      <section className="ts-bar">
        <div className="ts-bar-ended">
          <small>备课</small>
          <strong>{data.items.length} 题</strong>
        </div>
        <div className="ts-bar-actions">
          <button type="button" className="ts-pill" onClick={onAdd}>
            <Plus size={15} aria-hidden />
            加题
          </button>
          <button
            type="button"
            className="ts-pill is-icon"
            aria-label="删除这份备课"
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="ts-pill is-primary"
            disabled={busy === 'start'}
            onClick={onStart}
          >
            <Play size={14} aria-hidden />
            开始上课
          </button>
        </div>
      </section>
      {data.items.length ? (
        <ol className="ts-draft-list">
          {data.items.map((item, index) => (
            <li key={item.id}>
              <div className="ts-draft-item-head">
                <span className="ts-draft-no">{index + 1}</span>
                <h2 className="ts-draft-title">
                  <ProblemTitleText content={problemName(item)} />
                </h2>
                <button
                  type="button"
                  aria-label="上移"
                  disabled={index === 0 || busy === 'reorder'}
                  onClick={() => onMove(index, -1)}
                >
                  <ArrowUp size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  disabled={index === data.items.length - 1 || busy === 'reorder'}
                  onClick={() => onMove(index, 1)}
                >
                  <ArrowDown size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="从这节课移除"
                  disabled={busy === `remove:${item.problemId}`}
                  onClick={() => onRemove(item.problemId)}
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
              <SessionProblemPreview
                sessionId={data.session.id}
                item={item}
                onPractice={onPractice}
              />
            </li>
          ))}
        </ol>
      ) : (
        <PhoneEmpty title="还没有题" hint="可以现在排好，也可以上课时再加。" />
      )}
    </>
  );
}

function RatioTube({ item, total }: { item: TeachSessionItem; total: number }) {
  const scale = Math.max(total, item.submittedCount, 1);
  return (
    <span className="ts-tube" aria-hidden>
      <i className="is-passed" style={{ width: `${(item.passedCount / scale) * 100}%` }} />
      <i className="is-partial" style={{ width: `${(item.partialCount / scale) * 100}%` }} />
      <i className="is-failed" style={{ width: `${(item.failedCount / scale) * 100}%` }} />
    </span>
  );
}

function SessionGrid({
  data,
  editable,
  onOpenStats,
  onOpenAnswer,
  onRemove,
}: {
  data: TeachSession;
  editable: boolean;
  onOpenStats: (problemId: string) => void;
  onOpenAnswer: (userId: string, problemId: string) => void;
  onRemove: (problemId: string) => void;
}) {
  const results = useMemo(() => {
    const map = new Map<string, TeachSessionItem['results'][number]>();
    for (const item of data.items) {
      for (const row of item.results) map.set(`${row.userId}:${item.problemId}`, row);
    }
    return map;
  }, [data.items]);
  if (!data.students.length) {
    return <PhoneEmpty title="还没有人进来" hint="让学生输课堂码。" />;
  }
  return (
    <div className="ts-grid-card">
      <div className="ts-grid-scroll">
        <table className="ts-grid">
          <thead>
            <tr>
              <th className="ts-grid-name" scope="col" />
              {data.items.map((item, index) => (
                <th key={item.id} scope="col" title={problemName(item)}>
                  <button
                    type="button"
                    className="ts-column"
                    aria-label={`第 ${index + 1} 题统计：${item.title}`}
                    onClick={() => onOpenStats(item.problemId)}
                  >
                    <b>{index + 1}</b>
                    <RatioTube item={item} total={data.students.length} />
                  </button>
                  {editable ? (
                    <button
                      type="button"
                      className="ts-column-remove"
                      aria-label={`从这节课移除：${item.title}`}
                      onClick={() => onRemove(item.problemId)}
                    >
                      <X size={11} aria-hidden />
                    </button>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((student) => {
              const done = data.items.filter((item) =>
                results.has(`${student.userId}:${item.problemId}`),
              ).length;
              return (
                <tr key={student.userId} className={student.present ? undefined : 'is-absent'}>
                  <th className="ts-grid-name" scope="row">
                    <strong>{student.name}</strong>
                    <small>
                      {student.present
                        ? `${student.via === 'code' ? '旁听 · ' : ''}${done}/${data.items.length}`
                        : '没来'}
                    </small>
                  </th>
                  {data.items.map((item) => {
                    const row = results.get(`${student.userId}:${item.problemId}`);
                    const status = row?.status ?? 'none';
                    const solutionViewed =
                      item.solutionViewedUserIds?.includes(student.userId) ?? false;
                    return (
                      <td key={item.id}>
                        <button
                          type="button"
                          className="ts-cell"
                          aria-label={`${student.name} · ${item.title} · ${teachResultStatus(status, row?.attempts, solutionViewed).label}`}
                          title={`${teachResultStatus(status, row?.attempts, solutionViewed).label}${row && row.attempts > 1 ? ` · ${row.attempts} 次` : ''}`}
                          onClick={() => onOpenAnswer(student.userId, item.problemId)}
                        >
                          <Marble
                            status={status}
                            attempts={row?.attempts}
                            solutionViewed={solutionViewed}
                            size={24}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!data.items.length ? <p className="ts-grid-hint">还没有题，点「加题」。</p> : null}
      <Legend showSolutionViewed />
    </div>
  );
}

function ProblemStats({
  item,
  index,
  studentCount,
}: {
  item: TeachSessionItem;
  index: number;
  studentCount: number;
}) {
  const rate = item.submittedCount
    ? Math.round((item.passedCount / item.submittedCount) * 100)
    : null;
  return (
    <article className="ts-stat" data-problem={item.problemId}>
      <header>
        <span className="ts-stat-no">{index + 1}</span>
        <strong>
          <ProblemTitleText content={item.title} />
        </strong>
        <small>
          {item.submittedCount}/{studentCount} 交
        </small>
      </header>
      {item.options ? (
        <ul className="ts-options">
          {item.options.map((option) => (
            <li key={option.id} className={option.correct ? 'is-correct' : undefined}>
              <span className="ts-option-id">{option.id}</span>
              <span className="ts-option-body">
                <span className="ts-option-label">
                  <ProblemTitleText content={option.label} />
                  {option.correct ? <Check size={14} aria-label="正确选项" /> : null}
                </span>
                <span className="ts-option-bar">
                  <i
                    style={{
                      width: `${item.submittedCount ? (option.count / item.submittedCount) * 100 : 0}%`,
                    }}
                  />
                </span>
              </span>
              <b>{option.count}</b>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ts-ratio">
          <RatioTube item={item} total={item.submittedCount} />
          <b>{rate === null ? '—' : `${rate}%`}</b>
          <small>
            对 {item.passedCount} · 部分 {item.partialCount} · 错 {item.failedCount}
          </small>
        </div>
      )}
    </article>
  );
}

function toLocalAttempt(
  problemId: string,
  attempt: TeachStudentAnswers['attempts'][number],
): LocalProblemAttempt {
  // 小问的得分服务器按分值存，记录组件按 0~1 显示。
  const parts = Array.isArray(attempt.result.parts)
    ? (attempt.result.parts as Array<Record<string, unknown>>).map((part) =>
        typeof part.score === 'number' && typeof part.points === 'number' && part.points > 0
          ? { ...part, score: part.score / part.points }
          : part,
      )
    : undefined;
  const result = parts ? { ...attempt.result, parts } : attempt.result;
  return {
    id: attempt.id,
    problemId,
    kind: attempt.kind,
    answer: attempt.answer,
    // 代码题的判题结果和本机作答存的位置不一样。
    result: attempt.kind === 'submit' ? { ...result, serverCodeResult: result } : result,
    score: attempt.score,
    status: attempt.status,
    createdAt: attempt.createdAt,
    updatedAt: attempt.createdAt,
  };
}

function AnswerDialog({
  sessionId,
  item,
  students,
  userId,
  onSelect,
  onClose,
}: {
  sessionId: string;
  item: TeachSessionItem;
  students: TeachSession['students'];
  userId: string;
  onSelect: (userId: string) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ userId: string; data: TeachStudentAnswers } | null>(null);
  const [failed, setFailed] = useState<{ userId: string; message: string } | null>(null);
  const index = students.findIndex((student) => student.userId === userId);
  const student = students[index];
  const previous = students[index - 1];
  const next = students[index + 1];
  const attemptCount = item.results.find((row) => row.userId === userId)?.attempts ?? 0;

  useEffect(() => {
    let alive = true;
    getTeachStudentAnswers(sessionId, item.problemId, userId)
      .then((data) => {
        if (!alive) return;
        setLoaded({ userId, data });
        setFailed(null);
      })
      .catch((cause) => {
        if (alive) {
          setFailed({ userId, message: cause instanceof Error ? cause.message : '读取失败' });
        }
      });
    return () => {
      alive = false;
    };
    // 学生交了新答案（次数变了）时重新读。
  }, [attemptCount, item.problemId, sessionId, userId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft' && previous) onSelect(previous.userId);
      else if (event.key === 'ArrowRight' && next) onSelect(next.userId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, onClose, onSelect, previous]);

  const data = loaded?.userId === userId ? loaded.data : null;
  const error = failed?.userId === userId ? failed.message : '';
  const attempts = useMemo(
    () => (data?.attempts ?? []).map((attempt) => toLocalAttempt(item.problemId, attempt)),
    [data, item.problemId],
  );
  const status = item.results.find((row) => row.userId === userId)?.status ?? 'none';
  const solutionViewed = item.solutionViewedUserIds?.includes(userId) ?? false;

  return createPortal(
    <div className="phone-confirm-layer tp-sheet-layer" role="presentation">
      <button
        type="button"
        className="phone-confirm-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <section className="tp-sheet ts-answer" role="dialog" aria-modal="true" aria-label="学生答案">
        <header className="ts-answer-head">
          <button
            type="button"
            className="ts-nav"
            aria-label="上一个学生"
            disabled={!previous}
            onClick={() => previous && onSelect(previous.userId)}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <div className="ts-answer-who">
            <Marble
              status={status}
              attempts={attemptCount}
              solutionViewed={solutionViewed}
              size={26}
            />
            <span>
              <strong>{student?.name}</strong>
              <small>
                {index + 1}/{students.length}
              </small>
            </span>
          </div>
          <button
            type="button"
            className="ts-nav"
            aria-label="下一个学生"
            disabled={!next}
            onClick={() => next && onSelect(next.userId)}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
          <button type="button" className="ts-nav ts-close" aria-label="关闭" onClick={onClose}>
            <X size={17} aria-hidden />
          </button>
        </header>
        <p className="ts-answer-problem">
          <ProblemTitleText content={problemName(item)} />
        </p>
        {solutionViewed ? (
          <p className="ts-answer-problem">已看答案 · 提交次数和成绩仍按实际作答计算</p>
        ) : null}
        <div className="ts-answer-body">
          {error ? <p className="phone-page-error">{error}</p> : null}
          {!data && !error ? <GlassSkeletonRows rows={3} height={44} /> : null}
          {data && !attempts.length ? <p className="ts-answer-empty">还没提交</p> : null}
          {data && attempts.length ? (
            <AttemptHistory
              key={userId}
              attempts={attempts}
              language={data.language ?? undefined}
              title=""
              answerLabel="提交内容"
            />
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ProblemPicker({
  sessionId,
  existing,
  busy,
  submissionError,
  onClose,
  onAdd,
}: {
  sessionId: string;
  existing: string[];
  busy: boolean;
  submissionError: string;
  onClose: () => void;
  onAdd: (problemIds: string[]) => void;
}) {
  const [choices, setChoices] = useState<TeachProblemChoice[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [chapter, setChapter] = useState<string | null>(null);
  const [series, setSeries] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector('input')?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    getTeachProblemChoices(sessionId)
      .then((rows) => {
        if (alive) setChoices(rows);
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : '读取题目失败');
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);
  const seriesOptions = useMemo(() => problemPaperSeries(choices ?? []), [choices]);
  const seriesChoices = useMemo(
    () =>
      (choices ?? []).filter((problem) => !series || paperLabels(problem.tags).includes(series)),
    [choices, series],
  );
  const added = new Set(existing);
  const picked = new Set(selected.filter((id) => !added.has(id)));
  const chapters = new Map<
    string,
    { name: string; total: number; added: number; selected: number }
  >();
  for (const problem of choices ?? []) {
    const key = problem.chapter?.id ?? '';
    const group = chapters.get(key) ?? {
      name: problem.chapter?.name ?? '未分章节',
      total: 0,
      added: 0,
      selected: 0,
    };
    if (!series || paperLabels(problem.tags).includes(series)) {
      group.total += 1;
      if (added.has(problem.id)) group.added += 1;
      if (picked.has(problem.id)) group.selected += 1;
    }
    chapters.set(key, group);
  }
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = seriesChoices.filter((problem) => {
    if (chapter !== null && (problem.chapter?.id ?? '') !== chapter) return false;
    if (!words.length) return true;
    const haystack = [
      problemName(problem),
      problem.chapter?.name,
      ...(problem.tags ?? []),
      ...paperLabels(problem.tags),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const available = visible.filter((problem) => !added.has(problem.id));
  const allPicked = available.length > 0 && available.every((problem) => picked.has(problem.id));
  const scopeLabel = words.length
    ? '搜索结果'
    : chapter !== null && series
      ? '筛选结果'
      : chapter !== null
        ? '本章'
        : series
          ? '本系列'
          : '全部题目';
  // Match the add-action request limit, without hiding choices beyond the first 400.
  const exceedsAddLimit = picked.size > 400;
  return createPortal(
    <dialog
      ref={dialogRef}
      className="tp-sheet ts-picker"
      aria-label="加题"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (busy || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className="ts-picker-head">
        <div>
          <h2>加题</h2>
          <p>
            {seriesOptions.length
              ? '按章节或试卷系列选题，也可以组合筛选。'
              : '按章节选择要加入的题目。'}
          </p>
        </div>
        <button
          type="button"
          className="ts-nav"
          aria-label="关闭加题"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} aria-hidden />
        </button>
      </header>
      <div className="ts-picker-body">
        <nav className="ts-picker-chapters" aria-label="题目章节">
          <span className="ts-picker-nav-title">章节</span>
          <button
            type="button"
            aria-current={chapter === null ? 'true' : undefined}
            onClick={() => setChapter(null)}
          >
            <span>全部章节</span>
            <small>{seriesChoices.length} 题</small>
          </button>
          {Array.from(chapters, ([id, group]) => (
            <button
              key={id}
              type="button"
              aria-current={chapter === id ? 'true' : undefined}
              onClick={() => setChapter(id)}
            >
              <span>{group.name}</span>
              <small>
                {group.total} 题{group.added ? ` · 已加入 ${group.added}` : ''}
                {group.selected ? ` · 已选 ${group.selected}` : ''}
              </small>
            </button>
          ))}
        </nav>
        <div className="ts-picker-main">
          {seriesOptions.length > 0 ? (
            <label className="ts-picker-series">
              <span>试卷系列</span>
              <select
                aria-label="试卷系列"
                value={series}
                onChange={(event) => setSeries(event.target.value)}
              >
                <option value="">全部系列</option>
                {seriesOptions.map(([label, count]) => (
                  <option key={label} value={label}>
                    {label}（{count} 题）
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="phone-search ts-picker-search">
            <Search size={18} aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜题号、题目、章节或系列"
              aria-label="搜题号、题目、章节或系列"
              type="search"
            />
          </label>
          <div className="ts-picker-tools">
            <div>
              <strong>
                {[chapter !== null ? chapters.get(chapter)?.name : '', series]
                  .filter(Boolean)
                  .join(' · ') || '全部题目'}
              </strong>
              <small>
                {visible.length} 题 · 可加入 {available.length} 题
              </small>
            </div>
            <button
              type="button"
              className="ts-pill"
              disabled={!available.length || busy}
              onClick={() => {
                const ids = new Set(available.map((problem) => problem.id));
                setSelected((current) =>
                  allPicked
                    ? current.filter((id) => !ids.has(id))
                    : [...new Set([...current, ...ids])],
                );
              }}
            >
              {allPicked ? `取消全选${scopeLabel}` : `全选${scopeLabel}`}
            </button>
          </div>
          <div className="tp-sheet-list ts-picker-list" aria-busy={!choices && !error}>
            {error || submissionError ? (
              <p className="phone-page-error" role="alert">
                {error || submissionError}
              </p>
            ) : null}
            {!choices && !error ? <GlassSkeletonRows rows={5} height={54} /> : null}
            {visible.map((problem) => {
              const inSession = added.has(problem.id);
              const checked = inSession || picked.has(problem.id);
              return (
                <button
                  key={problem.id}
                  type="button"
                  className="phone-row tp-choice"
                  aria-pressed={checked}
                  disabled={inSession || busy}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(problem.id)
                        ? current.filter((id) => id !== problem.id)
                        : [...current, problem.id],
                    )
                  }
                >
                  <span className="tp-check" aria-hidden />
                  <span className="tp-course-copy">
                    <strong>
                      <ProblemTitleText content={problemName(problem)} />
                    </strong>
                    <small>{problem.chapter?.name ?? '未分章节'}</small>
                  </span>
                  {inSession ? <small className="ts-picker-added">已加入</small> : null}
                </button>
              );
            })}
            {choices && !visible.length ? (
              <PhoneEmpty
                title="没有找到题目"
                hint={seriesOptions.length ? '试试其他章节、系列或关键词' : '试试其他章节或关键词'}
              />
            ) : null}
          </div>
        </div>
      </div>
      <footer className="ts-picker-foot">
        <div className="ts-picker-summary" role="status">
          <span>
            已选 <strong>{picked.size}</strong> 题{exceedsAddLimit ? '（每次最多加入 400 题）' : ''}
          </span>
          {picked.size ? (
            <button type="button" disabled={busy} onClick={() => setSelected([])}>
              清空选择
            </button>
          ) : null}
        </div>
        <button type="button" className="phone-confirm-button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="phone-confirm-button is-primary"
          disabled={!picked.size || exceedsAddLimit || busy}
          onClick={() =>
            onAdd(
              (choices ?? [])
                .filter((problem) => picked.has(problem.id))
                .map((problem) => problem.id),
            )
          }
        >
          {busy ? '加入中…' : picked.size ? `加入 ${picked.size} 题` : '加入'}
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
