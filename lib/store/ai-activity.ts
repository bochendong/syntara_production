'use client';

import { create } from 'zustand';

export type TeacherAiActivity = {
  ownerId: string;
  courseId: string;
  active: boolean;
  checkedAt: number;
};

export const useAiActivityStore = create<{
  sources: Record<string, boolean>;
  teacherCourses: Record<string, TeacherAiActivity>;
  miniLectures: Record<string, string>;
  miniLecture: (id: string, ownerId: string, active: boolean) => void;
  report: (id: string, active: boolean) => void;
  teacherSnapshot: (ownerId: string, courseId: string, active: boolean) => void;
}>((set) => ({
  sources: {},
  teacherCourses: {},
  miniLectures: {},
  miniLecture: (id, ownerId, active) =>
    set((state) => {
      if (active && state.miniLectures[id] === ownerId) return state;
      if (!active && !state.miniLectures[id]) return state;
      const miniLectures = { ...state.miniLectures };
      if (active) miniLectures[id] = ownerId;
      else delete miniLectures[id];
      return { miniLectures };
    }),
  report: (id, active) =>
    set((state) => {
      if (Boolean(state.sources[id]) === active) return state;
      const sources = { ...state.sources };
      if (active) sources[id] = true;
      else delete sources[id];
      return { sources };
    }),
  teacherSnapshot: (ownerId, courseId, active) =>
    set((state) => ({
      teacherCourses: {
        ...state.teacherCourses,
        [`${ownerId}:${courseId}`]: { ownerId, courseId, active, checkedAt: Date.now() },
      },
    })),
}));
