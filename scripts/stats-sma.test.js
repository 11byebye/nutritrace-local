/**
 * stats-sma — the trailing moving average drawn on the Statistics chart.
 *
 * Pinned behaviour (user request 2026-11-26): a simple (unweighted) mean of
 * the last N charted days; gaps are skipped rather than counted as zero; a
 * point needs at least two finite values in its window; the window at the
 * left edge of the range is shorter instead of omitted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { clampSmaWindow, movingAverage, SMA_WINDOW_MAX, SMA_WINDOW_DEFAULT } from '../src/lib/stats-sma.js';

test('movingAverage: a 3-day window trails the series', () => {
  assert.deepEqual(
    movingAverage([1, 2, 3, 4, 5], 3),
    [null, 1.5, 2, 3, 4],
  );
});

test('movingAverage: gaps are skipped, not zero-filled', () => {
  // window holds 10 and 20 around the empty day -> 15, not 10; the lone
  // reading before it stays undrawn (minCount 2).
  assert.deepEqual(
    movingAverage([10, null, 20], 3),
    [null, null, 15],
  );
});

test('movingAverage: a logged zero still counts', () => {
  assert.deepEqual(
    movingAverage([0, 0, 10], 2),
    [null, 0, 5],
  );
});

test('movingAverage: one value in the window draws nothing', () => {
  assert.deepEqual(
    movingAverage([42, null, null, null], 3),
    [null, null, null, null],
  );
});

test('movingAverage: a window longer than the range keeps working', () => {
  assert.deepEqual(
    movingAverage([2, 4, 6], 90),
    [null, 3, 4],
  );
});

test('movingAverage: one decimal, like the trend line', () => {
  assert.deepEqual(
    movingAverage([1, 1, 2], 3),
    [null, 1, 1.3],
  );
});

test('movingAverage: window 1 falls back to the raw value', () => {
  assert.deepEqual(movingAverage([3, null, 5], 1), [3, null, 5]);
});

test('movingAverage: empty input is an empty result', () => {
  assert.deepEqual(movingAverage([], 7), []);
  assert.deepEqual(movingAverage(null, 7), []);
});

test('clampSmaWindow: bounds and fallback', () => {
  assert.equal(clampSmaWindow(7), 7);
  assert.equal(clampSmaWindow('14'), 14);
  assert.equal(clampSmaWindow(1), 2);
  assert.equal(clampSmaWindow(999), SMA_WINDOW_MAX);
  assert.equal(clampSmaWindow('nope'), SMA_WINDOW_DEFAULT);
  assert.equal(clampSmaWindow(undefined), SMA_WINDOW_DEFAULT);
  assert.equal(clampSmaWindow(7.6), 8);
});
