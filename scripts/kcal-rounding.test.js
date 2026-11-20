/**
 * Energy display rules (user 2026-11-20):
 *   - never decimals on kcal values;
 *   - Statistics kcal-per-day values, and every meal or day total in the
 *     Diary, land on the nearest 10 kcal (single foods keep their integer);
 *   - the Foods tab floors protein/carbs/fat to whole grams, and its
 *     SEK/100 g and protein-per-SEK columns carry one decimal.
 *
 * The formatting helpers live inside Svelte components, so the second block
 * is a wiring guard: it fails if a refactor drops the rule from the source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Nutrition } from '../src/lib/nutrition.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('roundKcal10 lands on the nearest 10 and never yields a decimal', () => {
  assert.equal(Nutrition.roundKcal10(2137.4), 2140);
  assert.equal(Nutrition.roundKcal10(2134.9), 2130);
  assert.equal(Nutrition.roundKcal10(2135), 2140);
  assert.equal(Nutrition.roundKcal10(9), 10);
  assert.equal(Nutrition.roundKcal10(4), 0);
  assert.equal(Nutrition.roundKcal10(0), 0);
  assert.equal(Nutrition.roundKcal10('1250'), 1250);
  assert.equal(Nutrition.roundKcal10(null), 0);
});

test('Statistics rounds kcal values and shows the goal beside Max', () => {
  const src = read('src/routes/Statistics.svelte');
  assert.match(src, /function statRound\(/, 'statRound helper missing');
  assert.match(src, /val = statRound\(metric, raw\)/, 'per-day value not rounded');
  assert.match(src, /avg:\s+statRound\(metric/, 'summary average not rounded');
  assert.match(src, /max:\s+statRound\(metric/, 'summary max not rounded');
  assert.match(src, /statistics_page\.summary\.goal/, 'no goal cell in the summary');
  assert.ok(
    src.indexOf("statistics_page.summary.goal") > src.indexOf('summary.max.toLocaleString()') ||
    src.indexOf("'statistics_page.summary.goal'") > src.indexOf('summary.max.toLocaleString()'),
    'goal cell must follow the MAX cell'
  );
});

test('Diary rounds meal and day totals, not single foods', () => {
  const src = read('src/routes/Diary.svelte');
  assert.match(src, /_calTween\.set\(Nutrition\.roundKcal10\(totals\.calories/, 'day total not rounded');
  assert.match(src, /const _mealKcal = Nutrition\.roundKcal10\(/, 'meal header total not rounded');
  assert.match(src, /cal: Nutrition\.roundKcal10\(cal\)/, 'meal footer total not rounded');
  assert.match(src, /displayEnergy\(Nutrition\.roundKcal10\(totals\.calories\)/, 'nutrition summary day total not rounded');
  // The single-food row formatter stays an integer of its own.
  assert.match(src, /return Math\.round\(calc\.calories \|\| 0\)/, 'single food kcal changed');
});

test('Week strip day totals step by 10', () => {
  const src = read('src/components/diary/WeekStrip.svelte');
  assert.match(src, /kcal: Nutrition\.roundKcal10\(totals\.calories/, 'week strip total not rounded');
});

test('Foods table floors macros and keeps one decimal on money columns', () => {
  const foods = read('src/components/foods/FoodListTable.svelte');
  assert.match(foods, /Math\.floor\(n\)/, 'macro grams not floored');
  assert.match(foods, /macroGrams\(per100\(food, 'proteins'\)\)/);
  assert.match(foods, /macroGrams\(per100\(food, 'carbohydrates'\)\)/);
  assert.match(foods, /macroGrams\(per100\(food, 'fat'\)\)/);
  assert.match(foods, /money1\(price100\(food\)\)/, 'SEK/100 g not one decimal');
  assert.match(foods, /toFixed\(1\)\.replace\('\.', ','\)/, 'one-decimal formatter missing');
  // SEK per gram of protein, the inverse of the old P/SEK cell (2026-11-20).
  assert.match(foods, /return price \/ protein/, 'SEK/P must divide price by protein');
  assert.match(foods, /kronorPerGramProtein\(food\)/);

  const meals = read('src/components/foods/MealListTable.svelte');
  assert.match(meals, /macroGrams\(r\.proteins\)/);
  assert.match(meals, /macroGrams\(r\.carbohydrates\)/);
  assert.match(meals, /macroGrams\(r\.fat\)/);
  assert.match(meals, /sekPerProtein\(r\)/);
  assert.match(meals, /cost \/ protein/, 'meal SEK/P must divide cost by protein');
});
