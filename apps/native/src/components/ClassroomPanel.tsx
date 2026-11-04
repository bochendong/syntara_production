import { useCallback, useEffect, useState } from 'react';
import { Radio } from 'lucide-react';

import {
  getNativeClassroom,
  type NativeClassroomSession,
  type NativeClassroomState,
} from '../data/platform-api-client';
import { platformAvailable } from '../data/browser-runtime';
import './classroom-panel.css';

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
}: {
  sessions: NativeClassroomSession[];
  onOpen: () => void;
}) {
  const live = sessions[0];
  if (!live) return null;
  const openCount = live.items.filter((item) => !item.myStatus).length;
  return (
    <button type="button" className="classroom-live-badge" onClick={onOpen}>
      <Radio size={16} strokeWidth={2} aria-hidden />
      <span>
        {live.joined
          ? openCount
            ? `第 ${live.number} 节 · ${openCount} 道题没做`
            : `${live.courseName} 上课中`
          : `${live.teacherName}开始上课了`}
      </span>
    </button>
  );
}

export function classroomAvailable(phoneLayout: boolean): boolean {
  return !phoneLayout && platformAvailable();
}
