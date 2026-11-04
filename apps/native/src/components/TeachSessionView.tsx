import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import {
  deleteTeachDraft,
  getTeachProblemChoices,
  getTeachSession,
  getTeachStudentAnswers,
  startTeachSession,
  teachSessionAction,
  type TeachProblemChoice,
  type TeachSession,
  type TeachSessionItem,
  type TeachStudentAnswers,
} from '../data/platform-api-client';
import type { LocalProblemAttempt } from '../domain/models';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneConfirm, PhoneEmpty, PhonePage } from './PhonePages';
import { AttemptHistory } from './problem-bank/attempt-history';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
import { clock, courseLabel, Legend, Marble, problemName, STATUS, usePolled } from './teach-shared';
import './teach-session.css';

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
  const [tab, setTab] = useState<Tab>('grid');
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

  return (
    <PhonePage
      title={data ? `第 ${data.session.number} 节` : '上课'}
      overlay
      wide
      largeTitle
      onBack={() => onBack(data?.session.class.id ?? null)}
    >
      <div className="tp-page ts-page">
        <header className="phone-large-head tp-head">
          <h1>{data ? `第 ${data.session.number} 节` : '上课'}</h1>
          {data ? <span className="tp-term">{courseLabel(data.session.course)}</span> : null}
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data && status === 'draft' ? (
          <DraftEditor
            data={data}
            busy={busy}
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
              {status === 'live' ? (
                <div className="ts-bar-actions">
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
                      void act('lock', { action: 'lock', sessionId, locked: !data.session.locked })
                    }
                  >
                    {data.session.locked ? (
                      <LockOpen size={15} aria-hidden />
                    ) : (
                      <Lock size={15} aria-hidden />
                    )}
                    {data.session.locked ? '开门' : '锁门'}
                  </button>
                  <button type="button" className="ts-pill is-end" onClick={() => setEnding(true)}>
                    <Square size={13} aria-hidden />
                    下课
                  </button>
                </div>
              ) : null}
            </section>

            <div className="ts-tabs" role="group" aria-label="显示方式">
              <button type="button" aria-pressed={tab === 'grid'} onClick={() => setTab('grid')}>
                答题
              </button>
              <button type="button" aria-pressed={tab === 'stats'} onClick={() => setTab('stats')}>
                统计
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

      {picking && data && editable ? (
        <ProblemPicker
          sessionId={sessionId}
          existing={data.items.map((item) => item.problemId)}
          busy={busy === 'add'}
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
          title={`删除第 ${data.session.number} 节？`}
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

function DraftEditor({
  data,
  busy,
  onStart,
  onAdd,
  onDelete,
  onMove,
  onRemove,
}: {
  data: TeachSession;
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
              <span className="ts-draft-no">{index + 1}</span>
              <span className="ts-draft-title">
                <ProblemTitleText content={problemName(item)} />
              </span>
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
                    return (
                      <td key={item.id}>
                        <button
                          type="button"
                          className="ts-cell"
                          aria-label={`${student.name} · ${item.title} · ${STATUS[status].label}`}
                          title={`${STATUS[status].label}${row && row.attempts > 1 ? ` · ${row.attempts} 次` : ''}`}
                          onClick={() => onOpenAnswer(student.userId, item.problemId)}
                        >
                          <Marble status={status} size={24} />
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
      <Legend />
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
            <Marble status={status} size={26} />
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
  onClose,
  onAdd,
}: {
  sessionId: string;
  existing: string[];
  busy: boolean;
  onClose: () => void;
  onAdd: (problemIds: string[]) => void;
}) {
  const [choices, setChoices] = useState<TeachProblemChoice[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
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
  const added = new Set(existing);
  const text = query.trim().toLowerCase();
  const visible = (choices ?? []).filter(
    (problem) =>
      !text ||
      problemName(problem).toLowerCase().includes(text) ||
      Boolean(problem.chapter?.name.toLowerCase().includes(text)),
  );
  return createPortal(
    <div className="phone-confirm-layer tp-sheet-layer" role="presentation">
      <button
        type="button"
        className="phone-confirm-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <section className="tp-sheet" role="dialog" aria-modal="true" aria-label="加题">
        <label className="phone-search tp-sheet-search">
          <Search size={17} aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜题号、题目或章节"
            type="search"
          />
        </label>
        <div className="tp-sheet-list">
          {error ? <p className="phone-page-error">{error}</p> : null}
          {!choices && !error ? <GlassSkeletonRows rows={5} height={44} /> : null}
          {visible.map((problem) => {
            const inSession = added.has(problem.id);
            const checked = inSession || selected.includes(problem.id);
            return (
              <button
                key={problem.id}
                type="button"
                className="phone-row tp-choice"
                aria-pressed={checked}
                disabled={inSession}
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
              </button>
            );
          })}
          {choices && !visible.length ? <PhoneEmpty title="没有找到题目" hint="" /> : null}
        </div>
        <footer className="tp-sheet-foot">
          <button type="button" className="phone-confirm-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="phone-confirm-button is-primary"
            disabled={!selected.length || busy}
            onClick={() => onAdd(selected)}
          >
            {selected.length ? `加入 ${selected.length} 题` : '加入'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
