export function courseProblemHref(courseId: string, problemId: string) {
  return `/course/${encodeURIComponent(courseId)}/problem-bank/${encodeURIComponent(problemId)}`;
}
