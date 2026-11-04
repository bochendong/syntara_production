import { useEffect, useRef, useState } from 'react';
import { ChevronRight, LogIn } from 'lucide-react';

import {
  nativeClassroomAction,
  type NativeClassroomItem,
  type NativeClassroomSession,
  type NativeClassroomState,
} from '../data/platform-api-client';
import type { ClassroomOpenProblem } from './ClassroomPanel';
import { PhoneEmpty, PhonePage } from './PhonePages';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
import { clock, Marble, problemName, STATUS } from './teach-shared';
import './teach-page.css';
import './student-classroom.css';

/**
 * 学生的「上课」页（网页版、iPad、电脑 App；手机没有）：
 * 输码进课堂，进去后是这节课的题单和自己的弹珠，点开就是平常的做题页，做完回到这里。
 * 从这里交的题记到这节课上，下课后回来补交也算。
 */
export function StudentClassroomPage({
  state,
  onState,
  initialSessionId,
  onBack,
  onJoinedCourse,
  onOpenProblem,
}: {
  state: NativeClassroomState;
  onState: (state: NativeClassroomState) => void;
  initialSessionId: string | null;
  onBack: () => void;
  /** 进课堂 / 进班后可能多了一门课，App 重新同步课程列表。 */
  onJoinedCourse: (courseId: string) => Promise<void>;
  onOpenProblem: ClassroomOpenProblem;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const session =
    [...state.sessions, ...state.past].find((entry) => entry.id === sessionId) ?? null;
  if (session?.joined) {
    return (
      <ClassroomSession
        key={session.id}
        session={session}
        onBack={() => setSessionId(null)}
        onOpenProblem={onOpenProblem}
      />
    );
  }
  return (
    <ClassroomHome
      state={state}
      onState={onState}
      onBack={onBack}
      onJoinedCourse={onJoinedCourse}
      onEnter={setSessionId}
    />
  );
}

function ClassroomHome({
  state,
  onState,
  onBack,
  onJoinedCourse,
  onEnter,
}: {
  state: NativeClassroomState;
  onState: (state: NativeClassroomState) => void;
  onBack: () => void;
  onJoinedCourse: (courseId: string) => Promise<void>;
  onEnter: (sessionId: string) => void;
}) {
  const [code, setCode] = useState('');
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
        setMessage({ tone: 'ok', text: '已进班' });
      }
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : '进入失败' });
    } finally {
      setBusy('');
    }
  };

  return (
    <PhonePage title="上课" overlay largeTitle onBack={onBack}>
      <div className="tp-page tc-page">
        <header className="phone-large-head tp-head">
          <h1>上课</h1>
        </header>
        <form
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
        {message ? (
          <p className={`tc-message is-${message.tone}`} role="status">
            {message.text}
          </p>
        ) : null}

        {state.sessions.length ? <p className="phone-group-title">正在上课</p> : null}
        {state.sessions.length ? (
          <div className="phone-group">
            {state.sessions.map((session) => (
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
                  <strong>
                    {session.courseName} · 第 {session.number} 节
                  </strong>
                  <small>{session.teacherName}</small>
                </span>
                {session.joined ? (
                  <ChevronRight size={16} className="tp-chevron" aria-hidden />
                ) : (
                  <span className="tp-live-pill">{busy === session.id ? '进入中' : '进入'}</span>
                )}
              </button>
            ))}
          </div>
        ) : null}

        {state.past.length ? <p className="phone-group-title">上过的课</p> : null}
        {state.past.length ? (
          <div className="phone-group">
            {state.past.map((session) => {
              const done = session.items.filter((item) => item.myStatus).length;
              return (
                <button
                  key={session.id}
                  type="button"
                  className="phone-row"
                  onClick={() => onEnter(session.id)}
                >
                  <span className="tp-course-copy">
                    <strong>
                      {session.courseName} · 第 {session.number} 节
                    </strong>
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
      </div>
    </PhonePage>
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
        title: `第 ${session.number} 节`,
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
    <PhonePage title={`第 ${session.number} 节`} overlay largeTitle onBack={onBack}>
      <div className="tp-page tc-page">
        <header className="phone-large-head tp-head">
          <h1>第 {session.number} 节</h1>
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
              return (
                <li key={item.id} className={fresh.has(item.id) ? 'is-fresh' : undefined}>
                  <button type="button" disabled={busy === item.id} onClick={() => void open(item)}>
                    <Marble status={status} size={34} />
                    <span className="tc-item-copy">
                      <strong>
                        <ProblemTitleText content={problemName(item)} />
                      </strong>
                      <small>
                        {STATUS[status].label === '没交' ? '未作答' : STATUS[status].label}
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
