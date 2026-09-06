import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
let active;
const instances = [];
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const react = {
  useState(initial) {
    const c = active;
    const i = c.i++;
    if (!(i in c.slots)) c.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      c.slots[i],
      (value) => {
        const next = typeof value === 'function' ? value(c.slots[i]) : value;
        if (!Object.is(next, c.slots[i])) {
          c.slots[i] = next;
          c.dirty = true;
        }
      },
    ];
  },
  useRef(initial) {
    const c = active;
    const i = c.i++;
    return (c.slots[i] ||= { current: initial });
  },
  useMemo(fn, deps) {
    const c = active;
    const i = c.i++;
    if (!same(c.slots[i]?.deps, deps)) c.slots[i] = { deps, value: fn() };
    return c.slots[i].value;
  },
  useCallback(fn, deps) {
    return react.useMemo(() => fn, deps);
  },
  useEffect(fn, deps) {
    const c = active;
    const i = c.i++;
    if (!same(c.slots[i]?.deps, deps)) {
      c.effects.push(() => {
        c.slots[i]?.cleanup?.();
        c.slots[i] = { deps, cleanup: fn() };
      });
    }
  },
};
let owner = 'student-a';
let rows = [];
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(owner));
global.window = new EventTarget();
let deferredRead = null;
let failWrite = false;
const api = {
  learningCalendarMonthRange: () => ({ start: '2026-09-01', end: '2026-09-30' }),
  learningCalendarCompactRange: () => ({ start: '2026-09-01', end: '2026-12-31' }),
  learningCalendarCreateInput: (event, courseId) => ({ ...event, courseId }),
  makeLearningCalendarIdempotencyKey: () => 'test-key',
  listLearningCalendarEvents: async (args) => {
    const result = {
      events: rows
        .filter((r) => r.owner === owner && (!args.courseId || r.courseId === args.courseId))
        .map((r) => ({ ...r })),
      truncated: false,
    };
    if (deferredRead) {
      const pending = deferredRead;
      deferredRead = null;
      await pending.promise;
    }
    return result;
  },
  createLearningCalendarEvents: async ({ events }) => {
    if (failWrite) throw new Error('offline');
    const saved = events.map((e) => ({
      ...e,
      owner,
      id: `remote-${e.id}`,
      clientEventId: e.id,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    rows.push(...saved);
    notify();
    return { events: saved };
  },
  updateLearningCalendarEvent: async ({ eventId, expectedVersion, patch }) => {
    const row = rows.find((r) => r.id === eventId && r.owner === owner);
    assert.equal(row.version, expectedVersion);
    Object.assign(row, patch, { version: row.version + 1 });
    notify();
    return { event: { ...row } };
  },
  deleteLearningCalendarEvent: async ({ eventId, expectedVersion }) => {
    const row = rows.find((r) => r.id === eventId && r.owner === owner);
    assert.equal(row.version, expectedVersion);
    rows = rows.filter((r) => r !== row);
    notify();
    return { eventId, deleted: true };
  },
};
const source = readFileSync(
  'features/learning-calendar/client/use-learning-calendar-range.ts',
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', code)(
  (id) => {
    if (id === 'react') return react;
    if (id === '@/lib/store/auth')
      return { useAuthStore: (selector) => selector({ userId: owner }) };
    if (id.includes('calendar-changes'))
      return {
        subscribeLearningCalendarChanges: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    if (id.includes('calendar-api')) return api;
    throw new Error(`Unexpected import ${id}`);
  },
  mod,
  mod.exports,
);
const referenceDate = new Date('2026-09-06T12:00:00Z');
function mount(courseId) {
  const c = { slots: [], effects: [], i: 0, dirty: true, args: { referenceDate, courseId } };
  instances.push(c);
  return c;
}
async function flush() {
  for (let n = 0; n < 30; n++) {
    for (const c of instances)
      if (c.dirty) {
        c.dirty = false;
        c.i = 0;
        active = c;
        c.result = mod.exports.useLearningCalendarRange(c.args);
        c.effects.splice(0).forEach((fn) => fn());
      }
    await new Promise((resolve) => setImmediate(resolve));
    if (!instances.some((c) => c.dirty)) return;
  }
  throw new Error('Render loop');
}
const account = mount();
const course = mount('bus200');
await flush();
const make = (id) => ({
  id,
  title: id,
  date: '2026-09-06',
  kind: 'progress',
  sourceName: 'BUS200',
  createdAt: Date.now(),
});
await course.result.createEvents([make('course-event')]);
await flush();
assert.equal(account.result.events[0].title, 'course-event');
assert.equal(account.result.events[0].courseId, 'bus200');
await account.result.updateEvent(account.result.events[0], { title: 'edited from global' });
await flush();
assert.equal(course.result.events[0].title, 'edited from global');
await account.result.createEvents([make('personal-event')]);
await flush();
assert.equal(account.result.events.length, 2);
assert.equal(course.result.events.length, 1);
let release;
deferredRead = {
  promise: new Promise((resolve) => {
    release = resolve;
  }),
};
const staleLoad = account.result.reload();
await course.result.deleteEvent(course.result.events[0]);
await flush();
release();
await staleLoad;
await flush();
assert.equal(account.result.events.length, 1);
assert.equal(course.result.events.length, 0);
failWrite = true;
await assert.rejects(course.result.createEvents([make('failed-event')]));
await flush();
assert.equal(course.result.events.length, 0);
failWrite = false;
owner = 'student-b';
instances.forEach((c) => {
  c.dirty = true;
});
await flush();
assert.equal(account.result.events.length, 0);
assert.equal(course.result.events.length, 0);
owner = 'student-a';
instances.forEach((c) => {
  c.dirty = true;
});
await flush();
assert.equal(account.result.events.length, 1);
instances.forEach((c) => c.slots.forEach((slot) => slot?.cleanup?.()));
assert.equal(listeners.size, 0);
console.log(
  'PASS actual calendar hook: course/global create-update-delete sync, personal isolation, stale responses, failed-write rollback, account isolation, subscription cleanup',
);
