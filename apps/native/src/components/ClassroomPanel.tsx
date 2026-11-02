import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Radio, X } from 'lucide-react';

import {
  getNativeClassroom,
  nativeClassroomAction,
  type NativeClassroomItem,
  type NativeClassroomSession,
} from '../data/platform-api-client';
import { platformAvailable } from '../data/browser-runtime';
import './classroom-panel.css';

/**
 * 老师上课用的课堂入口（网页版、iPad、电脑 App；手机不显示）。
 * - 输 6 位课堂码进这节课，或输班级码进本学期的班。
 * - 本班正在上课时，右上角冒出「老师开始上课了」，点一下进入。
 * - 老师发的题点开就是平常的做题页；提交照常走题库接口，老师那边按时间统计。
 */

const STATUS_LABEL: Record<NonNullable<NativeClassroomItem['myStatus']>, string> = {
  passed: '对了',
  partial: '部分对',
  failed: '再想想',
  error: '出错了',
  pending: '已交',
};

export type ClassroomOpenProblem = (input: {
  courseId: string;
  problemIds: string[];
  problemId: string;
  title: string;
}) => Promise<void>;

export function useClassroomState(enabled: boolean, open: boolean) {
  const [sessions, setSessions] = useState<NativeClassroomSession[]>([]);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const state = await getNativeClassroom();
      setSessions(state.sessions);
    } catch {
      // 课堂只是附加功能，读不到就保持上一次的状态。
    }
  }, [enabled]);

  const joined = sessions.some((session) => session.joined);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void refresh(), 0);
    // 进了课堂或面板开着时 4 秒一次（老师随时发题），平时 30 秒看一眼有没有开课。
    const interval = open || joined ? 4_000 : 30_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, interval);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, joined, open, refresh]);

  return { sessions, setSessions, refresh };
}

export function ClassroomLiveBadge({
  sessions,
  onOpen,
}: {
  sessions: NativeClassroomSession[];
  onOpen: () => void;
}) {
  const live = sessions[0];
  if (!live) return null;
  const openCount = live.items.filter((item) => item.open && !item.myStatus).length;
  return (
    <button type="button" className="classroom-live-badge" onClick={onOpen}>
      <Radio size={16} strokeWidth={2} aria-hidden />
      <span>
        {live.joined
          ? openCount
            ? `老师发了 ${openCount} 道题`
            : `${live.courseName} 上课中`
          : `${live.teacherName}开始上课了`}
      </span>
    </button>
  );
}

export function ClassroomPanel({
  sessions,
  onSessions,
  onClose,
  onJoinedCourse,
  onOpenProblem,
}: {
  sessions: NativeClassroomSession[];
  onSessions: (sessions: NativeClassroomSession[]) => void;
  onClose: () => void;
  /** 进课堂 / 进班后可能多了一门课，App 重新同步课程列表。 */
  onJoinedCourse: (courseId: string) => Promise<void>;
  onOpenProblem: ClassroomOpenProblem;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sessions.some((session) => session.joined)) inputRef.current?.focus();
    // 只在打开时聚焦一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const join = async (
    payload: { action: 'join-code'; code: string } | { action: 'join-session'; sessionId: string },
  ) => {
    setBusy(payload.action === 'join-code' ? 'code' : payload.sessionId);
    setMessage(null);
    try {
      const result = await nativeClassroomAction(payload);
      onSessions(result.sessions);
      await onJoinedCourse(result.joined.courseId);
      setCode('');
      setMessage(
        result.joined.kind === 'class'
          ? {
              tone: 'ok',
              text: result.sessions.some((session) => session.courseId === result.joined.courseId)
                ? '已进入班级，老师正在上课，点下面进入课堂。'
                : '已进入班级。老师开始上课时这里会提醒你。',
            }
          : null,
      );
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : '进入失败' });
    } finally {
      setBusy('');
    }
  };

  const openProblem = async (session: NativeClassroomSession, item: NativeClassroomItem) => {
    setBusy(item.id);
    setMessage(null);
    try {
      await onOpenProblem({
        courseId: session.courseId,
        problemIds: session.items.map((entry) => entry.problemId),
        problemId: item.problemId,
        title: `${session.courseName} · 课堂练习`,
      });
      onClose();
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : '打不开这道题' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="classroom-layer" role="presentation">
      <button type="button" className="classroom-backdrop" aria-label="关闭" onClick={onClose} />
      <section className="classroom-panel" role="dialog" aria-modal="true" aria-label="课堂练习">
        <header className="classroom-panel-header">
          <strong>课堂练习</strong>
          <button type="button" className="classroom-close" aria-label="关闭" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <form
          className="classroom-code-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) void join({ action: 'join-code', code });
          }}
        >
          <input
            ref={inputRef}
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
            {busy === 'code' ? '进入中…' : '进入'}
          </button>
        </form>
        {message ? (
          <p className={`classroom-message is-${message.tone}`} role="status">
            {message.text}
          </p>
        ) : null}

        {sessions.map((session) => (
          <article key={session.id} className="classroom-session">
            <div className="classroom-session-head">
              <span className="classroom-live-dot" aria-hidden />
              <div>
                <strong>{session.courseName}</strong>
                <small>
                  {session.joined
                    ? `${session.teacherName}正在上课`
                    : `${session.teacherName}开始上课了`}
                </small>
              </div>
            </div>
            {!session.joined ? (
              <button
                type="button"
                className="classroom-join-session"
                disabled={busy === session.id}
                onClick={() => void join({ action: 'join-session', sessionId: session.id })}
              >
                {busy === session.id ? '进入中…' : '进入课堂'}
              </button>
            ) : session.items.length ? (
              <ol className="classroom-items">
                {session.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="classroom-item"
                      data-status={item.myStatus ?? (item.open ? 'open' : 'closed')}
                      disabled={busy === item.id}
                      onClick={() => void openProblem(session, item)}
                    >
                      <span className="classroom-item-marble" aria-hidden>
                        {item.myStatus === 'passed' ? <CheckCircle2 size={14} /> : null}
                      </span>
                      <span className="classroom-item-title">
                        {item.number ? `${item.number}. ` : ''}
                        {item.title}
                      </span>
                      <small>
                        {item.myStatus
                          ? STATUS_LABEL[item.myStatus]
                          : item.open
                            ? '作答中'
                            : '已收卷'}
                        {item.answerRevealed ? ' · 已公布答案' : ''}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="classroom-waiting">已在课堂里，等老师发题。</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export function classroomAvailable(phoneLayout: boolean): boolean {
  return !phoneLayout && platformAvailable();
}
