/**
 * The food editor must open on the server's copy (user 2026-11-20).
 *
 * The Foods list lives in memory, and saving the editor PUTs the whole row.
 * A tab whose list was loaded before a repair therefore wrote the stale
 * nutrition back the moment one field (the price) was edited — a corrected
 * protein powder reverted from 72,5 g to 29 g protein that way.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/routes/Foods.svelte', import.meta.url), 'utf8');

test('openEditor refetches the food before prefilling the editor', () => {
  assert.match(src, /async function openEditor\(/, 'openEditor must be async');
  const body = src.slice(src.indexOf('async function openEditor('));
  const end = body.indexOf('\n  }');
  const fn = body.slice(0, end);
  assert.match(fn, /NtApi\.getFood\(item\.id\)/, 'openEditor does not refetch the row');
  assert.match(fn, /\.\.\.item, \.\.\.fresh/, 'the fresh row must be merged over the list copy');
});
