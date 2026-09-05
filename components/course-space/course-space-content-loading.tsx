export function CourseSpaceContentLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="grid h-full min-h-64 place-items-center text-sm text-slate-500 dark:text-slate-400"
    >
      正在加载课程内容…
    </div>
  );
}
