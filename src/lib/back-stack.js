/**
 * back-stack.js: what Android's back button (or gesture) closes first.
 *
 * Sheets, dialogs and full-screen overlays register a handler while they're
 * open; back runs the most recent one instead of leaving the page underneath
 * (#226: back did nothing visible with Body Stats open, because it only knew
 * how to go back a page). With nothing registered, back goes back a page and
 * then offers to exit, as before.
 *
 * In markup, attach it to the element that exists only while the layer is
 * open, and pass the same close action as the layer's own close button:
 *
 *   <div class="sheet-backdrop" use:closeOnBack={close}>
 *
 * A layer that must be answered (the sync merge dialog) passes a no-op, so
 * back neither dismisses it nor navigates away underneath it.
 */
const stack = [];

// Web back (the PWA on Android has no Capacitor listener): while a layer is
// open, one spare history entry sits on top of the page. Back pops it and the
// popstate handler closes the layer and puts the entry back, so the diary
// underneath never navigates away. When the last layer closes any other way,
// the spare entry is popped silently.
let _guard = false;
let _silent = false;
const GUARD_STATE = { ntBackGuard: 1 };

function _pushGuard() {
  if (_guard || typeof window === 'undefined' || typeof history === 'undefined') return;
  try { history.pushState(GUARD_STATE, ''); _guard = true; } catch { /* no history (tests, SSR) */ }
}

function _currentIsGuard() {
  try { return !!(history.state && history.state.ntBackGuard); } catch { return false; }
}

function _popGuard() {
  if (!_guard) return;
  _guard = false;
  // Closed because the page changed (a link, a tab): the spare entry is no
  // longer on top, so leave it alone rather than undo the navigation.
  if (!_currentIsGuard()) return;
  _silent = true;
  try { history.back(); } catch { _silent = false; }
}

/** Register `handler` for the next back press. Returns a release function. */
export function onBack(handler) {
  const entry = { handler };
  stack.push(entry);
  if (stack.length === 1) _pushGuard();
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) _popGuard();
  };
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('popstate', () => {
    if (_silent) { _silent = false; return; }
    _guard = false;                       // the browser consumed the spare entry
    if (!stack.length) return;            // nothing open: a normal page back
    handleBack();
    // More layers still open: keep the guard so the next back closes them.
    if (stack.length) _pushGuard();
  });
}

/**
 * Run the topmost handler. True when something took the back press.
 *
 * The entry stays registered until its layer releases it (closeOnBack does
 * that when the element is removed), so a layer whose back action is a
 * deliberate no-op keeps catching back instead of letting the next press
 * navigate away underneath it.
 */
export function handleBack() {
  const entry = stack[stack.length - 1];
  if (!entry) return false;
  try { entry.handler(); } catch { /* the layer is gone either way */ }
  return true;
}

/** How many layers are waiting on back (for tests and diagnostics). */
export function backStackDepth() {
  return stack.length;
}

/**
 * Svelte action: register while the element is mounted, release when it's
 * removed (closed any other way, or the page changes).
 */
export function closeOnBack(node, handler) {
  let current = handler;
  const release = onBack(() => { if (typeof current === 'function') current(); });
  return {
    update(next) { current = next; },
    destroy: release,
  };
}
