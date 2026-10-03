/** Completed batches survive function time limits and manual retries. */
export class ImportContinuationRequired extends Error {
  constructor() {
    super('本轮处理已保存，等待继续。');
    this.name = 'ImportContinuationRequired';
  }
}

export function createImportCheckpoints(args: {
  saved: Record<string, unknown>;
  persist: (key: string, value: unknown) => Promise<void>;
  deadline: number;
  signal?: AbortSignal;
  now?: () => number;
}) {
  const now = args.now ?? Date.now;
  return async function checkpoint<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (Object.hasOwn(args.saved, key)) return args.saved[key] as T;
    args.signal?.throwIfAborted();
    // Leave time for in-flight batches to finish and write their checkpoints.
    if (now() >= args.deadline) throw new ImportContinuationRequired();
    const value = await work();
    // Some optional repair/verification passes catch provider errors. A worker
    // deadline must pause them rather than cache an incomplete fallback result.
    args.signal?.throwIfAborted();
    await args.persist(key, value);
    args.saved[key] = value;
    return value;
  };
}
