'use client';

import { backendJson } from '@/lib/utils/backend-api';

export type AcademicTerm = 'winter' | 'summer' | 'fall';
export type AcademicCourseSummary = {
  id: string;
  code: string;
  name: string;
  academicYear: number;
  term: AcademicTerm;
  builderName?: string;
  contentCount: number;
  inheritedCount: number;
  studentCount: number;
  createdAt: number;
  updatedAt: number;
};
export type AcademicTermSummary = {
  key: string;
  academicYear: number;
  term: AcademicTerm;
  courseCount: number;
};
export type CourseContentItem = {
  id: string;
  type: 'notebook' | 'problem_bank' | 'source';
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  reference: {
    id: string;
    courseId: string;
    assetId: string;
    inheritedFromCourseId?: string;
  };
};

type ArchivePayload = {
  current: { academicYear: number; term: AcademicTerm };
  courses: AcademicCourseSummary[];
  terms: AcademicTermSummary[];
};

async function loadArchive() {
  return backendJson<ArchivePayload>('/api/teacher/courses/archive');
}

export function academicTermLabel(term: AcademicTerm) {
  return term === 'winter' ? 'Winter' : term === 'summer' ? 'Summer' : 'Fall';
}

export async function listTeacherCurrentCourses(_args?: { teacherId?: string }) {
  const archive = await loadArchive();
  return archive.courses.filter(
    (course) =>
      course.academicYear === archive.current.academicYear && course.term === archive.current.term,
  );
}

export async function listTeacherPastTerms(_args?: { teacherId?: string }) {
  return (await loadArchive()).terms;
}

export async function listTeacherPastCoursesPage(args: {
  teacherId?: string;
  academicYear: number;
  term: AcademicTerm;
  page?: number;
  pageSize?: number;
  query?: string;
}) {
  const archive = await loadArchive();
  const page = Math.max(1, args.page || 1);
  const pageSize = Math.min(24, Math.max(1, args.pageSize || 12));
  const query = args.query?.trim().toLowerCase() || '';
  const courses = archive.courses.filter(
    (course) =>
      course.academicYear === args.academicYear &&
      course.term === args.term &&
      (!query || `${course.code} ${course.name}`.toLowerCase().includes(query)),
  );
  const start = (page - 1) * pageSize;
  return { items: courses.slice(start, start + pageSize), total: courses.length, page, pageSize };
}

export async function listCourseContent(courseId: string) {
  const payload = await backendJson<{ items: CourseContentItem[] }>(
    `/api/teacher/courses/${encodeURIComponent(courseId)}/migration-content`,
  );
  return payload.items;
}

export async function migrateCourseContentReferences(args: {
  teacherId?: string;
  sourceCourseId: string;
  targetCourseId: string;
  sourceReferenceIds: string[];
}) {
  return backendJson<{ migratedCount: number; skippedCount: number }>(
    '/api/teacher/courses/migrate',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceCourseId: args.sourceCourseId,
        targetCourseId: args.targetCourseId,
        referenceIds: args.sourceReferenceIds,
      }),
    },
  );
}
