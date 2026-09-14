type CourseIdentity = { name?: string | null; code?: string | null; courseCode?: string | null };

/** Section suffixes from external catalogues are not part of the visible course code. */
export function cleanCourseIdentifier(value: string): string {
  return value.trim().replace(/^((?:[A-Z]+-)*[A-Z]{2,}\d+[A-Z\d]*)\s*[（(]\d+[）)]$/i, '$1');
}

export function courseDisplayCode(course: CourseIdentity): string {
  const code = cleanCourseIdentifier(course.code || course.courseCode || '');
  const name = cleanCourseIdentifier(course.name || '');
  // Prefer the campus-qualified name only when it identifies the same course.
  if (
    /^[A-Z]+-[A-Z]{2,}\d+[A-Z\d]*$/i.test(name) &&
    (!code ||
      name.toUpperCase() === code.toUpperCase() ||
      name.toUpperCase().endsWith(`-${code.toUpperCase()}`))
  )
    return name;
  return code || name || '课程';
}

export function normalizeCourseDisplay<T extends CourseIdentity>(course: T): T {
  const name = course.name ? cleanCourseIdentifier(course.name) : course.name;
  return {
    ...course,
    name,
    ...(course.code ? { code: courseDisplayCode(course) } : {}),
    ...(course.courseCode ? { courseCode: courseDisplayCode(course) } : {}),
  };
}
