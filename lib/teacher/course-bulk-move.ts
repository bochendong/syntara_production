export type BulkMoveCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  academicYear: number | null;
  academicTerm: string | null;
};

export type BulkMovePreview = {
  targets: BulkMoveCourse[];
  notebooks: { count: number; version: string };
  problems: { count: number; version: string };
};

export type BulkMoveInput = {
  targetCourseId: string;
  notebooks: boolean;
  problems: boolean;
  notebookVersion: string;
  problemVersion: string;
};

export type BulkMoveResult = { notebooks: number; problems: number; targetCourseId: string };

export function groupBulkMoveCourses(courses: BulkMoveCourse[]) {
  const terms: Record<string, { rank: number; label: string }> = {
    fall: { rank: 3, label: 'Fall' },
    summer: { rank: 2, label: 'Summer' },
    winter: { rank: 1, label: 'Winter' },
  };
  const sorted = [...courses].sort(
    (a, b) =>
      (b.academicYear ?? 0) - (a.academicYear ?? 0) ||
      (terms[b.academicTerm ?? '']?.rank ?? 0) - (terms[a.academicTerm ?? '']?.rank ?? 0) ||
      (a.courseCode || a.name).localeCompare(b.courseCode || b.name) ||
      a.id.localeCompare(b.id),
  );
  const groups = new Map<string, BulkMoveCourse[]>();
  for (const course of sorted) {
    const term = terms[course.academicTerm ?? '']?.label;
    const label = [course.academicYear, term].filter(Boolean).join(' ') || '未设置学期';
    groups.set(label, [...(groups.get(label) ?? []), course]);
  }
  return Array.from(groups, ([term, items]) => ({ term, courses: items }));
}
