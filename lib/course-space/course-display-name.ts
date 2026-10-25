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

type StoreCourseIdentity = CourseIdentity & {
  university?: string | null;
  organizationName?: string | null;
};

/** 学校全名里认得出的校区缩写；认不出时用名字里自带的大写缩写（如 "UBC"）。 */
const CAMPUS_PATTERNS: Array<[RegExp, string]> = [
  [/\bUTM\b|mississauga|密西沙加/i, 'UTM'],
  [/\bUTSC\b|scarborough|士嘉堡/i, 'UTSC'],
  [/\bUTSG\b|st\.?\s*george|圣乔治/i, 'UTSG'],
  [/university of toronto|\buoft\b|多伦多大学/i, 'UofT'],
];

function campusPrefix(...sources: Array<string | null | undefined>): string | null {
  for (const source of sources) {
    const text = source?.trim();
    if (!text) continue;
    const known = CAMPUS_PATTERNS.find(([pattern]) => pattern.test(text));
    if (known) return known[1];
    const acronym = text.match(/\b[A-Z]{3,6}\b/)?.[0];
    if (acronym) return acronym;
  }
  return null;
}

/** "CSC108" → "CSC 108"，"ECON101H5" → "ECON 101H5"。 */
function spacedCode(code: string): string {
  return code.replace(
    /^([A-Z]{2,})\s*(\d)/i,
    (_, letters: string, digit: string) => `${letters.toUpperCase()} ${digit}`,
  );
}

/**
 * 商城课程统一带学校前缀显示，如 "UTM-CSC 108"、"UTM-ECON 101"。
 * 课程代码已有前缀（"UTM-CSC108"）就沿用；没有时按学校或机构名补上。
 */
export function storeCourseCode(
  course: StoreCourseIdentity,
  { withPrefix = true }: { withPrefix?: boolean } = {},
): string | null {
  const raw = courseDisplayCode(course);
  const match = raw.match(/^(?:([A-Z][A-Za-z]*)-)?([A-Z]{2,}\s*\d+[A-Z\d]*)$/i);
  if (!match) return course.courseCode?.trim() || null;
  const code = spacedCode(match[2]);
  // 聊天侧栏太窄，只显示 "CSC 108"；商城才带校区。
  if (!withPrefix) return code;
  const prefix = match[1] || campusPrefix(course.university, course.organizationName);
  return prefix ? `${prefix}-${code}` : code;
}
