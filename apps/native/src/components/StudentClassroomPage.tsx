import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronRight, LogIn, Radio } from 'lucide-react';

import { profileThemeForAvatar, resolveNativeCourseAvatar } from '../assets';
import type { LocalCourse } from '../domain/models';

import {
  nativeClassroomAction,
  type NativeClassroomItem,
  type NativeClassroomSession,
  type NativeClassroomState,
} from '../data/platform-api-client';
import type { ClassroomOpenProblem } from './ClassroomPanel';
import { PhoneEmpty, PhonePage } from './PhonePages';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
import { clock, courseLabel, Marble, problemName, teachResultStatus } from './teach-shared';
import { classSessionLabel } from '../lib/class-session-label';
import './teach-page.css';
import './student-classroom.css';

/**
 * 学生的「上课」页（网页版、iPad、电脑 App；手机没有）：
 * 先选课程，再进入正在上的课或回看历史课次；课堂码也可直接加入。
 * 课内是题单和自己的弹珠，点开就是平常的做题页，做完回到这里。
 * 从这里交的题记到这节课上，下课后回来补交也算。
 */
type ClassroomCourse = Pick<LocalCourse, 'id' | 'name' | 'courseCode'>;

export function StudentClassroomPage({
  courses,
  state,
  onState,
  initialSessionId,
  onBack,
  onJoinedCourse,
  onOpenProblem,
}: {
  courses: ClassroomCourse[];
  state: NativeClassroomState;
  onState: (state: NativeClassroomState) => void;
  initialSessionId: string | null;
  onBack: () => void;
  /** 进课堂 / 进班后可能多了一门课，App 重新同步课程列表。 */
  onJoinedCourse: (courseId: string) => Promise<void>;
  onOpenProblem: ClassroomOpenProblem;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [courseId, setCourseId] = useState<string | null>(null);
  // 保留仍可回看的课次，即使课程暂未出现在本机课程列表中。
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  for (const entry of [...state.sessions, ...state.past]) {
    if (!courseMap.has(entry.courseId)) {
      courseMap.set(entry.courseId, {
        id: entry.courseId,
        name: entry.courseName,
        courseCode: null,
      });
    }
  }
  const enterSession = (id: string) => {
    const entry = [...state.sessions, ...state.past].find((value) => value.id === id);
    if (entry) setCourseId(entry.courseId);
    setSessionId(id);
  };
  const session =
    [...state.sessions, ...state.past].find((entry) => entry.id === sessionId) ?? null;
  if (session?.joined) {
    return (
      <ClassroomSession
        key={session.id}
        session={session}
        onBack={() => {
          setCourseId(session.courseId);
          setSessionId(null);
        }}
        onOpenProblem={onOpenProblem}
      />
    );
  }
  return (
    <ClassroomHome
      courses={[...courseMap.values()]}
      course={courseId ? (courseMap.get(courseId) ?? null) : null}
      onSelectCourse={setCourseId}
      state={state}
      onState={onState}
      onBack={onBack}
      onJoinedCourse={onJoinedCourse}
      onEnter={enterSession}
    />
  );
}

function ClassroomHome({
  courses,
  course,
  onSelectCourse,
  state,
  onState,
  onBack,
  onJoinedCourse,
  onEnter,
}: {
  courses: ClassroomCourse[];
  course: ClassroomCourse | null;
  onSelectCourse: (courseId: string | null) => void;
  state: NativeClassroomState;
  onState: (state: NativeClassroomState) => void;
  onBack: () => void;
  onJoinedCourse: (courseId: string) => Promise<void>;
  onEnter: (sessionId: string) => void;
}) {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const sessions = state.sessions.filter((session) => session.courseId === course?.id);
  const past = state.past.filter((session) => session.courseId === course?.id);
  const title = course ? courseLabel(course) : '上课';
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const join = async (
    payload: { action: 'join-code'; code: string } | { action: 'join-session'; sessionId: string },
  ) => {
    setBusy(payload.action === 'join-code' ? 'code' : payload.sessionId);
    setMessage(null);
    try {
      const result = await nativeClassroomAction(payload);
      onState({ sessions: result.sessions, past: result.past ?? [] });
      await onJoinedCourse(result.joined.courseId);
      setCode('');
      if (result.joined.kind === 'session' && result.joined.sessionId) {
        onEnter(result.joined.sessionId);
      } else {
        onSelectCourse(result.joined.courseId);
        setShowCode(false);
        setMessage({ tone: 'ok', text: '已进班' });
      }
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : '进入失败' });
    } finally {
      setBusy('');
    }
  };

  return (
    <PhonePage
      title={title}
      overlay
      largeTitle
      onBack={course ? () => onSelectCourse(null) : onBack}
    >
      <div className="tp-page tc-page">
        <header className="phone-large-head tp-head">
          <h1>{title}</h1>
          <button
            type="button"
            className="tp-course-card-publish"
            aria-expanded={showCode}
            aria-controls="student-classroom-code"
            onClick={() => setShowCode((value) => !value)}
          >
            输入课堂码 / 班级码
          </button>
        </header>
        {showCode ? (
          <form
            id="student-classroom-code"
            className="tc-code"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === 6) void join({ action: 'join-code', code });
            }}
          >
            <input
              autoFocus
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase()
                    .replace(/[^0-9A-Z]/g, '')
                    .slice(0, 6),
                )
              }
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="课堂码 / 班级码"
              aria-label="输入 6 位课堂码或班级码"
            />
            <button type="submit" disabled={code.length !== 6 || busy === 'code'}>
              <LogIn size={16} aria-hidden />
              {busy === 'code' ? '进入中' : '进入'}
            </button>
          </form>
        ) : null}
        {message ? (
          <p className={`tc-message is-${message.tone}`} role="status">
            {message.text}
          </p>
        ) : null}

        {!course ? (
          <>
            <div className="tp-courses-heading">
              <h2>我的课程</h2>
              <span>{courses.length} 门课程</span>
            </div>
            {courses.length ? (
              <div className="tp-course-grid">
                {courses.map((entry) => (
                  <ClassroomCourseCard
                    key={entry.id}
                    course={entry}
                    sessions={state.sessions.filter((session) => session.courseId === entry.id)}
                    past={state.past.filter((session) => session.courseId === entry.id)}
                    onOpen={() => {
                      setMessage(null);
                      onSelectCourse(entry.id);
                    }}
                  />
                ))}
              </div>
            ) : (
              <PhoneEmpty title="还没有课程" hint="添加课程，或输入老师给你的课堂码 / 班级码。" />
            )}
          </>
        ) : (
          <>
            {sessions.length ? <p className="phone-group-title">正在上课</p> : null}
            {sessions.length ? (
              <div className="phone-group">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="phone-row"
                    disabled={busy === session.id}
                    onClick={() =>
                      session.joined
                        ? onEnter(session.id)
                        : void join({ action: 'join-session', sessionId: session.id })
                    }
                  >
                    <span className="tl-dot" aria-hidden />
                    <span className="tp-course-copy">
                      <strong>{classSessionLabel(session)}</strong>
                      <small>{session.teacherName}</small>
                    </span>
                    {session.joined ? (
                      <ChevronRight size={16} className="tp-chevron" aria-hidden />
                    ) : (
                      <span className="tp-live-pill">
                        {busy === session.id ? '进入中' : '进入'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : null}

            {past.length ? <p className="phone-group-title">上过的课</p> : null}
            {past.length ? (
              <div className="phone-group">
                {past.map((session) => {
                  const done = session.items.filter((item) => item.myStatus).length;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className="phone-row"
                      onClick={() => onEnter(session.id)}
                    >
                      <span className="tp-course-copy">
                        <strong>{classSessionLabel(session)}</strong>
                        <small>
                          {clock(session.startedAt)} · {done}/{session.items.length}
                        </small>
                      </span>
                      <ChevronRight size={16} className="tp-chevron" aria-hidden />
                    </button>
                  );
                })}
              </div>
            ) : null}
            {!sessions.length && !past.length ? (
              <PhoneEmpty
                title="还没有课堂"
                hint="老师开课后会显示在这里，也可以输入课堂码加入。"
              />
            ) : null}
          </>
        )}
      </div>
    </PhonePage>
  );
}

function ClassroomCourseCard({
  course,
  sessions,
  past,
  onOpen,
}: {
  course: ClassroomCourse;
  sessions: NativeClassroomSession[];
  past: NativeClassroomSession[];
  onOpen: () => void;
}) {
  const label = courseLabel(course);
  const avatar = resolveNativeCourseAvatar(course.id, course.courseCode);
  const scene = profileThemeForAvatar(avatar)?.backgroundUrl;
  return (
    <article
      className={`tp-course-card tc-course-card${scene ? ' has-course-scene' : ''}`}
      aria-label={label}
      style={
        scene
          ? ({ '--tp-card-scene': `url(${JSON.stringify(scene)})` } as CSSProperties)
          : undefined
      }
    >
      <div className="tp-course-card-head">
        <img className="tp-course-marble" src={avatar} alt="" />
        <div className="tp-course-card-title">
          <h3>{label}</h3>
        </div>
      </div>
      <dl className="tp-course-card-stats tc-course-stats">
        <div>
          <dt>正在上课</dt>
          <dd>
            {sessions.length}
            <span> 节</span>
          </dd>
        </div>
        <div>
          <dt>上过的课</dt>
          <dd>
            {past.length}
            <span> 节</span>
          </dd>
        </div>
      </dl>
      <div className="tp-course-card-footer">
        <span className={`tp-course-state${sessions.length ? ' is-ready' : ''}`}>
          {sessions.length ? '老师正在上课' : '暂无正在上的课'}
        </span>
        <button
          type="button"
          className="tp-course-card-open tp-course-card-classroom tc-course-open"
          aria-label={`进入课堂：${label}`}
          onClick={onOpen}
        >
          {sessions.length ? <Radio size={14} aria-hidden /> : null}
          {sessions.length ? '上课' : '查看课堂'}
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>
    </article>
  );
}

function ClassroomSession({
  session,
  onBack,
  onOpenProblem,
}: {
  session: NativeClassroomSession;
  onBack: () => void;
  onOpenProblem: ClassroomOpenProblem;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const seen = useRef(new Set(session.items.map((item) => item.id)));
  const live = session.status === 'live';

  // 老师加了题：一个小提示 + 新弹珠弹出来。
  const itemKey = session.items.map((item) => item.id).join(',');
  useEffect(() => {
    const added = session.items.filter((item) => !seen.current.has(item.id));
    seen.current = new Set(session.items.map((item) => item.id));
    if (!added.length) return;
    const showTimer = window.setTimeout(() => {
      setFresh(new Set(added.map((item) => item.id)));
      setToast(added.length > 1 ? `新题 · ${added.length} 道` : `新题 · ${added[0].title}`);
    }, 0);
    const hideTimer = window.setTimeout(() => {
      setToast('');
      setFresh(new Set());
    }, 2_600);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
    // 题单变了才看一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const open = async (item: NativeClassroomItem) => {
    setBusy(item.id);
    setError('');
    try {
      await onOpenProblem({
        courseId: session.courseId,
        problemIds: session.items.map((entry) => entry.problemId),
        problemId: item.problemId,
        title: classSessionLabel(session),
        classSessionId: session.id,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '打不开这道题');
    } finally {
      setBusy('');
    }
  };

  const done = session.items.filter((item) => item.myStatus).length;
  return (
    <PhonePage title={classSessionLabel(session)} overlay largeTitle onBack={onBack}>
      <div className="tp-page tc-page">
        <header className="phone-large-head tp-head">
          <h1>{classSessionLabel(session)}</h1>
          <span className="tp-term">{session.courseName}</span>
        </header>
        <div className="tc-status">
          {live ? <span className="tl-dot" aria-hidden /> : null}
          <span>{live ? '上课中' : '已下课'}</span>
          {session.items.length ? (
            <b>
              {done}/{session.items.length}
            </b>
          ) : null}
        </div>
        {error ? <p className="phone-page-error">{error}</p> : null}
        {session.items.length ? (
          <ol className="tc-items">
            {session.items.map((item) => {
              const status = item.myStatus ?? 'none';
              const label = teachResultStatus(status, item.myAttempts).label;
              return (
                <li key={item.id} className={fresh.has(item.id) ? 'is-fresh' : undefined}>
                  <button type="button" disabled={busy === item.id} onClick={() => void open(item)}>
                    <Marble status={status} attempts={item.myAttempts} size={34} />
                    <span className="tc-item-copy">
                      <strong>
                        <ProblemTitleText content={problemName(item)} />
                      </strong>
                      <small>
                        {label === '没交' ? '未作答' : label}
                        {item.myAttempts > 1 ? ` · ${item.myAttempts} 次` : ''}
                      </small>
                    </span>
                    <ChevronRight size={17} className="tp-chevron" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <PhoneEmpty title="等老师加题" hint="" />
        )}
      </div>
      {toast ? (
        <div className="tc-toast" role="status">
          {toast}
        </div>
      ) : null}
    </PhonePage>
  );
}
