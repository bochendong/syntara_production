import type { NativeStoreCourse } from '../data/platform-api-contracts';

const categories = [
  {
    id: 'computing',
    label: '计算机与数据科学',
    code: /^(CSC|CPSC|CS|COMP|CMPT|DSCI|DATA)/,
    keywords: /计算机|编程|数据科学|\b(computer science|programming|data science)\b/i,
  },
  {
    id: 'mathematics',
    label: '数学与统计',
    code: /^(MAT|STA|ACT|APM)/,
    keywords:
      /数学|统计|微积分|线性代数|精算|\b(mathematics|statistics|calculus|algebra|actuarial)\b/i,
  },
  {
    id: 'economics',
    label: '经济学',
    code: /^ECO/,
    keywords: /经济|\b(economics|econometrics)\b/i,
  },
  {
    id: 'business',
    label: '商科与金融',
    code: /^(COMM|COMR|RSM|MGM|MGF|MGT|MG[A-Z]|BUS|FIN|ACC|AFM)/,
    keywords: /商科|商业|金融|会计|管理|\b(business|finance|accounting|commerce|management)\b/i,
  },
  {
    id: 'science',
    label: '自然科学',
    code: /^(CHEM|CHM|BIO|PHY|AST|ENV|EOS)/,
    keywords: /化学|物理|生物|天文|地球科学|\b(chemistry|physics|biology|astronomy)\b/i,
  },
  {
    id: 'humanities',
    label: '人文与社科',
    code: /^(POL|PSY|SOC|PHL|PHIL|HIS|ENG|ANT|VPA|VPS|ART|VISA)/,
    keywords:
      /人文|社科|政治|心理|社会|历史|哲学|艺术|\b(humanities|politics|psychology|sociology|history|philosophy|arts)\b/i,
  },
] as const;

const otherCategory = { id: 'other', label: '其他课程' } as const;

/** Prefer the department code; course names/tags cover courses without a known code. */
export function storeCourseCategory(
  course: Pick<NativeStoreCourse, 'courseCode' | 'name' | 'tags'>,
) {
  const code = (course.courseCode?.trim() || course.name)
    .trim()
    .toUpperCase()
    .replace(/^(UTSG|UTSC|UTM|UBC)[\s_-]*/, '');
  const department = code.match(/^([A-Z]+)[\s_-]*\d/)?.[1];
  const codeCategory = department && categories.find((category) => category.code.test(department));
  if (codeCategory) return codeCategory;
  const keywords = [course.name, ...course.tags].join(' ');
  return categories.find((category) => category.keywords.test(keywords)) ?? otherCategory;
}

export function groupStoreCoursesByCategory(courses: NativeStoreCourse[]) {
  const groups = new Map<string, NativeStoreCourse[]>();
  for (const course of courses) {
    const { id } = storeCourseCategory(course);
    const group = groups.get(id) ?? [];
    group.push(course);
    groups.set(id, group);
  }
  return [...categories, otherCategory]
    .map(({ id, label }) => ({ id, label, courses: groups.get(id) ?? [] }))
    .filter((category) => category.courses.length > 0);
}
