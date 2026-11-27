/**
 * A single tap on a logged food opens the item action sheet, never the edit
 * sheet (user 2026-11-27: the long-press menu holds Edit/Remove and is the
 * quick path, so a tap has to reach it too). Quick-calorie rows keep their
 * own tap behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/routes/Diary.svelte', import.meta.url), 'utf8');

test('the food row tap routes through openItemMenu', () => {
  assert.match(src, /function openItemMenu\(item\) \{/);
  assert.match(src, /on:click=\{\(\) => openItemMenu\(item\)\}/);
  const menu = src.slice(src.indexOf('function openItemMenu(item) {'));
  const fn = menu.slice(0, menu.indexOf('\n  }'));
  assert.match(fn, /actionItem = item/);
  assert.match(fn, /showItemAction = true/);
  assert.doesNotMatch(fn, /openEditItem/, 'a tap must not open the edit sheet');
});

test('the action sheet still offers Edit first', () => {
  const sheet = src.slice(src.indexOf('<ActionSheet'), src.indexOf('/>', src.indexOf('<ActionSheet')));
  assert.match(sheet, /label: 'Edit'/);
  assert.match(sheet, /label: 'Delete'/);
});

test('a long press does not open the sheet twice', () => {
  assert.match(src, /_lpFired = true;/);
  assert.match(src, /if \(_lpFired\) \{ _lpFired = false; return; \}/);
});
