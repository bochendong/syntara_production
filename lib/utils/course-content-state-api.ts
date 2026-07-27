'use client';

import { backendJson, type BackendLoadOptions } from '@/lib/utils/backend-api';

export type CourseContentResourceState = {
  count: number;
  updatedAt: string | null;
  revision: string;
};

export type CourseContentSourceState = CourseContentResourceState & {
  processingCount: number;
  ingestErrorCount: number;
  indexPendingCount: number;
  indexErrorCount: number;
  oldestProcessingAt: string | null;
};

export type CourseContentState = {
  storage: 'database';
  courseId: string;
  accessRole: 'owner' | 'enrolled';
  checkedAt: string;
  revision: string;
  notebooks: CourseContentResourceState;
  problems: CourseContentResourceState;
  sources: CourseContentSourceState;
};

export async function loadCourseContentState(
  courseId: string,
  options: BackendLoadOptions = {},
): Promise<CourseContentState> {
  return backendJson<CourseContentState>(
    `/api/courses/${encodeURIComponent(courseId)}/content-state`,
    {
      cache: 'no-store',
      ...options,
    },
  );
}
