/**
 * Picking an ActionSheet item opens another layer (edit sheet, picker,
 * confirm). Sliding this menu away while the next layer slides in stacked a
 * stale panel and two scrims on screen — the flicker reported 2026-11-27.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/ui/ActionSheet.svelte', import.meta.url), 'utf8');

test('a picked action leaves instantly and only the scrim fades', () => {
  assert.match(src, /const pick\s+= \(a\) => \{ _leaving = true; open = false; dispatch\('select', a\); \}/);
  assert.match(src, /out:fade=\{\{ duration: _leaving \? 200 : 140 \}\}/, 'scrim matches the next layer fade');
  assert.match(src, /out:fly=\{\{ y: 60, duration: _leaving \? 0 : 180 \}\}/, 'the panel does not linger');
});

test('a cancel still animates out', () => {
  const cancel = src.slice(src.indexOf('const cancel'));
  assert.doesNotMatch(cancel.slice(0, cancel.indexOf('\n')), /_leaving/);
});
