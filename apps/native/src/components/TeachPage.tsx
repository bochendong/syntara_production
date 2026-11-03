import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ChevronRight,
  Copy,
  Eye,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';

import { resolveNativeCourseAvatar } from '../assets';
import {
  claimTeachCourse,
  getTeachClaimableCourses,
  releaseTeachCourse,
  type TeachClaimableCourse,
  getTeachClass,
  getTeachHome,
  getTeachProblemChoices,
  getTeachSession,
  openTeachClass,
  startTeachSession,
  teachClassAction,
  teachSessionAction,
  type TeachAttemptStatus,
  type TeachClass,
  type TeachHome,
  type TeachProblemChoice,
  type TeachSession,
} from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';
import { readLoginIntent } from '../lib/login-intent';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneConfirm, PhoneEmpty, PhonePage } from './PhonePages';
import './teach-page.css';

/**
 * 「教学」页（网页版、iPad、电脑 App；手机没有）：老师的班级和上课。
 * 一门课每学期一个班。上课时给出 6 位课堂码，发出的题只统计这节课在场的人。
 */

type View =
  | { kind: 'home' }
  | { kind: 'claim' }
  | { kind: 'class'; classId: string }
  | { kind: 'session'; sessionId: string; classId: string | null };

const STATUS: Record<TeachAttemptStatus | 'none', { label: string; marble: string | null }> = {
  passed: { label: '对了', marble: marbleImages.green },
  partial: { label: '部分对', marble: marbleImages.amber },
  failed: { label: '错了', marble: marbleImages.pink },
  error: { label: '出错', marble: marbleImages.pink },
  pending: { label: '待批改', marble: marbleImages.blue },
  none: { label: '没交', marble: null },
};

function Marble({ status, size = 22 }: { status: TeachAttemptStatus | 'none'; size?: number }) {
  const marble = STATUS[status].marble;
  return marble ? (
    <img className="tp-marble" src={marble} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="tp-marble is-empty" style={{ width: size, height: size }} aria-hidden />
  );
}

function Legend() {
  return (
    <div className="tp-legend" aria-hidden>
      {(['passed', 'partial', 'failed', 'pending', 'none'] as const).map((status) => (
        <span key={status}>
          <Marble status={status} size={14} />
          {STATUS[status].label}
        </span>
      ))}
    </div>
  );
}

function problemName(problem: { number: number | null; title: string }) {
  return problem.number ? `${problem.number}. ${problem.title}` : problem.title;
}

function courseLabel(course: { courseCode: string | null; name: string }) {
  return course.courseCode?.trim() || course.name;
}

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 读一次，之后静默刷新（页面在后台时不刷）。 */
function usePolled<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // load 要是稳定的函数（模块函数或 useCallback），换了就重新读。
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取失败');
    }
  }, [load]);
  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    const timer = intervalMs
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void reload();
        }, intervalMs)
      : 0;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs, reload]);
  return { data, setData, error, setError, reload };
}

export function TeachPage({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>({ kind: 'home' });
  if (view.kind === 'class') {
    return (
      <TeachClassView
        key={view.classId}
        classId={view.classId}
        onBack={() => setView({ kind: 'home' })}
        onOpenSession={(sessionId) =>
          setView({ kind: 'session', sessionId, classId: view.classId })
        }
      />
    );
  }
  if (view.kind === 'claim') {
    return <TeachClaimView onBack={() => setView({ kind: 'home' })} />;
  }
  if (view.kind === 'session') {
    return (
      <TeachSessionView
        key={view.sessionId}
        sessionId={view.sessionId}
        onBack={(classId) => setView(classId ? { kind: 'class', classId } : { kind: 'home' })}
      />
    );
  }
  return (
    <TeachHomeView
      onBack={onBack}
      onOpenClass={(classId) => setView({ kind: 'class', classId })}
      onOpenSession={(sessionId) => setView({ kind: 'session', sessionId, classId: null })}
      onOpenClaim={() => setView({ kind: 'claim' })}
    />
  );
}

// 老师登录后第一次进教学页、还没有课时，直接进认领页（只自动跳一次）。
let autoClaimShown = false;

function TeachHomeView({
  onBack,
  onOpenClass,
  onOpenSession,
  onOpenClaim,
}: {
  onBack: () => void;
  onOpenClass: (classId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenClaim: () => void;
}) {
  const { data, error, setError } = usePolled<TeachHome>(getTeachHome, 0);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!data || data.courses.length || autoClaimShown) return;
    if (readLoginIntent() !== 'teacher') return;
    autoClaimShown = true;
    onOpenClaim();
  }, [data, onOpenClaim]);

  const open = async (courseId: string) => {
    setBusy(courseId);
    try {
      onOpenClass((await openTeachClass(courseId)).classId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开班失败');
      setBusy(null);
    }
  };

  return (
    <PhonePage title="教学" overlay largeTitle onBack={onBack}>
      <div className="tp-page">
        <header className="phone-large-head tp-head">
          <h1>教学</h1>
          {data ? <span className="tp-term">{data.currentPeriod.label}</span> : null}
          <button type="button" className="tp-get-pill tp-claim-entry" onClick={onOpenClaim}>
            <Plus size={14} aria-hidden />
            认领课程
          </button>
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data && !data.courses.length ? (
          <div className="tp-claim-empty">
            <PhoneEmpty title="还没有认领课程" hint="认领你教的课，就能开班、上课。" />
            <button type="button" className="phone-confirm-button is-primary" onClick={onOpenClaim}>
              认领课程
            </button>
          </div>
        ) : null}
        {data?.courses.length ? (
          <>
            <p className="phone-group-title">我的课程</p>
            <div className="phone-group">
              {data.courses.map((course) => {
                const current = course.currentClass;
                const blocked = Boolean(current && !current.mine);
                return (
                  <div key={course.id} className="tp-course">
                    <button
                      type="button"
                      className="phone-row tp-course-row"
                      disabled={blocked || busy === course.id}
                      onClick={() =>
                        current?.liveSessionId && current.mine
                          ? onOpenSession(current.liveSessionId)
                          : void open(course.id)
                      }
                    >
                      <img
                        className="tp-course-marble"
                        src={resolveNativeCourseAvatar(course.id, course.courseCode)}
                        alt=""
                      />
                      <span className="tp-course-copy">
                        <strong>{courseLabel(course)}</strong>
                        <small>
                          {blocked
                            ? '本学期由其他老师带'
                            : current
                              ? `本学期 ${current.memberCount} 人`
                              : `${course.problemCount} 道题 · 还没开班`}
                        </small>
                      </span>
                      {current?.liveSessionId && current.mine ? (
                        <span className="tp-live-pill">上课中</span>
                      ) : !blocked ? (
                        <span className="tp-get-pill">{current ? '打开' : '开班'}</span>
                      ) : null}
                    </button>
                    {course.pastClasses.length ? (
                      <div className="tp-past">
                        {course.pastClasses.map((past) => (
                          <button key={past.id} type="button" onClick={() => onOpenClass(past.id)}>
                            {past.label} · {past.memberCount} 人
                            <ChevronRight size={12} aria-hidden />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </PhonePage>
  );
}

/** 认领课程：一门课只能由一位老师认领，先到先得，不用审批；自己认领的可以退出。 */
function TeachClaimView({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<TeachClaimableCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<TeachClaimableCourse | null>(null);

  const load = useCallback(async (text: string) => {
    try {
      setCourses(await getTeachClaimableCourses(text));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '没加载出来');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const act = async (course: TeachClaimableCourse, release: boolean) => {
    setBusy(course.id);
    setError(null);
    try {
      if (release) await releaseTeachCourse(course.id);
      else await claimTeachCourse(course.id);
      await load(query);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : release ? '退出失败' : '认领失败');
      await load(query);
    } finally {
      setBusy(null);
      setReleasing(null);
    }
  };

  const mine = courses?.filter((course) => course.claim === 'mine') ?? [];
  const others = courses?.filter((course) => course.claim !== 'mine') ?? [];

  const row = (course: TeachClaimableCourse) => (
    <div key={course.id} className="phone-row tp-course-row tp-claim-row">
      <img
        className="tp-course-marble"
        src={resolveNativeCourseAvatar(course.id, course.courseCode)}
        alt=""
      />
      <span className="tp-course-copy">
        <strong>{courseLabel(course)}</strong>
        <small>
          {[
            course.courseCode && course.name !== course.courseCode ? course.name : null,
            course.organizationName,
            `${course.problemCount} 道题`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      {course.claim === 'mine' ? (
        <button
          type="button"
          className="tp-get-pill is-quiet"
          disabled={busy === course.id}
          onClick={() => setReleasing(course)}
        >
          已认领
        </button>
      ) : course.claim === 'taken' ? (
        <span className="tp-claim-taken">已有老师</span>
      ) : (
        <button
          type="button"
          className="tp-get-pill"
          disabled={busy !== null}
          onClick={() => void act(course, false)}
        >
          {busy === course.id ? '认领中' : '认领'}
        </button>
      )}
    </div>
  );

  return (
    <PhonePage title="认领课程" overlay largeTitle onBack={onBack}>
      <div className="tp-page">
        <header className="phone-large-head tp-head">
          <h1>认领课程</h1>
        </header>
        <label className="phone-search tp-claim-search">
          <Search size={17} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜课号、课程名或机构"
            type="search"
          />
        </label>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!courses && !error ? <GlassSkeletonRows rows={5} height={54} /> : null}
        {mine.length ? (
          <>
            <p className="phone-group-title">我认领的</p>
            <div className="phone-group">{mine.map(row)}</div>
          </>
        ) : null}
        {courses && others.length ? (
          <>
            <p className="phone-group-title">{query ? '搜索结果' : '可以认领'}</p>
            <div className="phone-group">{others.map(row)}</div>
          </>
        ) : null}
        {courses && !courses.length ? (
          <PhoneEmpty title="没有找到课程" hint="换个课号或机构名试试。" />
        ) : null}
      </div>
      {releasing ? (
        <PhoneConfirm
          title="退出认领？"
          message={`${courseLabel(releasing)} 会回到可认领列表，已开的班和课堂记录保留。`}
          confirmLabel="退出"
          destructive
          busy={busy === releasing.id}
          onConfirm={() => void act(releasing, true)}
          onCancel={() => setReleasing(null)}
        />
      ) : null}
    </PhonePage>
  );
}

function TeachClassView({
  classId,
  onBack,
  onOpenSession,
}: {
  classId: string;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const load = useCallback(() => getTeachClass(classId), [classId]);
  const { data, setData, error, setError } = usePolled<TeachClass>(load, 20_000);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [chapterId, setChapterId] = useState('all');
  const [showVisitors, setShowVisitors] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const act = async (key: string, run: () => Promise<TeachClass>) => {
    setBusy(key);
    setError('');
    try {
      setData(await run());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy('');
    }
  };

  const chapters = useMemo(() => {
    const map = new Map<string, string>();
    for (const problem of data?.problems ?? []) {
      if (problem.chapter) map.set(problem.chapter.id, problem.chapter.name);
    }
    return [...map.entries()];
  }, [data?.problems]);
  const problems = useMemo(
    () =>
      (data?.problems ?? []).filter(
        (problem) => chapterId === 'all' || problem.chapter?.id === chapterId,
      ),
    [chapterId, data?.problems],
  );
  const progress = useMemo(
    () => new Map((data?.progress ?? []).map((row) => [`${row.userId}:${row.problemId}`, row])),
    [data?.progress],
  );
  const students = [
    ...(data?.roster ?? []).map((person) => ({ ...person, visitor: false })),
    ...(showVisitors ? (data?.visitors ?? []) : []).map((person) => ({ ...person, visitor: true })),
  ];
  const live = data?.sessions.find((session) => session.status === 'live');

  const start = async () => {
    if (live) return onOpenSession(live.id);
    setBusy('start');
    try {
      onOpenSession((await startTeachSession(classId)).sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开课失败');
      setBusy('');
    }
  };

  const addMember = (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    void act('add', async () => {
      const next = await teachClassAction({ action: 'add-member', classId, email: value });
      setEmail('');
      return next;
    });
  };

  return (
    <PhonePage
      title={data ? courseLabel(data.class.course) : '班级'}
      subtitle={data?.class.label}
      overlay
      wide
      largeTitle
      onBack={onBack}
    >
      <div className="tp-page">
        <header className="phone-large-head tp-head">
          <h1>{data ? courseLabel(data.class.course) : '班级'}</h1>
          {data ? <span className="tp-term">{data.class.label}</span> : null}
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={5} height={54} /> : null}
        {data ? (
          <>
            <section className="tp-hero">
              <div className="tp-hero-code">
                <small>班级码</small>
                <strong>{data.class.joinCode}</strong>
                <span className="tp-hero-tools">
                  <button
                    type="button"
                    aria-label="复制班级码"
                    onClick={() => {
                      void navigator.clipboard?.writeText(data.class.joinCode);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    }}
                  >
                    <Copy size={15} aria-hidden />
                    {copied ? '已复制' : null}
                  </button>
                  <button
                    type="button"
                    aria-label="换一个班级码"
                    disabled={busy === 'reset'}
                    onClick={() =>
                      void act('reset', () => teachClassAction({ action: 'reset-code', classId }))
                    }
                  >
                    <RefreshCw size={15} aria-hidden />
                  </button>
                </span>
                <p>学生输一次就进本学期的班</p>
              </div>
              <button
                type="button"
                className="tp-start"
                disabled={busy === 'start'}
                onClick={() => void start()}
              >
                {live ? '回到课堂' : '开始上课'}
              </button>
            </section>

            <form className="phone-search tp-add" onSubmit={addMember}>
              <UserPlus size={17} aria-hidden />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="用邮箱把学生拉进班"
                aria-label="学生邮箱"
              />
              {email ? (
                <button type="submit" className="tp-add-submit" disabled={busy === 'add'}>
                  添加
                </button>
              ) : null}
            </form>

            <div className="tp-section-head">
              <p className="phone-group-title">
                答题 · {data.roster.length} 人 · {problems.length} 题
              </p>
              <div className="tp-filters">
                {chapters.length ? (
                  <select
                    value={chapterId}
                    onChange={(event) => setChapterId(event.target.value)}
                    aria-label="章节"
                  >
                    <option value="all">全部章节</option>
                    {chapters.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : null}
                {data.visitors.length ? (
                  <button
                    type="button"
                    aria-pressed={showVisitors}
                    onClick={() => setShowVisitors((value) => !value)}
                  >
                    旁听 {data.visitors.length}
                  </button>
                ) : null}
              </div>
            </div>
            {students.length ? (
              <div className="phone-group tp-grid-card">
                <div className="tp-grid-scroll">
                  <table className="tp-grid">
                    <thead>
                      <tr>
                        <th className="tp-grid-name" />
                        {problems.map((problem) => (
                          <th key={problem.id} title={problemName(problem)}>
                            {problem.number ?? '·'}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((student) => {
                        const done = problems.filter((problem) =>
                          progress.has(`${student.userId}:${problem.id}`),
                        ).length;
                        return (
                          <tr key={student.userId}>
                            <th className="tp-grid-name">
                              <span>
                                <strong>{student.name}</strong>
                                <small>
                                  {student.visitor ? '旁听 · ' : ''}
                                  {done}/{problems.length}
                                </small>
                              </span>
                              {!student.visitor ? (
                                <button
                                  type="button"
                                  className="tp-remove"
                                  aria-label={`把 ${student.name} 移出班级`}
                                  onClick={() =>
                                    setRemoving({ userId: student.userId, name: student.name })
                                  }
                                >
                                  <X size={13} aria-hidden />
                                </button>
                              ) : null}
                            </th>
                            {problems.map((problem) => {
                              const row = progress.get(`${student.userId}:${problem.id}`);
                              return (
                                <td
                                  key={problem.id}
                                  title={`${problemName(problem)} · ${STATUS[row?.status ?? 'none'].label}${
                                    row ? ` · ${row.attemptedCount} 次` : ''
                                  }`}
                                >
                                  <Marble status={row?.status ?? 'none'} size={20} />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Legend />
              </div>
            ) : (
              <PhoneEmpty title="名单还是空的" hint="把班级码发给学生，或者用邮箱拉人。" />
            )}

            {data.sessions.length ? (
              <>
                <p className="phone-group-title">上过的课</p>
                <div className="phone-group">
                  {data.sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="phone-row"
                      onClick={() => onOpenSession(session.id)}
                    >
                      <span className="tp-course-copy">
                        <strong>{clock(session.startedAt)}</strong>
                        <small>
                          {session.participantCount} 人 · {session.itemCount} 题
                        </small>
                      </span>
                      {session.status === 'live' ? (
                        <span className="tp-live-pill">上课中</span>
                      ) : (
                        <ChevronRight size={16} className="tp-chevron" aria-hidden />
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {removing ? (
        <PhoneConfirm
          title={`把 ${removing.name} 移出班级？`}
          message="之后你就看不到 TA 的答题了，TA 可以用班级码再回来。"
          confirmLabel="移出"
          destructive
          busy={busy === 'remove'}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void act('remove', async () => {
              const next = await teachClassAction({
                action: 'remove-member',
                classId,
                userId: removing.userId,
              });
              setRemoving(null);
              return next;
            })
          }
        />
      ) : null}
    </PhonePage>
  );
}

function TeachSessionView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: (classId: string | null) => void;
}) {
  const load = useCallback(() => getTeachSession(sessionId), [sessionId]);
  const { data, setData, error, setError } = usePolled<TeachSession>(load, 3_000);
  const [busy, setBusy] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [picker, setPicker] = useState<TeachProblemChoice[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [ending, setEnding] = useState(false);

  const live = data?.session.status === 'live';
  const act = async (
    key: string,
    payload: Parameters<typeof teachSessionAction>[0],
  ): Promise<boolean> => {
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

  const openPicker = async () => {
    try {
      setPicker(await getTeachProblemChoices(sessionId));
      setSelected([]);
      setQuery('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取题目失败');
    }
  };

  const focus =
    data?.items.find((item) => item.id === focusId) ??
    [...(data?.items ?? [])].reverse().find((item) => !item.closedAt) ??
    data?.items.at(-1) ??
    null;
  const results = new Map(focus?.results.map((row) => [row.userId, row]) ?? []);
  const present = data?.participants.length ?? 0;
  const pushed = new Set(data?.items.map((item) => item.problemId) ?? []);
  const choices = (picker ?? []).filter((problem) => {
    const text = query.trim().toLowerCase();
    return (
      !text ||
      problemName(problem).toLowerCase().includes(text) ||
      Boolean(problem.chapter?.name.toLowerCase().includes(text))
    );
  });

  return (
    <PhonePage
      title={data ? courseLabel(data.session.course) : '上课'}
      overlay
      wide
      largeTitle
      onBack={() => onBack(data?.session.class.id ?? null)}
    >
      <div className="tp-page">
        <header className="phone-large-head tp-head">
          <h1>{live ? '上课中' : '课堂回看'}</h1>
          {data ? <span className="tp-term">{courseLabel(data.session.course)}</span> : null}
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data ? (
          <>
            <section className="tp-stage">
              <div className="tp-stage-code">
                {live ? (
                  <>
                    <small>课堂码</small>
                    <strong>{data.session.code}</strong>
                    <p>
                      {data.session.locked
                        ? '已锁门，只有本班的人还能进'
                        : '本班的人点一下就进，其他人输这 6 位数字'}
                    </p>
                  </>
                ) : (
                  <>
                    <small>已下课</small>
                    <strong className="is-ended">{clock(data.session.startedAt)}</strong>
                  </>
                )}
              </div>
              <div className="tp-stage-count">
                <strong>{present}</strong>
                <small>在场 · 名单 {data.session.class.rosterCount}</small>
              </div>
              {live ? (
                <div className="tp-stage-actions">
                  <button
                    type="button"
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
                  <button type="button" className="is-end" onClick={() => setEnding(true)}>
                    <Square size={14} aria-hidden />
                    下课
                  </button>
                </div>
              ) : null}
            </section>

            <div className="tp-board">
              <section>
                <div className="tp-section-head">
                  <p className="phone-group-title">发出的题</p>
                  {live ? (
                    <button type="button" className="tp-get-pill" onClick={() => void openPicker()}>
                      <Plus size={14} aria-hidden />
                      发题
                    </button>
                  ) : null}
                </div>
                {data.items.length ? (
                  <div className="phone-group">
                    {data.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="phone-row tp-item"
                        aria-pressed={focus?.id === item.id}
                        onClick={() => setFocusId(item.id)}
                      >
                        <span className="tp-course-copy">
                          <strong>{problemName(item)}</strong>
                          <small>
                            {item.closedAt ? '已收卷' : '作答中'} · 交了 {item.submittedCount}/
                            {present}
                          </small>
                        </span>
                        <span className="tp-meter" aria-hidden>
                          <i
                            className="is-passed"
                            style={{ width: `${(item.passedCount / Math.max(present, 1)) * 100}%` }}
                          />
                          <i
                            className="is-other"
                            style={{
                              width: `${((item.submittedCount - item.passedCount) / Math.max(present, 1)) * 100}%`,
                            }}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <PhoneEmpty
                    title={live ? '还没发题' : '这节课没有发题'}
                    hint={
                      live
                        ? '点「发题」，从题库里挑题发给在场的人。'
                        : '下次上课时可以从题库里发题。'
                    }
                  />
                )}
              </section>

              <section className="tp-focus">
                {focus ? (
                  <>
                    <div className="tp-section-head">
                      <p className="phone-group-title">{problemName(focus)}</p>
                      <div className="tp-focus-actions">
                        {live ? (
                          focus.closedAt ? (
                            <button
                              type="button"
                              onClick={() =>
                                void act('reopen', {
                                  action: 'reopen',
                                  sessionId,
                                  itemId: focus.id,
                                })
                              }
                            >
                              <RotateCcw size={14} aria-hidden />
                              继续作答
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                void act('close', { action: 'close', sessionId, itemId: focus.id })
                              }
                            >
                              <Square size={13} aria-hidden />
                              收卷
                            </button>
                          )
                        ) : null}
                        {focus.answerRevealedAt ? (
                          <span className="tp-revealed">已公布答案</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void act('reveal', { action: 'reveal', sessionId, itemId: focus.id })
                            }
                          >
                            <Eye size={14} aria-hidden />
                            公布答案
                          </button>
                        )}
                        {live && !focus.submittedCount ? (
                          <button
                            type="button"
                            aria-label="撤回这道题"
                            onClick={() =>
                              void act('remove', { action: 'remove', sessionId, itemId: focus.id })
                            }
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="tp-stats">
                      <div>
                        <strong>
                          {focus.submittedCount}
                          <small>/{present}</small>
                        </strong>
                        <span>已交</span>
                      </div>
                      <div>
                        <strong>
                          {focus.submittedCount
                            ? `${Math.round((focus.passedCount / focus.submittedCount) * 100)}%`
                            : '—'}
                        </strong>
                        <span>正确率</span>
                      </div>
                      <div>
                        <strong>{Math.max(0, present - focus.submittedCount)}</strong>
                        <span>没交</span>
                      </div>
                    </div>
                    <div className="tp-people">
                      {data.participants.map((person) => {
                        const row = results.get(person.userId);
                        const status = row?.status ?? 'none';
                        return (
                          <div key={person.userId} className="tp-person" data-status={status}>
                            <Marble status={status} size={26} />
                            <span>
                              <strong>{person.name}</strong>
                              <small>
                                {STATUS[status].label}
                                {row && row.attempts > 1 ? ` · ${row.attempts} 次` : ''}
                              </small>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <Legend />
                  </>
                ) : (
                  <>
                    <p className="phone-group-title">在场的人</p>
                    {data.participants.length ? (
                      <div className="tp-people">
                        {data.participants.map((person) => (
                          <div key={person.userId} className="tp-person">
                            <Marble status="none" size={26} />
                            <span>
                              <strong>{person.name}</strong>
                              <small>{person.via === 'code' ? '旁听' : '本班'}</small>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <PhoneEmpty
                        title="还没有人进来"
                        hint="让学生在网页版、iPad 或电脑 App 里点「上课」，输课堂码。"
                      />
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>

      {picker ? (
        <div className="phone-confirm-layer tp-sheet-layer" role="presentation">
          <button
            type="button"
            className="phone-confirm-backdrop"
            aria-label="关闭"
            onClick={() => setPicker(null)}
          />
          <section className="tp-sheet" role="dialog" aria-modal="true" aria-label="发题">
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
              {choices.map((problem) => {
                const checked = selected.includes(problem.id);
                return (
                  <button
                    key={problem.id}
                    type="button"
                    className="phone-row tp-choice"
                    aria-pressed={checked}
                    onClick={() =>
                      setSelected((current) =>
                        checked
                          ? current.filter((id) => id !== problem.id)
                          : [...current, problem.id],
                      )
                    }
                  >
                    <span className="tp-check" aria-hidden />
                    <span className="tp-course-copy">
                      <strong>{problemName(problem)}</strong>
                      <small>
                        {problem.chapter?.name ?? '未分章节'}
                        {pushed.has(problem.id) ? ' · 发过，再发会重新计时' : ''}
                      </small>
                    </span>
                  </button>
                );
              })}
              {!choices.length ? <PhoneEmpty title="没有找到题目" hint="换个关键词试试。" /> : null}
            </div>
            <footer className="tp-sheet-foot">
              <button
                type="button"
                className="phone-confirm-button"
                onClick={() => setPicker(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="phone-confirm-button is-primary"
                disabled={!selected.length || busy === 'push'}
                onClick={async () => {
                  if (await act('push', { action: 'push', sessionId, problemIds: selected })) {
                    setPicker(null);
                    setFocusId(null);
                  }
                }}
              >
                {selected.length ? `发出 ${selected.length} 题` : '发题'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {ending ? (
        <PhoneConfirm
          title="下课？"
          message="课堂码会失效，还没收的题会自动收卷。"
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
    </PhonePage>
  );
}
