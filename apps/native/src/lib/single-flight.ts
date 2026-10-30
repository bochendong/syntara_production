/** Share an in-flight operation for the same key without caching its result. */
export function singleFlight<Key, Value>(
  pending: Map<Key, Promise<Value>>,
  key: Key,
  work: () => Promise<Value>,
): Promise<Value> {
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(work);
  pending.set(key, promise);
  void promise.then(
    () => pending.delete(key),
    () => pending.delete(key),
  );
  return promise;
}
