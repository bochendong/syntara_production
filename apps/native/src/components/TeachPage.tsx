import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import {
  Bell,
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

import { profileThemeForAvatar, resolveNativeCourseAvatar } from '../assets';
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
import { TeachCourseView } from './TeachCourseView';
import { CoursePublishDialog } from './CoursePublishDialog';

/**
 * 「教学」页（网页版、iPad、电脑 App；手机没有）：老师的班级和上课。
 * 一门课每学期一个班。上课时给出 6 位课堂码，发出的题只统计这节课在场的人。
 */

type View =
  | { kind: 'home' }
  | { kind: 'course'; courseId: string }
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
  return course.name.trim() || course.courseCode?.trim() || '';
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

export function TeachPage({
  onBack,
  mode = 'teaching',
  onJoinClass,
  onCourseChanged,
}: {
  onBack: () => void;
  mode?: 'teaching' | 'classroom';
  onJoinClass?: () => void;
  onCourseChanged?: () => Promise<void> | void;
}) {
  const [view, setView] = useState<View>({ kind: 'home' });
  if (view.kind === 'course')
    return (
      <TeachCourseView
        key={view.courseId}
        courseId={view.courseId}
        onBack={() => setView({ kind: 'home' })}
        onCourseChanged={onCourseChanged}
      />
    );
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
  if (mode === 'classroom')
    return (
      <ClassroomHomeView
        onBack={onBack}
        onJoinClass={onJoinClass}
        onOpenClass={(classId) => setView({ kind: 'class', classId })}
      />
    );
  return (
    <TeachHomeView
      onBack={onBack}
      onOpenCourse={(courseId) => setView({ kind: 'course', courseId })}
      onOpenClaim={() => setView({ kind: 'claim' })}
    />
  );
}

// 老师登录后第一次进教学页、还没有课时，直接进认领页（只自动跳一次）。
let autoClaimShown = false;

function TeachHomeView({
  onBack,
  onOpenCourse,
  onOpenClaim,
}: {
  onBack: () => void;
  onOpenCourse: (courseId: string) => void;
  onOpenClaim: () => void;
}) {
  const { data, error, reload } = usePolled<TeachHome>(getTeachHome, 30_000);
  const [publishingCourseId, setPublishingCourseId] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<TeachHome['courses'][number] | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState('');
  const release = async () => {
    if (!releasing) return;
    setReleaseBusy(true);
    setReleaseError('');
    try {
      await releaseTeachCourse(releasing.id);
      setReleasing(null);
      await reload();
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : '退出失败');
    } finally {
      setReleaseBusy(false);
    }
  };
  useEffect(() => {
    if (!data || data.courses.length || autoClaimShown || readLoginIntent() !== 'teacher') return;
    autoClaimShown = true;
    onOpenClaim();
  }, [data, onOpenClaim]);

  return (
    <PhonePage title="教学" overlay largeTitle onBack={onBack}>
      <div className="tp-page">
        <header className="phone-large-head tp-head tp-teaching-head">
          <h1>教学</h1>
          <button type="button" className="tp-get-pill tp-claim-entry" onClick={onOpenClaim}>
            <Plus size={14} aria-hidden />
            认领课程
          </button>
        </header>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {releaseError ? (
          <p className="phone-page-error" role="alert">
            {releaseError}
          </p>
        ) : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data && !data.courses.length ? (
          <div className="tp-claim-empty">
            <PhoneEmpty title="还没有认领课程" hint="认领你教的课，就可以在这里管理课程。" />
            <button type="button" className="phone-confirm-button is-primary" onClick={onOpenClaim}>
              认领课程
            </button>
          </div>
        ) : null}
        {data?.courses.length ? (
          <>
            <div className="tp-courses-heading">
              <h2>我管理的课程</h2>
              <span>{data.courses.length} 门课程</span>
            </div>
            <div className="tp-course-grid">
              {data.courses.map((course) => {
                const avatar = resolveNativeCourseAvatar(
                  course.id,
                  course.courseCode,
                  course.avatarUrl,
                );
                const scene = profileThemeForAvatar(avatar)?.backgroundUrl;
                return (
                  <article
                    key={course.id}
                    className={`tp-course-card${scene ? ' has-course-scene' : ''}`}
                    aria-label={courseLabel(course)}
                    style={
                      scene
                        ? ({ '--tp-card-scene': `url(${JSON.stringify(scene)})` } as CSSProperties)
                        : undefined
                    }
                  >
                    <div className="tp-course-card-identity">
                      <button
                        type="button"
                        className="tp-course-card-head tp-course-card-select"
                        aria-label={`管理课程：${courseLabel(course)}`}
                        onClick={() => onOpenCourse(course.id)}
                      >
                        <img className="tp-course-marble" src={avatar} alt="" />
                        <div className="tp-course-card-title">
                          <h3>{courseLabel(course)}</h3>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="tp-course-notifications"
                        aria-label={`${courseLabel(course)}的加入申请，${course.pendingApplications} 人等你同意`}
                        title="查看加入申请"
                        onClick={() => onOpenCourse(course.id)}
                      >
                        <Bell size={18} aria-hidden />
                        {course.pendingApplications > 0 ? (
                          <span className="tp-course-notification-count" aria-hidden>
                            {course.pendingApplications > 99 ? '99+' : course.pendingApplications}
                          </span>
                        ) : null}
                      </button>
                    </div>
                    <dl className="tp-course-card-stats">
                      <div>
                        <dt>题库</dt>
                        <dd>
                          {course.problemCount}
                          <span> 道题</span>
                        </dd>
                      </div>
                      <div>
                        <dt>笔记</dt>
                        <dd>
                          {course.notebookCount}
                          <span> 本</span>
                        </dd>
                      </div>
                      <div>
                        <dt>已添加</dt>
                        <dd>
                          {course.learnerCount}
                          <span> 人</span>
                        </dd>
                      </div>
                    </dl>
                    <div className="tp-course-card-footer">
                      <div className="tp-course-card-actions">
                        {course.claimedByMe ? (
                          <button
                            type="button"
                            className="tp-course-card-publish"
                            aria-label={`退出认领：${courseLabel(course)}`}
                            onClick={() => {
                              setReleaseError('');
                              setReleasing(course);
                            }}
                          >
                            退出认领
                          </button>
                        ) : null}
                        {course.canPublish ? (
                          <button
                            type="button"
                            className="tp-course-card-publish"
                            aria-label={`${course.listed ? '发布设置' : '发布'}：${courseLabel(course)}`}
                            onClick={() => setPublishingCourseId(course.id)}
                          >
                            {course.listed ? '发布设置' : '发布'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="tp-course-card-open"
                          aria-label={`查看课程：${courseLabel(course)}`}
                          onClick={() => onOpenCourse(course.id)}
                        >
                          管理课程
                          <ChevronRight size={15} aria-hidden />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
      {releasing ? (
        <PhoneConfirm
          title="退出认领？"
          message={`${courseLabel(releasing)} 会回到可认领列表，已开的班和课堂记录保留。`}
          confirmLabel="退出"
          destructive
          busy={releaseBusy}
          onConfirm={() => void release()}
          onCancel={() => setReleasing(null)}
        />
      ) : null}
      {publishingCourseId ? (
        <CoursePublishDialog
          courseId={publishingCourseId}
          onClose={() => setPublishingCourseId(null)}
          onPublished={async () => {
            setPublishingCourseId(null);
            await reload();
          }}
        />
      ) : null}
    </PhonePage>
  );
}

function ClassroomHomeView({
  onBack,
  onJoinClass,
  onOpenClass,
}: {
  onBack: () => void;
  onJoinClass?: () => void;
  onOpenClass: (classId: string) => void;
}) {
  const { data, error } = usePolled<TeachHome>(getTeachHome, 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const publishedCourses = data?.courses.filter((course) => course.listed) ?? [];
  return (
    <PhonePage title="上课" overlay largeTitle onBack={onBack}>
      <div className="tp-page">
        <header className="phone-large-head tp-head">
          <h1>上课</h1>
          {data ? <span className="tp-term">{data.currentPeriod.label}</span> : null}
        </header>
        <div className="tp-courses-heading">
          <h2>我的班级</h2>
          {onJoinClass ? (
            <button type="button" className="tp-course-card-publish" onClick={onJoinClass}>
              输入课堂码 / 班级码
            </button>
          ) : null}
        </div>
        {error || actionError ? (
          <p className="phone-page-error" role="alert">
            {actionError || error}
          </p>
        ) : null}
        {!data && !error ? <GlassSkeletonRows rows={4} height={54} /> : null}
        {data && !publishedCourses.length ? (
          <PhoneEmpty
            title="暂无可开班的课程"
            hint="发布课程或由管理员分配已发布的课程后，可以在这里开班。"
          />
        ) : null}
        <div className="tp-course-grid">
          {publishedCourses.map((course) => {
            const current = course.currentClass;
            const blocked = Boolean(current && !current.mine);
            return (
              <article key={course.id} className="tp-course-card" aria-label={courseLabel(course)}>
                <div className="tp-course-card-head">
                  <img
                    className="tp-course-marble"
                    src={resolveNativeCourseAvatar(course.id, course.courseCode, course.avatarUrl)}
                    alt=""
                  />
                  <div className="tp-course-card-title">
                    <h3>{courseLabel(course)}</h3>
                    <p>{current ? `${current.memberCount} 位学生` : '课程班级'}</p>
                  </div>
                </div>
                <div className="tp-course-card-footer">
                  <span className={current?.mine ? 'tp-course-state is-ready' : 'tp-course-state'}>
                    {current?.liveSessionId && current.mine
                      ? '上课中'
                      : blocked
                        ? '本学期由其他老师带'
                        : current
                          ? '本学期已开班'
                          : '本学期未开班'}
                  </span>
                  <button
                    type="button"
                    className="tp-course-card-open"
                    disabled={blocked || Boolean(busy)}
                    onClick={async () => {
                      setBusy(course.id);
                      setActionError('');
                      try {
                        onOpenClass((await openTeachClass(course.id)).classId);
                      } catch (cause) {
                        setActionError(cause instanceof Error ? cause.message : '开班失败');
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === course.id ? '正在打开…' : current ? '打开班级' : '开班'}{' '}
                    <ChevronRight size={15} aria-hidden />
                  </button>
                </div>
                {course.pastClasses.length ? (
                  <div className="tp-past">
                    {course.pastClasses.map((past) => (
                      <button key={past.id} type="button" onClick={() => onOpenClass(past.id)}>
                        {past.label} · {past.memberCount} 人<ChevronRight size={12} aria-hidden />
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </PhonePage>
  );
}

/** 认领列表只显示无人认领的课程；退出认领在「我管理的课程」里操作。 */
function TeachClaimView({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<TeachClaimableCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (text: string) => {
    try {
      setCourses(
        (await getTeachClaimableCourses(text)).filter((course) => course.claim === 'free'),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '没加载出来');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const act = async (course: TeachClaimableCourse) => {
    setBusy(course.id);
    setError(null);
    try {
      await claimTeachCourse(course.id);
      await load(query);
    } catch (cause) {
      await load(query);
      setError(cause instanceof Error ? cause.message : '认领失败');
    } finally {
      setBusy(null);
    }
  };

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
      <button
        type="button"
        className="tp-get-pill"
        disabled={busy !== null}
        onClick={() => void act(course)}
      >
        {busy === course.id ? '认领中' : '认领'}
      </button>
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
        {courses?.length ? (
          <>
            <p className="phone-group-title">{query ? '搜索结果' : '可以认领'}</p>
            <div className="phone-group">{courses.map(row)}</div>
          </>
        ) : null}
        {courses && !courses.length ? (
          <PhoneEmpty
            title={query ? '没有找到可认领课程' : '暂无可认领课程'}
            hint={query ? '换个课号或机构名试试。' : '已被认领的课程不会显示在这里。'}
          />
        ) : null}
      </div>
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
