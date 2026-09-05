'use client';

import { createContext, useContext } from 'react';

export const CourseSpaceShellContext = createContext(false);

export function useCourseSpaceShell() {
  return useContext(CourseSpaceShellContext);
}
