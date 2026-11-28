/**
 * The per-meal footer prints grams by default (user 2026-11-28: they did
 * not like the percentages); a setting switches it back to percent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the setting is a synced user pref defaulting to grams', () => {
  const s = read('../src/stores/settings.js');
  const prefs = s.slice(s.indexOf('export const USER_PREFS'));
  assert.match(prefs.slice(0, prefs.indexOf(']);')), /'diaryMacroValues'/);
  assert.match(s, /diaryMacroValues\s*= createSettingStore\('diaryMacroValues',\s*'grams'\)/);
});

test('the footer and the day bar branch on it and have whole grams ready', () => {
  const d = read('../src/routes/Diary.svelte');
  assert.match(d, /\$diaryMacroValues === 'percent'/);
  assert.match(d, /\{mt\.pg\}g P/);
  assert.match(d, /pg: Math\.round\(t\.proteins \|\| 0\)/);
  assert.match(d, /cg: Math\.round\(t\.carbohydrates \|\| 0\)/);
  assert.match(d, /fg: Math\.round\(t\.fat \|\| 0\)/);
  // The day summary bottom bar follows the same setting (user 2026-11-28).
  const idx = d.indexOf('class="dbb-summary-text"');
  const line = d.slice(idx, d.indexOf('\n', idx));
  assert.match(line, /\$diaryMacroValues === 'percent'/);
  assert.match(line, /Math\.round\(totals\.proteins \|\| 0\)}g P/);
  assert.match(line, /Math\.round\(totals\.carbohydrates \|\| 0\)}g C/);
  assert.match(line, /Math\.round\(totals\.fat \|\| 0\)}g F/);
});

test('Settings → Diary offers the choice and the strings exist', () => {
  const ui = read('../src/routes/settings/Diary.svelte');
  assert.match(ui, /diaryMacroValues\.set\(e\.currentTarget\.value\)/);
  assert.match(ui, /<option value="grams">/);
  assert.match(ui, /<option value="percent">/);
  const en = JSON.parse(read('../src/i18n/en.json'));
  const k = en.settings_diary;
  assert.match(k.macro_values, /Macro Values/);
  assert.match(k.macro_values_desc, /day summary bar/);
  assert.equal(k.opt_grams, 'Grams');
  assert.equal(k.opt_percent, 'Percent');
});
