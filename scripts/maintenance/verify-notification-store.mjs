import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const req = createRequire(process.cwd() + '/package.json');
const ts = req('typescript');
import assert from 'node:assert/strict';
const data = new Map();
const localStorage = {
  getItem: (k) => data.get(k) || null,
  setItem: (k, v) => data.set(k, v),
  removeItem: (k) => data.delete(k),
};
function load() {
  const compiledModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('lib/store/notifications.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      require: req,
      module: compiledModule,
      exports: compiledModule.exports,
      localStorage,
      console,
    },
  );
  return compiledModule.exports.useNotificationStore;
}
const store = load();
const event = (id) => ({
  id,
  kind: 'study_nudge',
  title: '完成',
  body: '结果已准备好',
  tone: 'positive',
  presentation: 'banner',
  createdAt: new Date().toISOString(),
  details: [],
});
store.getState().setActiveUser('teacher-a');
store.getState().enqueueBanner(event('one'));
store.getState().enqueueBanner(event('one'));
assert.equal(store.getState().unreadCount, 1, 'dedupe');
store.getState().dismissBanner('one');
assert.equal(store.getState().unreadCount, 1, 'dismiss does not read');
assert.equal(store.getState().activeBanners.length, 0);
store.getState().enqueueBanner(event('two'));
store.getState().setActiveUser('teacher-b');
assert.equal(store.getState().notifications.length, 0, 'account isolation');
store.getState().setActiveUser('teacher-a');
assert.equal(store.getState().notifications.length, 2);
assert.equal(store.getState().activeBanners.length, 0, 'no replay');
store.getState().markAsRead('one');
assert.equal(store.getState().unreadCount, 1);
const restored = load();
restored.getState().setActiveUser('teacher-a');
assert.equal(restored.getState().notifications.length, 2, 'refresh retains history');
assert.equal(restored.getState().unreadCount, 1, 'refresh retains read state');
restored.getState().deleteNotification('two');
assert.equal(restored.getState().unreadCount, 0);
restored.getState().clearSession();
restored.getState().setActiveUser('teacher-a');
assert.equal(restored.getState().notifications.length, 1, 'logout retains own history');
console.log('PASS dedupe, dismiss/unread, account isolation, reload, delete, logout');
