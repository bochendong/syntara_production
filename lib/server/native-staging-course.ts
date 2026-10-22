/** Retire the automatically provisioned QA course without deleting its saved data. */
export function visibleNativeCourses<T extends { id: string }>(
  env: Record<string, string | undefined>,
  userId: string,
  courses: T[],
): T[] {
  if (
    env.SYNTARA_APP_ENV !== 'staging' ||
    env.SYNTARA_NATIVE_ACCESS_POLICY !== 'google-test' ||
    !userId
  )
    return courses;
  return courses.filter((course) => course.id !== `native-staging-${userId}`);
}
