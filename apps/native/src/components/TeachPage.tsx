import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  Download,
  Plus,
  RefreshCw,
  Search,
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
  createTeachDraft,
  deleteTeachEndedSession,
  getTeachClass,
  getTeachHome,
  getTeachImportSources,
  openTeachClass,
  startTeachSession,
  teachClassAction,
  type TeachClass,
  type TeachHome,
  type TeachImportClass,
} from '../data/platform-api-client';
import { readLoginIntent } from '../lib/login-intent';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneConfirm, PhoneEmpty, PhonePage } from './PhonePages';
import { classSessionLabel } from '../lib/class-session-label';
import './teach-page.css';
import { TeachCourseView } from './TeachCourseView';
import { TeachSessionView } from './TeachSessionView';
import { CoursePublishDialog } from './CoursePublishDialog';
import {
  clock,
  courseLabel,
  Legend,
  Marble,
  problemName,
  teachResultStatus,
  usePolled,
} from './teach-shared';

/**
 * 「教学」页（网页版、iPad、电脑 App；手机没有）：老师的班级和上课。
 * 一门课每学期一个班，一个班有很多节课：可以提前备课，也可以直接开始。
 */

type View =
  | { kind: 'home' }
  | { kind: 'course'; courseId: string }
  | { kind: 'claim' }
  | { kind: 'class'; classId: string }
  | { kind: 'session'; sessionId: string; classId: string | null };

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
    return (
      <TeachClaimView onBack={() => setView({ kind: 'home' })} onCourseChanged={onCourseChanged} />
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
      onCourseChanged={onCourseChanged}
    />
  );
}

// 老师登录后第一次进教学页、还没有课时，直接进认领页（只自动跳一次）。
let autoClaimShown = false;

function TeachHomeView({
  onBack,
  onOpenCourse,
  onOpenClaim,
  onCourseChanged,
}: {
  onBack: () => void;
  onOpenCourse: (courseId: string) => void;
  onOpenClaim: () => void;
  onCourseChanged?: () => Promise<void> | void;
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
      await onCourseChanged?.();
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
function TeachClaimView({
  onBack,
  onCourseChanged,
}: {
  onBack: () => void;
  onCourseChanged?: () => Promise<void> | void;
}) {
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
      await onCourseChanged?.();
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
  const [tab, setTab] = useState<'sessions' | 'students'>('sessions');
  const [busy, setBusy] = useState('');
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<TeachClass['sessions'][number] | null>(null);
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

  const open = async (key: string, run: () => Promise<{ sessionId: string }>) => {
    setBusy(key);
    setError('');
    try {
      onOpenSession((await run()).sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
      setBusy('');
    }
  };

  const sessions = data?.sessions ?? [];
  const live = sessions.find((session) => session.status === 'live');
  const drafts = sessions.filter((session) => session.status === 'draft').reverse();
  const past = sessions.filter((session) => session.status === 'ended');
  const nextNumber =
    data?.nextSessionNumber ?? Math.max(0, ...sessions.map((session) => session.number)) + 1;

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
              </div>
              <button
                type="button"
                className="tp-start"
                disabled={busy === 'start'}
                onClick={() =>
                  live
                    ? onOpenSession(live.id)
                    : void open('start', () => startTeachSession(classId))
                }
              >
                {live ? `回到${classSessionLabel(live)}` : `开始第 ${nextNumber} 节`}
              </button>
            </section>

            <div className="ts-tabs" role="group" aria-label="班级内容">
              <button
                type="button"
                aria-pressed={tab === 'sessions'}
                onClick={() => setTab('sessions')}
              >
                节课
              </button>
              <button
                type="button"
                aria-pressed={tab === 'students'}
                onClick={() => setTab('students')}
              >
                学生 {data.roster.length}
              </button>
            </div>

            {tab === 'sessions' ? (
              <>
                {live ? (
                  <button
                    type="button"
                    className="tl-banner tp-live-row"
                    onClick={() => onOpenSession(live.id)}
                  >
                    <span className="tl-dot" aria-hidden />
                    正在上课 · {classSessionLabel(live)} · {live.participantCount} 人在场
                    <ChevronRight size={16} aria-hidden />
                  </button>
                ) : null}

                <div className="tp-section-head">
                  <p className="phone-group-title">备课</p>
                  <div className="tp-session-tools">
                    <button type="button" className="ts-pill" onClick={() => setImporting(true)}>
                      <Download size={14} aria-hidden />
                      从往届导入
                    </button>
                    <button
                      type="button"
                      className="ts-pill"
                      disabled={busy === 'draft'}
                      onClick={() => void open('draft', () => createTeachDraft(classId))}
                    >
                      <Plus size={15} aria-hidden />
                      新建
                    </button>
                  </div>
                </div>
                {drafts.length ? (
                  <div className="phone-group">
                    {drafts.map((session) => (
                      <div key={session.id} className="tp-session-row">
                        <button
                          type="button"
                          className="phone-row"
                          onClick={() => onOpenSession(session.id)}
                        >
                          <span className="tp-course-copy">
                            <strong>{classSessionLabel(session)}</strong>
                            <small>{session.itemCount} 题</small>
                          </span>
                          <ChevronRight size={16} className="tp-chevron" aria-hidden />
                        </button>
                        {!live ? (
                          <button
                            type="button"
                            className="ts-pill is-primary"
                            disabled={busy === `start:${session.id}`}
                            onClick={() =>
                              void open(`start:${session.id}`, () =>
                                startTeachSession(classId, session.id),
                              )
                            }
                          >
                            开始
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="tp-quiet">还没有备课</p>
                )}

                {past.length ? (
                  <>
                    <p className="phone-group-title">上过的课</p>
                    <div className="phone-group">
                      {past.map((session) => (
                        <div key={session.id} className="tp-session-row">
                          <button
                            type="button"
                            className="phone-row"
                            onClick={() => onOpenSession(session.id)}
                          >
                            <span className="tp-course-copy">
                              <strong>{classSessionLabel(session)}</strong>
                              <small>
                                {session.startedAt ? `${clock(session.startedAt)} · ` : ''}
                                {session.participantCount} 人 · {session.itemCount} 题
                              </small>
                            </span>
                            <ChevronRight size={16} className="tp-chevron" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="ts-pill tp-session-delete"
                            aria-label={`删除${classSessionLabel(session)}`}
                            disabled={Boolean(busy)}
                            onClick={() => setDeleting(session)}
                          >
                            <Trash2 size={14} aria-hidden />
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <ClassStudents classId={classId} data={data} busy={busy} act={act} />
            )}
          </>
        ) : null}
      </div>
      {deleting ? (
        <PhoneConfirm
          title={`删除「${classSessionLabel(deleting)}」？`}
          message="这节课将从老师和学生的课堂列表中移除，题库和已有作答记录保留。"
          confirmLabel="删除"
          destructive
          busy={busy === `delete:${deleting.id}`}
          onCancel={() => {
            if (!busy) setDeleting(null);
          }}
          onConfirm={async () => {
            setBusy(`delete:${deleting.id}`);
            setError('');
            try {
              setData(await deleteTeachEndedSession(deleting.id));
              setDeleting(null);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '删除失败');
              setDeleting(null);
            } finally {
              setBusy('');
            }
          }}
        />
      ) : null}
      {importing ? (
        <ImportSessionsDialog
          classId={classId}
          onClose={() => setImporting(false)}
          onImported={(next) => {
            setData(next);
            setImporting(false);
          }}
        />
      ) : null}
    </PhonePage>
  );
}

function ClassStudents({
  classId,
  data,
  busy,
  act,
}: {
  classId: string;
  data: TeachClass;
  busy: string;
  act: (key: string, run: () => Promise<TeachClass>) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [chapterId, setChapterId] = useState('all');
  const [showVisitors, setShowVisitors] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const chapters = useMemo(() => {
    const map = new Map<string, string>();
    for (const problem of data.problems) {
      if (problem.chapter) map.set(problem.chapter.id, problem.chapter.name);
    }
    return [...map.entries()];
  }, [data.problems]);
  const problems = useMemo(
    () =>
      data.problems.filter((problem) => chapterId === 'all' || problem.chapter?.id === chapterId),
    [chapterId, data.problems],
  );
  const progress = useMemo(
    () => new Map(data.progress.map((row) => [`${row.userId}:${row.problemId}`, row])),
    [data.progress],
  );
  const students = [
    ...data.roster.map((person) => ({ ...person, visitor: false })),
    ...(showVisitors ? data.visitors : []).map((person) => ({ ...person, visitor: true })),
  ];
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
    <>
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
                            title={`${problemName(problem)} · ${teachResultStatus(row?.status ?? 'none', row?.attemptedCount).label}${
                              row ? ` · ${row.attemptedCount} 次` : ''
                            }`}
                          >
                            <Marble
                              status={row?.status ?? 'none'}
                              attempts={row?.attemptedCount}
                              size={20}
                            />
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
    </>
  );
}

/** 把往届同一门课的几节课复制成备课。 */
function ImportSessionsDialog({
  classId,
  onClose,
  onImported,
}: {
  classId: string;
  onClose: () => void;
  onImported: (next: TeachClass) => void;
}) {
  const [sources, setSources] = useState<TeachImportClass[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    getTeachImportSources(classId)
      .then((rows) => {
        if (alive) setSources(rows);
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : '读取失败');
      });
    return () => {
      alive = false;
    };
  }, [classId]);
  const toggleAll = (source: TeachImportClass, on: boolean) => {
    const ids = source.sessions.map((session) => session.id);
    setSelected((current) =>
      on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)),
    );
  };
  return createPortal(
    <div className="phone-confirm-layer tp-sheet-layer" role="presentation">
      <button
        type="button"
        className="phone-confirm-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <section className="tp-sheet" role="dialog" aria-modal="true" aria-label="从往届导入">
        <header className="tp-sheet-title">从往届导入</header>
        <div className="tp-sheet-list">
          {error ? <p className="phone-page-error">{error}</p> : null}
          {!sources && !error ? <GlassSkeletonRows rows={4} height={44} /> : null}
          {sources && !sources.length ? <PhoneEmpty title="没有往届的课" hint="" /> : null}
          {sources?.map((source) => {
            const allOn = source.sessions.every((session) => selected.includes(session.id));
            return (
              <section key={source.classId} className="tp-import-term">
                <div className="tp-import-head">
                  <strong>{source.label}</strong>
                  <button type="button" onClick={() => toggleAll(source, !allOn)}>
                    {allOn ? '全不选' : '全选'}
                  </button>
                </div>
                {source.sessions.map((session) => {
                  const checked = selected.includes(session.id);
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className="phone-row tp-choice"
                      aria-pressed={checked}
                      onClick={() =>
                        setSelected((current) =>
                          checked
                            ? current.filter((id) => id !== session.id)
                            : [...current, session.id],
                        )
                      }
                    >
                      <span className="tp-check" aria-hidden />
                      <span className="tp-course-copy">
                        <strong>
                          {classSessionLabel(session)} · {session.itemCount} 题
                        </strong>
                        <small>{session.titles.join('、')}</small>
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
        <footer className="tp-sheet-foot">
          <button type="button" className="phone-confirm-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="phone-confirm-button is-primary"
            disabled={!selected.length || busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                onImported(
                  await teachClassAction({
                    action: 'import-sessions',
                    classId,
                    sessionIds: selected,
                  }),
                );
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '导入失败');
                setBusy(false);
              }
            }}
          >
            {selected.length ? (
              <>
                <Check size={15} aria-hidden /> 导入 {selected.length} 节
              </>
            ) : (
              '导入'
            )}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
