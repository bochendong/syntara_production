import { useCallback, useEffect, useState } from 'react';
import { Radio, X } from 'lucide-react';
import { PracticeMarble } from './PracticeMarble';
import './course-pages.css';

import {
  getNativeClassroom,
  type NativeClassroomSession,
  type NativeClassroomState,
} from '../data/platform-api-client';
import { platformAvailable } from '../data/browser-runtime';
import './classroom-panel.css';
import './marble-dismiss.css';

/**
 * 学生端课堂状态和「上课中」胶囊（网页版、iPad、电脑 App；手机不显示）。
 * 课堂页本身在 StudentClassroomPage。
 */

export type ClassroomOpenProblem = (input: {
  courseId: string;
  problemIds: string[];
  problemId: string;
  title: string;
  /** 这组题的提交记到这节课上。 */
  classSessionId: string;
}) => Promise<void>;

export function useClassroomState(enabled: boolean, open: boolean) {
  const [state, setState] = useState<NativeClassroomState>({ sessions: [], past: [] });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setState(await getNativeClassroom());
    } catch {
      // 课堂只是附加功能，读不到就保持上一次的状态。
    }
  }, [enabled]);

  const joined = state.sessions.some((session) => session.joined);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void refresh(), 0);
    // 进了课堂或课堂页开着时 4 秒一次（老师随时加题），平时 30 秒看一眼有没有开课。
    const interval = open || joined ? 4_000 : 30_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, interval);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, joined, open, refresh]);

  return { state, setState, refresh };
}

export function ClassroomLiveBadge({
  sessions,
  onOpen,
  abovePractice = false,
  onDismiss,
}: {
  sessions: NativeClassroomSession[];
  onOpen: () => void;
  abovePractice?: boolean;
  onDismiss: () => void;
}) {
  if (!sessions.length) return null;
  return (
    <div
      className={`classroom-marble-dock marble-dismiss-dock${abovePractice ? ' is-above-practice' : ''}`}
    >
      <button
        type="button"
        className="classroom-live-marble"
        onClick={onOpen}
        aria-label="进入正在进行的课堂"
      >
        <PracticeMarble active />
        <span className="classroom-marble-icon" aria-hidden="true">
          <Radio size={14} strokeWidth={2} />
        </span>
      </button>
      <button
        type="button"
        className="marble-dismiss-button"
        aria-label="关闭上课球"
        onClick={onDismiss}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function classroomAvailable(phoneLayout: boolean): boolean {
  return !phoneLayout && platformAvailable();
}
