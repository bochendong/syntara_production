import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const warning = console.warn;
console.warn = (message, cause) => warning(message, cause instanceof Error ? cause.message : cause);
const root = fileURLToPath(new URL('../../', import.meta.url));
const url = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const cache = new Map();
function moduleUrl(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  let source = readFileSync(file, 'utf8');
  if (file.endsWith('/chat-sync.ts')) source += '\nexport { toSyncedMessage, fromSyncedMessage };';
  source = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (match, specifier) => {
    if (specifier === './repository')
      return `from '${url('export const getLocalRepository=async()=>globalThis.__syncRepository;')}'`;
    if (specifier.endsWith('browser-runtime'))
      return `from '${url('export const platformAvailable=()=>true; export const browserAccountId=()=>"account-a"; export const accountStorageKey=(key)=>key;')}'`;
    if (specifier.endsWith('platform-api-client'))
      return `from '${url(['deleteSyncedConversation', 'listNativePlatformCourses', 'listSyncedConversations', 'loadSyncedConversation', 'pushSyncedConversation', 'syncNativeCalendar', 'saveNativeLearningProgress', 'getGeneralConversations', 'saveGeneralConversation', 'removeGeneralConversation', 'runNativeChatTurn'].map((name) => `export const ${name}=(...args)=>globalThis.__syncApi.${name}(...args);`).join('\n'))}'`;
    if (specifier === '@/lib/server/study-memory-store')
      return `from '${url('export const resolveReadableStudyMemoryTarget=async()=>globalThis.__syncApi.allowed?{}:null;')}'`;
    if (specifier.startsWith('@/')) specifier = path.resolve(root, specifier.slice(2));
    else if (specifier.startsWith('.')) specifier = path.resolve(path.dirname(file), specifier);
    else return `from '${import.meta.resolve(specifier)}'`;
    if (!path.extname(specifier)) specifier += '.ts';
    assert.ok(existsSync(specifier), specifier);
    return `from '${moduleUrl(path.relative(root, specifier))}'`;
  });
  const result = url(source);
  cache.set(file, result);
  return result;
}
const chat = await import(moduleUrl('apps/native/src/data/chat-sync.ts'));
const calendar = await import(moduleUrl('apps/native/src/data/calendar-sync.ts'));
const progress = await import(moduleUrl('apps/native/src/data/progress-sync.ts'));
const server = await import(moduleUrl('lib/server/native-calendar-sync.ts'));
const general = await import(moduleUrl('apps/native/src/data/general-chat.ts'));
const pendingSync = await import(moduleUrl('apps/native/src/data/pending-sync.ts'));
function repository() {
  const entries = new Map();
  const entryTimes = new Map();
  const events = new Map();
  const messages = new Map();
  const conversations = new Map();
  return {
    entries,
    events,
    messages,
    conversations,
    getPlatformCourseIds: async () => ['course'],
    putSyncEntry: async (key, value, at = Date.now()) => {
      if ((entryTimes.get(key) ?? 0) <= at) {
        entries.set(key, value);
        entryTimes.set(key, at);
      }
    },
    loadCourseWorkspace: async () => ({ notebooks: [] }),
    listSyncEntries: async (prefix) =>
      [...entries]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
    removeSyncEntry: async (key, value) => {
      if (entries.get(key) === value) entries.delete(key);
    },
    listMessages: async (id) =>
      [...messages.values()].filter((message) => message.conversationId === id),
    deleteConversation: async (id) => {
      conversations.delete(id);
      for (const [key, item] of messages) if (item.conversationId === id) messages.delete(key);
    },
    mergeSyncedConversation: async (conversation, incoming, deleted = []) => {
      conversations.set(conversation.id, conversation);
      for (const item of incoming) messages.set(item.id, item);
      deleted.forEach((id) => messages.delete(id));
      return incoming.length;
    },
    listCourseEvents: async () => [...events.values()],
    upsertCourseEvents: async (incoming) =>
      incoming.forEach((event) => events.set(event.id, event)),
    deleteCourseEvent: async (_, id) => events.delete(id),
  };
}
const conversation = { id: 'chat', courseId: 'course', title: 'Chat', createdAt: 1, updatedAt: 2 };
const event = {
  id: 'event',
  courseId: 'course',
  title: 'Exam',
  date: '2026-11-01',
  note: 'Bring pencil',
  kind: 'exam',
  source: 'manual',
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
};

test('rich content round trip preserves images, files, references and cards, excludes device/provider state', () => {
  const local = {
    id: 'message',
    conversationId: 'chat',
    role: 'assistant',
    text: 'Answer',
    createdAt: 1,
    metadata: {
      images: [{ name: 'photo.jpg', thumbnailDataUrl: 'data:image/jpeg;base64,AA==' }],
      files: [{ name: 'notes.pdf', kind: 'pdf', size: 8 }],
      evidence: [{ sourceType: 'notebook', sourceId: 'n1' }],
      reviewPlan: { id: 'p', title: 'Plan', tasks: [] },
      learningActions: [{ id: 'action', kind: 'calendar.propose_add', label: 'Add' }],
      lectureDeckId: '/local/path',
      model: { provider: 'private' },
    },
  };
  const wire = chat.toSyncedMessage(local);
  const restored = chat.fromSyncedMessage(wire, 'chat', 2);
  assert.deepEqual(restored.metadata.images, local.metadata.images);
  assert.deepEqual(restored.metadata.files, local.metadata.files);
  assert.deepEqual(restored.metadata.evidence, local.metadata.evidence);
  assert.deepEqual(restored.metadata.reviewPlan, local.metadata.reviewPlan);
  assert.equal(restored.metadata.lectureDeckId, undefined);
  assert.equal(restored.metadata.model, undefined);
});

test('server message tombstones are consumed without discarding unsent unknown sessions', async () => {
  const repo = repository();
  repo.messages.set('gone', { id: 'gone', conversationId: 'chat' });
  repo.conversations.set('chat', conversation);
  globalThis.__syncApi = {
    loadSyncedConversation: async () => ({
      session: conversation,
      messages: [],
      deletedMessageIds: ['gone'],
      currentRevision: 4,
    }),
  };
  await chat.refreshConversationMessages(repo, 'course', 'chat');
  assert.equal(repo.messages.has('gone'), false);
  globalThis.__syncApi.loadSyncedConversation = async () => ({ session: null, currentRevision: 0 });
  await chat.refreshConversationMessages(repo, 'course', 'chat');
  assert.equal(repo.conversations.has('chat'), true);
  globalThis.__syncApi.loadSyncedConversation = async () => ({ session: null, currentRevision: 5 });
  await chat.refreshConversationMessages(repo, 'course', 'chat');
  assert.equal(repo.conversations.has('chat'), false);
});

test('chat outbox survives failures, retries more than 40 messages without losing older unsent content', async () => {
  const repo = repository();
  for (let i = 0; i < 65; i++)
    repo.messages.set(String(i), {
      id: String(i),
      conversationId: 'chat',
      role: 'user',
      text: 'x',
      createdAt: i,
    });
  globalThis.__syncApi = {
    pushSyncedConversation: async () => {
      throw Error('offline');
    },
  };
  await assert.rejects(chat.pushConversation(repo, conversation), /offline/);
  assert.equal(repo.entries.size, 1);
  const received = [];
  globalThis.__syncApi.pushSyncedConversation = async (payload) => {
    received.push(...payload.messages);
    return { accepted: true };
  };
  await chat.flushConversationOutbox(repo, 'course');
  assert.equal(received.length, 65);
  assert.equal(repo.entries.size, 0);
});

test('offline conversation deletion is durable and removes stale upload entries before retrying', async () => {
  const repo = repository();
  repo.messages.set('m', {
    id: 'm',
    conversationId: 'chat',
    role: 'user',
    text: 'x',
    createdAt: 1,
  });
  globalThis.__syncApi = {
    pushSyncedConversation: async () => {
      throw Error('offline');
    },
    loadSyncedConversation: async () => {
      throw Error('offline');
    },
  };
  await assert.rejects(chat.pushConversation(repo, conversation));
  await chat.deleteRemoteConversation(repo, conversation);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(repo.entries.size, 2);
  let removed = 0;
  globalThis.__syncApi = {
    loadSyncedConversation: async () => ({ session: conversation, currentRevision: 3 }),
    deleteSyncedConversation: async () => {
      removed++;
      return { accepted: true };
    },
    pushSyncedConversation: async () => {
      throw Error('must not resurrect');
    },
  };
  await chat.flushConversationOutbox(repo, 'course');
  assert.equal(removed, 1);
  assert.equal(repo.entries.size, 0);
});

test('calendar retries offline creation and consumes explicit deletion across devices', async () => {
  const repo = repository();
  globalThis.__syncApi = {
    syncNativeCalendar: async () => {
      throw Error('offline');
    },
  };
  await calendar.saveSyncedCourseEvents(repo, [event]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(repo.entries.size);
  let changes = [];
  globalThis.__syncApi.syncNativeCalendar = async (payload) => {
    changes.push(...payload.changes);
    return { events: [event], deletedIds: [], nextCursor: null };
  };
  await calendar.syncCourseCalendar(repo, 'course');
  assert.ok(changes.some((change) => change.id === 'event'));
  globalThis.__syncApi.syncNativeCalendar = async () => ({
    events: [],
    deletedIds: ['event'],
    nextCursor: null,
  });
  await calendar.syncCourseCalendar(repo, 'course');
  assert.equal(repo.events.has('event'), false);
  await calendar.syncCourseCalendar(repo, 'course');
  assert.equal(repo.events.has('event'), false);
});

test('calendar validates dates and requires course access before database reads', async () => {
  assert.equal(
    server.nativeCalendarMutationSchema.safeParse({
      courseId: 'course',
      changes: [{ id: 'e', updatedAt: 1, event: { ...event, date: '2026-02-30' } }],
    }).success,
    false,
  );
  globalThis.__syncApi = { allowed: false };
  assert.equal(
    await server.syncNativeCalendar({}, 'owner', { courseId: 'course', changes: [] }),
    null,
  );
});

function calendarDatabase() {
  const rows = new Map();
  const table = {
    findUnique: async ({ where }) => rows.get(where.id) ?? null,
    create: async ({ data }) => {
      assert.ok(!rows.has(data.id));
      const row = { version: 1, deletedAt: null, createdAt: new Date(1), ...data };
      rows.set(data.id, row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = rows.get(where.id);
      if (
        !row ||
        row.ownerId !== where.ownerId ||
        row.courseId !== where.courseId ||
        row.version !== where.version ||
        (row.deletedAt?.getTime() ?? 0) !== (where.deletedAt?.getTime() ?? 0)
      )
        return { count: 0 };
      rows.set(where.id, { ...row, ...data, version: row.version + 1 });
      return { count: 1 };
    },
    findMany: async ({ where, take, cursor }) =>
      [...rows.values()]
        .filter(
          (row) =>
            row.ownerId === where.ownerId &&
            row.courseId === where.courseId &&
            (!cursor || row.id > cursor.id),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take),
  };
  const prisma = {
    learningCalendarEvent: table,
    $queryRaw: async (strings) => {
      assert.match(
        strings.join('?'),
        /pg_advisory_xact_lock[\s\S]*::text AS "locked"/,
        'Prisma raw lock results must use a supported PostgreSQL column type',
      );
      return [];
    },
    $transaction: async (operation) => operation(prisma),
  };
  return { prisma, rows };
}

test('two independent calendar replicas share create, edit and delete; stale offline edits never resurrect tombstones', async () => {
  const { prisma, rows } = calendarDatabase();
  const a = repository();
  const b = repository();
  globalThis.__syncApi = {
    allowed: true,
    syncNativeCalendar: async (payload) =>
      server.syncNativeCalendar(
        prisma,
        'owner',
        server.nativeCalendarMutationSchema.parse(payload),
      ),
  };
  await calendar.saveSyncedCourseEvents(a, [event]);
  await calendar.syncCourseCalendar(a, 'course');
  await calendar.syncCourseCalendar(b, 'course');
  assert.equal(b.events.get(event.id).note, 'Bring pencil');
  const updated = { ...b.events.get(event.id), title: 'Final exam', updatedAt: 10 };
  await calendar.saveSyncedCourseEvents(b, [updated]);
  await calendar.syncCourseCalendar(b, 'course');
  await calendar.syncCourseCalendar(a, 'course');
  assert.equal(a.events.get(event.id).title, 'Final exam');
  await calendar.deleteSyncedCourseEvent(a, 'course', event.id);
  await calendar.syncCourseCalendar(a, 'course');
  await calendar.saveSyncedCourseEvents(b, [{ ...updated, title: 'Stale', updatedAt: 20 }]);
  await calendar.syncCourseCalendar(b, 'course');
  assert.ok(rows.get(event.id).deletedAt);
  assert.equal(b.events.has(event.id), false);
  await calendar.syncCourseCalendar(a, 'course');
  assert.equal(a.events.has(event.id), false);
});

test('calendar rejects event IDs owned by another account and keeps out-of-range dates via paginated sync', async () => {
  const { prisma, rows } = calendarDatabase();
  globalThis.__syncApi = { allowed: true };
  rows.set('foreign', {
    ...event,
    ownerId: 'someone-else',
    courseId: 'course',
    updatedAt: new Date(1),
  });
  await assert.rejects(
    server.syncNativeCalendar(prisma, 'owner', {
      courseId: 'course',
      changes: [{ id: 'foreign', updatedAt: 5, event }],
    }),
    /does not belong/,
  );
  for (let i = 0; i < 501; i++)
    rows.set(String(i).padStart(4, '0'), {
      id: String(i).padStart(4, '0'),
      ownerId: 'owner',
      courseId: 'course',
      title: 'Old event',
      kind: 'other',
      eventDate: new Date('2020-01-01'),
      rawText: '',
      status: 'planned',
      createdAt: new Date(1),
      updatedAt: new Date(1),
    });
  const first = await server.syncNativeCalendar(prisma, 'owner', {
    courseId: 'course',
    changes: [],
  });
  assert.equal(first.events.length, 500);
  assert.ok(first.nextCursor);
  const second = await server.syncNativeCalendar(prisma, 'owner', {
    courseId: 'course',
    changes: [],
    cursor: first.nextCursor,
  });
  assert.equal(second.events.length, 1);
  assert.equal(second.nextCursor, null);
});

test('progress retries offline saves and rejects an older delayed queue write', async () => {
  const repo = repository();
  globalThis.__syncApi = {
    saveNativeLearningProgress: async () => {
      throw Error('offline');
    },
  };
  await assert.rejects(progress.pushLearningProgress(repo, 'course', 2, null, 20), /offline/);
  await assert.rejects(progress.pushLearningProgress(repo, 'course', 0, null, 10), /offline/);
  let saved;
  globalThis.__syncApi.saveNativeLearningProgress = async (payload) => {
    saved = payload;
  };
  await progress.flushLearningProgress(repo, 'course');
  assert.equal(saved.kind, 'completed_all');
  assert.equal(saved.updatedAt, 20);
  assert.equal(repo.entries.size, 0);
});

test('an in-flight progress acknowledgement cannot erase a newer pending save', async () => {
  const repo = repository();
  let release;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.__syncApi = {
    saveNativeLearningProgress: async () => {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const first = progress.pushLearningProgress(repo, 'course', 0, null, 10);
  await ready;
  const second = progress.pushLearningProgress(repo, 'course', 2, null, 20);
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await Promise.all([first, second]);
  assert.equal(repo.entries.size, 1);
  let saved;
  globalThis.__syncApi.saveNativeLearningProgress = async (payload) => {
    saved = payload;
  };
  await progress.flushLearningProgress(repo, 'course');
  assert.equal(saved.updatedAt, 20);
  assert.equal(repo.entries.size, 0);
});

test('explicitly re-adding a deleted review task uses a new generation; a late old deletion cannot remove it', async () => {
  const { prisma, rows } = calendarDatabase();
  globalThis.__syncApi = { allowed: true };
  const now = Date.now();
  rows.set('review', {
    id: 'review',
    ownerId: 'owner',
    courseId: 'course',
    version: 2,
    deletedAt: new Date(now - 100),
    createdAt: new Date(1),
    updatedAt: new Date(now - 100),
    eventDate: new Date('2026-11-01'),
  });
  await server.syncNativeCalendar(prisma, 'owner', {
    courseId: 'course',
    changes: [{ id: 'review', updatedAt: now, event: { ...event, createdAt: now } }],
  });
  assert.equal(rows.get('review').deletedAt, null);
  await server.syncNativeCalendar(prisma, 'owner', {
    courseId: 'course',
    changes: [{ id: 'review', deleted: true, updatedAt: now - 50 }],
  });
  assert.equal(rows.get('review').deletedAt, null);
});

test('general-chat retries discard messages belonging to deleted conversations without poisoning other chats', async () => {
  const repo = repository();
  globalThis.__syncRepository = repo;
  globalThis.__syncApi = {
    saveGeneralConversation: async () => {
      throw Error('offline');
    },
  };
  const message = {
    id: 'old-general-message',
    role: 'assistant',
    text: 'saved locally',
    createdAt: 1,
  };
  await assert.rejects(general.generalChatClient.append('deleted-chat', message), /offline/);
  let saves = 0;
  globalThis.__syncApi = {
    getGeneralConversations: async () => ({ conversations: [{ id: 'other-chat' }] }),
    saveGeneralConversation: async () => {
      saves++;
      throw Error('deleted message must not upload');
    },
  };
  const rows = await general.generalChatClient.list();
  assert.equal(rows[0].id, 'other-chat');
  assert.equal(saves, 0);
  assert.equal(repo.entries.size, 0);
});

test('global reconnect flushes queues for a course that is no longer open', async () => {
  const repo = repository();
  globalThis.__syncRepository = repo;
  globalThis.__syncApi = {
    saveNativeLearningProgress: async () => {
      throw Error('offline');
    },
  };
  await assert.rejects(progress.pushLearningProgress(repo, 'course', 1, null, 100));
  let uploads = 0;
  globalThis.__syncApi.saveNativeLearningProgress = async () => {
    uploads++;
  };
  await pendingSync.flushPendingAccountChanges(repo, ['course']);
  assert.equal(uploads, 1);
  assert.equal(repo.entries.size, 0);
});
