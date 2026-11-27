/**
 * Web/PWA back on Android: the installed PWA has no Capacitor backButton
 * listener, so back used to pop the hash router to a blank route instead of
 * closing the open sheet. back-stack now keeps one spare history entry while
 * a layer is open; back closes the layer and puts it back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub the browser globals before the module loads. node:test runs each file
// in its own process, so this cannot leak into back-stack.test.js.
const listeners = {};
const entries = [{ state: null, url: '#/' }];
const history = {
  get state() { return entries[entries.length - 1].state; },
  pushState(state, _title, url) {
    entries.push({ state, url: url ?? entries[entries.length - 1].url });
  },
  back() { entries.pop(); listeners.popstate?.({}); },
};
globalThis.window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
globalThis.history = history;

const { onBack, backStackDepth } = await import('../src/lib/back-stack.js');

// What the browser does on a real back press: the entry is gone, then the
// page hears popstate.
function userBack() {
  entries.pop();
  listeners.popstate({});
}

test('opening the first layer pushes one spare entry', () => {
  const release = onBack(() => {});
  assert.equal(backStackDepth(), 1);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].state.ntBackGuard, 1);
  release();
});

test('back closes the top layer and keeps the guard while another is open', () => {
  const closed = [];
  // A real layer removes its element when closed, which releases the entry;
  // mirror that here so the stack shrinks as it does in the app.
  let a, b;
  a = onBack(() => { closed.push('a'); a(); });
  b = onBack(() => { closed.push('b'); b(); });
  assert.equal(entries.length, 2, 'one guard for the whole stack, not one per layer');

  userBack();
  assert.deepEqual(closed, ['b']);
  assert.equal(backStackDepth(), 1);
  assert.equal(entries.length, 2, 'the guard is put back for the next press');
  assert.equal(entries[1].state.ntBackGuard, 1);

  userBack();
  assert.deepEqual(closed, ['b', 'a']);
  assert.equal(backStackDepth(), 0);
  assert.equal(entries.length, 1, 'and the last layer leaves no spare entry');
});

test('closing the last layer with its own button pops the spare entry', () => {
  const release = onBack(() => {});
  assert.equal(entries.length, 2);
  release();
  assert.equal(entries.length, 1, 'the X does not cost a dead back press');
});

test('a stale guard is left alone when the page navigated away', () => {
  const release = onBack(() => {});
  assert.equal(entries.length, 2);
  history.pushState(null, '', '#/foods');     // a tab/link changed the page
  const before = entries.length;
  release();
  assert.equal(entries.length, before, 'the navigation is not undone');
});

test('with nothing open, a back press is a normal page back', () => {
  const before = entries.length;
  globalThis.history.pushState(null, '', '#/');
  userBack();
  assert.equal(entries.length, before);
  assert.equal(backStackDepth(), 0);
});
