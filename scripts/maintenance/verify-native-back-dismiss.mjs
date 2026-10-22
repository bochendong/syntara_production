import assert from 'node:assert/strict';
import { createBackDismissStack } from '../../apps/native/src/lib/back-dismiss-stack.ts';

function browser() {
  const microtasks = [];
  const navigations = [];
  const entries = [{ external: true }, { app: true }];
  let cursor = 1;
  const history = {
    get state() {
      return entries[cursor];
    },
    pushState(state) {
      entries.splice(cursor + 1);
      entries.push(state);
      cursor += 1;
    },
    back() {
      navigations.push(() => {
        cursor -= 1;
        stack.pop();
      });
    },
  };
  const stack = createBackDismissStack(history, (run) => microtasks.push(run));
  const flush = () => {
    while (microtasks.length) microtasks.shift()();
  };
  const navigate = () => {
    navigations.shift()?.();
    flush();
  };
  return {
    stack,
    history,
    flush,
    navigate,
    pending: () => navigations.length,
    cursor: () => cursor,
  };
}

// React StrictMode setup/cleanup/setup must produce only one browser guard.
{
  const b = browser();
  const release = b.stack.add(() => {});
  release();
  const releaseAgain = b.stack.add(() => {});
  b.flush();
  assert.equal(b.cursor(), 2);
  releaseAgain();
  b.flush();
  b.navigate();
  assert.equal(b.cursor(), 1);
  assert.equal(b.pending(), 0);
}

// The reported regression: drawer -> profile -> returned drawer, repeated.
{
  const b = browser();
  let release = b.stack.add(() => {});
  b.flush();
  for (let i = 0; i < 20; i++) {
    release();
    release = b.stack.add(() => {});
    b.flush();
    release();
    release = b.stack.add(() => {});
    b.flush();
    assert.equal(b.pending(), 0, 'a drawer/page replacement must not rewind history');
    assert.equal(b.cursor(), 2);
  }
  release();
  b.flush();
  b.navigate();
  assert.equal(b.cursor(), 1, 'closing the last layer must leave the app entry intact');
}

// Hardware/browser Back dismisses the top layer even if parent effects run last.
{
  const b = browser();
  const calls = [];
  b.stack.add(() => calls.push('profile'), 10);
  b.stack.add(() => calls.push('course'), 0);
  b.stack.add(() => calls.push('editor'), 20);
  b.flush();
  b.history.back();
  b.navigate();
  assert.deepEqual(calls, ['editor']);
  b.history.back();
  b.navigate();
  assert.deepEqual(calls, ['editor', 'profile']);
  b.history.back();
  b.navigate();
  assert.deepEqual(calls, ['editor', 'profile', 'course']);
  assert.equal(b.cursor(), 1);
}

// A new layer may open before the browser acknowledges an earlier UI close.
{
  const b = browser();
  const calls = [];
  const release = b.stack.add(() => calls.push('old'));
  b.flush();
  release();
  b.flush();
  b.stack.add(() => calls.push('new'));
  b.flush();
  b.navigate();
  assert.equal(b.cursor(), 2);
  assert.deepEqual(calls, []);
  b.history.back();
  b.navigate();
  assert.deepEqual(calls, ['new']);
  assert.equal(b.cursor(), 1);
}

// Never rewind another router's entry while cleaning up our UI.
{
  const b = browser();
  const release = b.stack.add(() => {});
  b.flush();
  b.history.pushState({ anotherRouter: true });
  release();
  b.flush();
  assert.equal(b.pending(), 0);
}
console.log(
  'Native back navigation: StrictMode, 20 drawer/profile swaps, nested Back, pending navigation and foreign history passed.',
);
