/** Keep each repository operation (including multi-statement transactions) together.
 * Call through the original instance so internal method calls do not re-enter the queue. */
export function serializeRepository<T extends object>(repository: T): T {
  let pending: Promise<unknown> = Promise.resolve();
  return new Proxy(repository, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const operation = pending.then(() => Reflect.apply(value, target, args));
        pending = operation.catch(() => undefined);
        return operation;
      };
    },
  });
}
