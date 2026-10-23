import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const platform = dataUrl('export const platformAvailable=()=>true;');
const api = dataUrl(`export const calls=[]; export const responses=new Map();
export async function listSyncedConversations(id,options){calls.push({id,options});const result=responses.get(id+':'+(options.cursor||''));if(result instanceof Error)throw result;return result;}`);
let source = ts.transpileModule(
  readFileSync(new URL('../../apps/native/src/data/recent-chats.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
source = source
  .replace("'./browser-runtime'", `'${platform}'`)
  .replace("'./platform-api-client'", `'${api}'`);
const { mergeRecentChats, syncRecentChatPage } = await import(dataUrl(source));
const { calls, responses } = await import(api);
const chat = (id, courseId, updatedAt) => ({
  id,
  courseId,
  title: id,
  createdAt: 1,
  updatedAt,
  notebookId: null,
});
assert.deepEqual(
  mergeRecentChats(
    ['a', 'b'],
    [
      chat('a1', 'a', 5),
      chat('b1', 'b', 8),
      chat('hidden', 'other-account', 100),
      chat('a1', 'a', 4),
    ],
    [chat('general', null, 6)],
  ).map((row) => row.id),
  ['b1', 'general', 'a1'],
);
const local = [chat('a1', 'a', 10)];
const repository = {
  getPlatformCourseIds: async () => ['a', 'b', 'forbidden'],
  listConversations: async (ids) => local.filter((row) => ids.includes(row.courseId)),
  mergeSyncedConversation: async (row, messages) => {
    assert.deepEqual(messages, []);
    const index = local.findIndex((item) => item.id === row.id);
    if (index >= 0) local[index] = row;
    else local.push(row);
  },
};
const page = (sessions, nextCursor = null) => ({
  sessions,
  nextCursor,
  hasMore: !!nextCursor,
  totalCount: sessions.length,
});
responses.set('a:', page([chat('a1', 'a', 9), chat('a2', 'a', 12)], 'older'));
responses.set('b:', new Error('offline'));
const initial = await syncRecentChatPage(repository, ['a', 'b', 'local-only']);
assert.equal(initial.failed, true);
assert.equal(
  local.find((row) => row.id === 'a1').updatedAt,
  10,
  'stale remote metadata cannot overwrite newer local chat',
);
assert.ok(local.some((row) => row.id === 'a2'));
assert.deepEqual(calls.map((call) => call.id).sort(), ['a', 'b']);
responses.set('a:older', page([chat('a-old', 'a', 2)]));
responses.set('b:', page([chat('b1', 'b', 15)]));
const next = await syncRecentChatPage(repository, ['a', 'b'], { cursors: initial.cursors });
assert.equal(next.failed, false);
assert.ok(local.some((row) => row.id === 'a-old'));
assert.ok(
  local.some((row) => row.id === 'b1'),
  'failed courses retry their first page',
);
assert.equal(calls.at(-1).options.cursor, undefined);
await syncRecentChatPage(repository, ['a', 'b'], { query: 'history' });
assert.deepEqual(
  calls.slice(-2).map((call) => call.options.q),
  ['history', 'history'],
);
console.log(
  'Recent chats: cross-course ordering, account course allowlist, deduplication, metadata-only sync, pagination, partial failure retry and cross-course search passed.',
);
