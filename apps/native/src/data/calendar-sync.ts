import type { LocalCourseEvent } from '../domain/learning-experiences';
import type { LocalRepository } from './repository';
import { isPlatformCourse } from './chat-sync';
import { syncNativeCalendar } from './platform-api-client';
import { queueSync, syncPrefix } from './sync-outbox';

type Change = { id: string; deleted?: boolean; updatedAt: number; event?: LocalCourseEvent };
export async function saveSyncedCourseEvents(
  repository: LocalRepository,
  events: LocalCourseEvent[],
) {
  for (const event of events) {
    if (await isPlatformCourse(repository, event.courseId))
      await queueSync(repository, 'calendar', event.courseId, event.id, {
        id: event.id,
        updatedAt: event.updatedAt,
        event,
      } satisfies Change);
  }
  await repository.upsertCourseEvents(events);
  for (const courseId of new Set(events.map((event) => event.courseId))) {
    void syncCourseCalendar(repository, courseId).catch((cause) =>
      console.warn('[calendar-sync] queued', cause),
    );
  }
}
export async function deleteSyncedCourseEvent(
  repository: LocalRepository,
  courseId: string,
  id: string,
) {
  if (await isPlatformCourse(repository, courseId))
    await queueSync(repository, 'calendar', courseId, id, {
      id,
      deleted: true,
      updatedAt: Date.now(),
    } satisfies Change);
  await repository.deleteCourseEvent(courseId, id);
  void syncCourseCalendar(repository, courseId).catch((cause) =>
    console.warn('[calendar-sync] queued deletion', cause),
  );
}

const inFlight = new WeakMap<LocalRepository, Map<string, Promise<boolean>>>();
export function syncCourseCalendar(
  repository: LocalRepository,
  courseId: string,
): Promise<boolean> {
  let running = inFlight.get(repository);
  if (!running) {
    running = new Map();
    inFlight.set(repository, running);
  }
  const current = running.get(courseId);
  if (current) return current;
  const operation = performSync(repository, courseId).finally(() => running!.delete(courseId));
  running.set(courseId, operation);
  return operation;
}
async function performSync(repository: LocalRepository, courseId: string): Promise<boolean> {
  if (!(await isPlatformCourse(repository, courseId))) return false;
  const migrated = syncPrefix('calendar-migrated', courseId);
  if (!(await repository.listSyncEntries(migrated)).length) {
    // Bring schedules created by older app builds into the account once. Never
    // re-upload a remote event merely because it is missing from a bounded list.
    for (const event of await repository.listCourseEvents(courseId)) {
      if (['manual', 'syllabus', 'review-plan', 'ai-proposal'].includes(event.source)) {
        const key = syncPrefix('calendar', courseId) + encodeURIComponent(event.id);
        if (!(await repository.listSyncEntries(key)).some((entry) => entry.key === key))
          await queueSync(repository, 'calendar', courseId, event.id, {
            id: event.id,
            updatedAt: event.updatedAt,
            event,
          });
      }
    }
    await repository.putSyncEntry(migrated, '1');
  }
  const entries = await repository.listSyncEntries(syncPrefix('calendar', courseId));
  const events: LocalCourseEvent[] = [];
  const deleted = new Set<string>();
  async function collect(changes: Change[]) {
    let cursor: string | undefined;
    do {
      const page = await syncNativeCalendar({ courseId, changes: cursor ? [] : changes, cursor });
      events.push(...page.events);
      page.deletedIds.forEach((id) => deleted.add(id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    await collect(batch.map((entry) => JSON.parse(entry.value) as Change));
    for (const entry of batch) await repository.removeSyncEntry(entry.key, entry.value);
  }
  // Read a fresh complete snapshot after all writes; earlier batch snapshots can
  // contain rows superseded by a later batch.
  events.length = 0;
  deleted.clear();
  await collect([]);
  const pending = new Set(
    (await repository.listSyncEntries(syncPrefix('calendar', courseId))).map(
      (entry) => (JSON.parse(entry.value) as Change).id,
    ),
  );
  const local = new Map(
    (await repository.listCourseEvents(courseId)).map((event) => [event.id, event]),
  );
  let changed = false;
  for (const id of deleted) {
    if (!pending.has(id) && local.has(id)) {
      await repository.deleteCourseEvent(courseId, id);
      changed = true;
    }
  }
  for (const event of events) {
    if (pending.has(event.id) || deleted.has(event.id)) continue;
    if (JSON.stringify(local.get(event.id)) !== JSON.stringify(event)) {
      await repository.upsertCourseEvents([event]);
      changed = true;
    }
  }
  return changed;
}
