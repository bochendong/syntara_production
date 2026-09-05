'use client';

import { createContext, useContext } from 'react';
import type { CourseSpaceSection } from '@/lib/course-space/course-space-route';

export type CourseSpaceHeaderSlots = {
  courseId: string;
  active: CourseSpaceSection;
  actions: HTMLDivElement | null;
  beforeTitle: HTMLDivElement | null;
  trailingActions: HTMLDivElement | null;
};

export const CourseSpaceShellContext = createContext<CourseSpaceHeaderSlots | null>(null);

export function useCourseSpaceShell() {
  return Boolean(useContext(CourseSpaceShellContext));
}

export function useCourseSpaceHeaderSlots(courseId: string, active: CourseSpaceSection) {
  const shell = useContext(CourseSpaceShellContext);
  return shell?.courseId === courseId && shell.active === active ? shell : null;
}
