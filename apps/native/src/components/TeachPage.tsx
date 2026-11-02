import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  Eye,
  Lock,
  LockOpen,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';

import { nativeAccountAvatarUrl, resolveNativeCourseAvatar } from '../assets';
import {
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
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneConfirm, PhoneEmpty, PhonePage } from './PhonePages';
import './teach-page.css';

/**
 * 「教学」页（网页版、iPad、电脑 App；手机没有）：老师的班级和上课。
 * 一门课每学期一个班。上课时给出 6 位课堂码，发出的题只统计这节课在场的人。
 */

type View =
  | { kind: 'home' }
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
    />
  );
}

function TeachHomeView({
  onBack,
  onOpenClass,
  onOpenSession,
}: {
  onBack: () => void;
  onOpenClass: (classId: string) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { data, error, setError } = usePolled<TeachHome>(getTeachHome, 0);
  const [busy, setBusy] = useState<string | null>(null);

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
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data && !data.courses.length ? (
          <PhoneEmpty
            title="还没有可以开班的课程"
            hint="机构把你加为课程所属机构的成员后，这里会出现对应课程。"
          />
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

type ClassTab = 'answers' | 'people' | 'sessions';

/** 学生头像：账号上有弹珠头像就用，没有就按 userId 固定挑一颗。 */
function personAvatar(person: { userId: string; avatarUrl: string | null }) {
  return person.avatarUrl
    ? nativeAccountAvatarUrl(null, person.avatarUrl)
    : resolveNativeCourseAvatar(person.userId, null);
}

function percent(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function duration(session: { startedAt: number; endedAt: number | null }) {
  if (!session.endedAt) return '';
  const minutes = Math.max(1, Math.round((session.endedAt - session.startedAt) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
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
  const [tab, setTab] = useState<ClassTab>('answers');
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
  const roster = data?.roster ?? [];
  const students = [
    ...roster.map((person) => ({ ...person, visitor: false })),
    ...(showVisitors ? (data?.visitors ?? []) : []).map((person) => ({ ...person, visitor: true })),
  ];
  const live = data?.sessions.find((session) => session.status === 'live');
  const pastSessions = data?.sessions.filter((session) => session.status !== 'live') ?? [];

  // 本班（不含旁听）做过 / 做对了多少，全部题目算。
  const summary = useMemo(() => {
    const members = new Set(roster.map((person) => person.userId));
    const all = data?.problems.length ?? 0;
    let done = 0;
    let passed = 0;
    for (const row of data?.progress ?? []) {
      if (!members.has(row.userId)) continue;
      done += 1;
      if (row.status === 'passed') passed += 1;
    }
    return {
      done: percent(done, members.size * all),
      passed: percent(passed, done),
    };
  }, [data?.problems.length, data?.progress, roster]);

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

  const copyCode = () => {
    if (!data) return;
    void navigator.clipboard?.writeText(data.class.joinCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const tabs: Array<{ id: ClassTab; label: string; count: number }> = [
    { id: 'answers', label: '答题', count: data?.problems.length ?? 0 },
    { id: 'people', label: '学生', count: roster.length },
    { id: 'sessions', label: '课堂', count: data?.sessions.length ?? 0 },
  ];

  return (
    <PhonePage
      title={data ? courseLabel(data.class.course) : '班级'}
      subtitle={data?.class.label}
      overlay
      wide
      largeTitle
      onBack={onBack}
    >
      <div className="tp-page tc-page">
        <header className="phone-large-head tc-head">
          {data ? (
            <img
              className="tc-head-marble"
              src={resolveNativeCourseAvatar(data.class.course.id, data.class.course.courseCode)}
              alt=""
            />
          ) : null}
          <div className="tc-head-copy">
            <h1>{data ? courseLabel(data.class.course) : '班级'}</h1>
            {data ? (
              <span>
                {data.class.course.courseCode ? `${data.class.course.name} · ` : ''}
                {data.class.label}
              </span>
            ) : null}
          </div>
          {data ? (
            <button
              type="button"
              className={`tc-start${live ? ' is-live' : ''}`}
              disabled={busy === 'start'}
              onClick={() => void start()}
            >
              {live ? (
                <span className="tc-live-dot" aria-hidden />
              ) : (
                <Radio size={17} aria-hidden />
              )}
              {live ? '回到课堂' : '开始上课'}
            </button>
          ) : null}
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {!data && !error ? <GlassSkeletonRows rows={5} height={54} /> : null}
        {data ? (
          <>
            <section className="tc-overview">
              <div className="tc-code">
                <small>班级码 · 学生输一次就进班</small>
                <div className="tc-code-row">
                  <div className="tc-code-keys" aria-label={`班级码 ${data.class.joinCode}`}>
                    {data.class.joinCode.split('').map((char, index) => (
                      <span key={index}>{char}</span>
                    ))}
                  </div>
                  <div className="tc-code-tools">
                    <button type="button" onClick={copyCode} aria-label="复制班级码">
                      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                      {copied ? '已复制' : '复制'}
                    </button>
                    <button
                      type="button"
                      aria-label="换一个班级码"
                      title="换一个班级码"
                      disabled={busy === 'reset'}
                      onClick={() =>
                        void act('reset', () => teachClassAction({ action: 'reset-code', classId }))
                      }
                    >
                      <RefreshCw
                        size={15}
                        aria-hidden
                        className={busy === 'reset' ? 'is-spinning' : ''}
                      />
                    </button>
                  </div>
                </div>
              </div>
              <button type="button" className="tc-stat" onClick={() => setTab('people')}>
                <span className="tc-stack" aria-hidden>
                  {roster.length ? (
                    roster
                      .slice(0, 4)
                      .map((person) => (
                        <img key={person.userId} src={personAvatar(person)} alt="" />
                      ))
                  ) : (
                    <span className="tp-marble is-empty" style={{ width: 26, height: 26 }} />
                  )}
                </span>
                <strong>{roster.length}</strong>
                <small>学生{data.visitors.length ? ` · 旁听 ${data.visitors.length}` : ''}</small>
              </button>
              <button type="button" className="tc-stat" onClick={() => setTab('answers')}>
                <span className="tc-tube" aria-hidden>
                  <i style={{ width: `${summary.done}%` }} />
                </span>
                <strong>
                  {summary.done}
                  <em>%</em>
                </strong>
                <small>完成 · 对 {summary.passed}%</small>
              </button>
              <button type="button" className="tc-stat" onClick={() => setTab('sessions')}>
                <span className="tc-stat-icon" aria-hidden>
                  {live ? <span className="tc-live-dot" /> : <Radio size={16} />}
                </span>
                <strong>{data.sessions.length}</strong>
                <small>节课{live ? ' · 上课中' : ''}</small>
              </button>
            </section>

            <div className="tc-tabs" role="tablist" aria-label="班级">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  <span>{item.count}</span>
                </button>
              ))}
            </div>

            {tab === 'answers' ? (
              <section role="tabpanel" aria-label="答题">
                {students.length && (chapters.length || data.visitors.length) ? (
                  <div className="tc-chips">
                    {chapters.length ? (
                      <>
                        <button
                          type="button"
                          aria-pressed={chapterId === 'all'}
                          onClick={() => setChapterId('all')}
                        >
                          全部
                        </button>
                        {chapters.map(([id, name]) => (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={chapterId === id}
                            onClick={() => setChapterId(id)}
                          >
                            {name}
                          </button>
                        ))}
                      </>
                    ) : null}
                    {data.visitors.length ? (
                      <button
                        type="button"
                        className="tc-chip-end"
                        aria-pressed={showVisitors}
                        onClick={() => setShowVisitors((value) => !value)}
                      >
                        <Eye size={13} aria-hidden />
                        旁听 {data.visitors.length}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {students.length && problems.length ? (
                  <div className="tc-card tc-grid-card">
                    <div className="tc-grid-scroll">
                      <table className="tc-grid">
                        <thead>
                          <tr>
                            <th className="tc-grid-name">
                              <span>{students.length} 人</span>
                            </th>
                            {problems.map((problem) => {
                              const passed = roster.filter(
                                (person) =>
                                  progress.get(`${person.userId}:${problem.id}`)?.status ===
                                  'passed',
                              ).length;
                              const rate = percent(passed, roster.length);
                              return (
                                <th
                                  key={problem.id}
                                  title={`${problemName(problem)} · 做对 ${passed}/${roster.length}`}
                                >
                                  <span className="tc-col-num">{problem.number ?? '·'}</span>
                                  <span className="tc-col-rate" aria-hidden>
                                    <i style={{ height: `${Math.max(rate, passed ? 8 : 0)}%` }} />
                                  </span>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((student) => {
                            const done = problems.filter((problem) =>
                              progress.has(`${student.userId}:${problem.id}`),
                            ).length;
                            return (
                              <tr
                                key={student.userId}
                                className={student.visitor ? 'is-visitor' : ''}
                              >
                                <th className="tc-grid-name">
                                  <span className="tc-person">
                                    <img src={personAvatar(student)} alt="" />
                                    <span>
                                      <strong>{student.name}</strong>
                                      <small>
                                        {student.visitor ? '旁听 · ' : ''}
                                        {done}/{problems.length}
                                      </small>
                                    </span>
                                  </span>
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
                                      <Marble status={row?.status ?? 'none'} size={22} />
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
                ) : students.length ? (
                  <PhoneEmpty
                    title="这门课还没有题"
                    hint="在课程的题库里加题后，这里按人按题显示。"
                  />
                ) : (
                  <PhoneEmpty
                    title="名单还是空的"
                    hint="把班级码发给学生，或者在「学生」里用邮箱拉人。"
                  />
                )}
              </section>
            ) : null}

            {tab === 'people' ? (
              <section role="tabpanel" aria-label="学生">
                <form className="tc-add" onSubmit={addMember}>
                  <UserPlus size={17} aria-hidden />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    placeholder="学生邮箱"
                    aria-label="学生邮箱"
                  />
                  <button type="submit" disabled={!email.trim() || busy === 'add'}>
                    <Plus size={15} aria-hidden />
                    拉进班
                  </button>
                </form>
                {roster.length ? (
                  <div className="tc-card tc-people">
                    {roster.map((person) => {
                      const done = (data.problems ?? []).filter((problem) =>
                        progress.has(`${person.userId}:${problem.id}`),
                      ).length;
                      const share = percent(done, data.problems.length);
                      return (
                        <div key={person.userId} className="tc-person-row">
                          <img src={personAvatar(person)} alt="" />
                          <span className="tc-person-copy">
                            <strong>{person.name}</strong>
                            <small>
                              {person.email ??
                                (person.source === 'teacher' ? '老师拉进班' : '班级码进班')}
                            </small>
                          </span>
                          <span
                            className="tc-person-meter"
                            title={`做过 ${done}/${data.problems.length}`}
                          >
                            <span className="tc-tube is-thin" aria-hidden>
                              <i style={{ width: `${share}%` }} />
                            </span>
                            <small>{share}%</small>
                          </span>
                          <button
                            type="button"
                            className="tc-icon-button is-danger"
                            aria-label={`把 ${person.name} 移出班级`}
                            title="移出班级"
                            onClick={() =>
                              setRemoving({ userId: person.userId, name: person.name })
                            }
                          >
                            <UserMinus size={16} aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <PhoneEmpty title="名单还是空的" hint="学生输入班级码就会出现在这里。" />
                )}
                {data.visitors.length ? (
                  <>
                    <p className="phone-group-title">旁听</p>
                    <div className="tc-card tc-people">
                      {data.visitors.map((person) => (
                        <div key={person.userId} className="tc-person-row is-visitor">
                          <img src={personAvatar(person)} alt="" />
                          <span className="tc-person-copy">
                            <strong>{person.name}</strong>
                            <small>进过课堂，不在名单里</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}

            {tab === 'sessions' ? (
              <section role="tabpanel" aria-label="课堂">
                {live ? (
                  <button type="button" className="tc-live" onClick={() => onOpenSession(live.id)}>
                    <span className="tc-live-copy">
                      <small>
                        <span className="tc-live-dot" aria-hidden />
                        上课中 · {clock(live.startedAt)}
                      </small>
                      <strong>{live.code ?? '—'}</strong>
                    </span>
                    <span className="tc-live-stats">
                      <span>
                        <strong>{live.participantCount}</strong>
                        <small>人</small>
                      </span>
                      <span>
                        <strong>{live.itemCount}</strong>
                        <small>题</small>
                      </span>
                    </span>
                    <ChevronRight size={20} aria-hidden />
                  </button>
                ) : null}
                {pastSessions.length ? (
                  <div className="tc-card">
                    {pastSessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className="tc-session-row"
                        onClick={() => onOpenSession(session.id)}
                      >
                        <span className="tc-session-date">
                          <strong>{new Date(session.startedAt).getDate()}</strong>
                          <small>{new Date(session.startedAt).getMonth() + 1} 月</small>
                        </span>
                        <span className="tc-person-copy">
                          <strong>{clock(session.startedAt)}</strong>
                          <small>{duration(session)}</small>
                        </span>
                        <span className="tc-session-meta">
                          <span>{session.participantCount} 人</span>
                          <span>{session.itemCount} 题</span>
                        </span>
                        <ChevronRight size={16} className="tp-chevron" aria-hidden />
                      </button>
                    ))}
                  </div>
                ) : !live ? (
                  <PhoneEmpty
                    title="还没上过课"
                    hint="点右上角「开始上课」，学生用 6 位课堂码进来。"
                  />
                ) : null}
              </section>
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
