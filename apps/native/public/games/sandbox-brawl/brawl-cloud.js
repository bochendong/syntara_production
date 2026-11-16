export class BrawlSaveConflict extends Error {}

export function createBrawlSaveQueue({ request, store, key, onError, createId = () => crypto.randomUUID() }) {
  let journal = JSON.parse(store.getItem(key) || 'null') ?? { revision: 0, pending: null, next: null };
  let running;
  let failed = false;

  function persist() {
    store.setItem(key, JSON.stringify(journal));
  }

  async function drain() {
    while (journal.pending || journal.next) {
      if (!journal.pending) {
        journal.pending = { action: 'save', id: createId(), revision: journal.revision, data: journal.next };
        journal.next = null;
        persist();
      }
      const result = await request(journal.pending);
      if (result.kind === 'conflict') {
        failed = true;
        throw new BrawlSaveConflict('另一个设备已有较新的进度');
      }
      if (result.kind !== 'saved') throw new Error('无法确认云端存档');
      journal.revision = result.revision;
      journal.pending = null;
      persist();
    }
  }

  function flush() {
    if (failed) return Promise.reject(new BrawlSaveConflict('另一个设备已有较新的进度'));
    if (!running) running = Promise.resolve().then(drain).finally(() => { running = null; });
    return running;
  }

  return {
    flush,
    enqueue(data) {
      if (failed) return;
      journal.next = data;
      persist();
      void flush().catch(onError);
    },
    open(revision) {
      if (journal.pending || journal.next) throw new Error('还有待同步的存档');
      journal.revision = revision;
      persist();
    },
    archive() {
      store.setItem(key + ':backup:' + createId(), JSON.stringify(journal));
      store.removeItem(key);
    },
  };
}
