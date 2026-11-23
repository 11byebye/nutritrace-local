/**
 * stats-scale — the ±1 kg weight window on the Statistics chart.
 *
 * Behaviour pinned by the user request (2026-11-23): the weight y-axis
 * keeps one kilogram beyond the extreme plotted value, the goal included.
 * With a max of 88 the ceiling is 89; with the goal at 78 the floor is 77.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { padForMetric, paddedRange } from '../src/lib/stats-scale.js';

test('paddedRange: nothing finite returns null', () => {
  assert.equal(paddedRange([]), null);
  assert.equal(paddedRange([null, undefined, NaN]), null);
  assert.equal(paddedRange(null), null);
});

test('paddedRange: one kg of air beyond min and max', () => {
  assert.deepEqual(paddedRange([80, 88], { pad: 1 }), { min: 79, max: 89 });
});

test('paddedRange: the goal is just another plotted value', () => {
  // data 80..88, goal 78 -> floor 77, ceiling 89 (the user's example).
  assert.deepEqual(paddedRange([80, 88, 78], { pad: 1 }), { min: 77, max: 89 });
});

test('paddedRange: a single reading still gets a window', () => {
  assert.deepEqual(paddedRange([85], { pad: 1 }), { min: 84, max: 86 });
});

test('paddedRange: gaps are skipped, not zero-filled', () => {
  assert.deepEqual(paddedRange([null, 90, null, 86], { pad: 1 }), { min: 85, max: 91 });
});

test('paddedRange: floors at zero for body measurements', () => {
  assert.deepEqual(paddedRange([0.4, 1.6], { pad: 1 }), { min: 0, max: 2.6 });
  assert.deepEqual(paddedRange([0.4, 1.6], { pad: 1, floorZero: false }), { min: -0.6, max: 2.6 });
});

test('paddedRange: pad 0 is an exact range, and one decimal survives', () => {
  assert.deepEqual(paddedRange([80.44, 88.06], { pad: 0 }), { min: 80.4, max: 88.1 });
  assert.deepEqual(paddedRange([80.44, 88.06], { pad: 1 }), { min: 79.4, max: 89.1 });
});

test('padForMetric: only weight pads, and lb gets the kg equivalent', () => {
  assert.equal(padForMetric('weight', 'kg'), 1);
  assert.equal(padForMetric('weight', 'lb'), 2.20462);
  assert.equal(padForMetric('weight', undefined), 1);
  assert.equal(padForMetric('calories', 'kg'), 0);
  assert.equal(padForMetric('waist', 'kg'), 0);
});

// Wiring guards, in the repo's static-analysis style: the helper existing
// is not the feature; the chart and the Goals page must actually use it.
import { readFileSync } from 'node:fs';

const statsRoute = readFileSync(new URL('../src/routes/Statistics.svelte', import.meta.url), 'utf8');
const goalsRoute = readFileSync(new URL('../src/routes/Goals.svelte', import.meta.url), 'utf8');

test('Statistics wires the padded range into the y scale', () => {
  assert.match(statsRoute, /import \{ padForMetric, paddedRange \} from '\.\.\/lib\/stats-scale\.js'/);
  assert.match(statsRoute, /const _pad = padForMetric\(metric, \$weightUnit\)/);
  assert.match(statsRoute, /_scaleRange = paddedRange\(plotted, \{ pad: _pad \}\)/);
  assert.match(statsRoute, /min: _scaleRange\.min/);
  assert.match(statsRoute, /max: _scaleRange\.max/);
});

test('Goals keeps a Weight row on Your Goals', () => {
  assert.match(goalsRoute, /\$: yourBodyStats = \(\(\) => \{/);
  assert.match(goalsRoute, /\{#each yourBodyStats as stat, i\}/);
});
