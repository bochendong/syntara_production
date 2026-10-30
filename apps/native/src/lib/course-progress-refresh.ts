/** Failed uploads stay in the outbox; they must not block reading course updates. */
export async function readCourseWithIndependentProgress<T>(
  flush: () => Promise<void>,
  read: () => Promise<T>,
  onError: (cause: unknown) => void = (cause) =>
    console.warn('[course-sync] learning progress upload deferred', cause),
): Promise<T> {
  try {
    await flush();
  } catch (cause) {
    onError(cause);
  }
  return read();
}
