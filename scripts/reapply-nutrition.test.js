/**
 * A food edit reaches rows already logged from it (user 2026-11-28).
 * The server reproduces the client's log-time scaling exactly, so these
 * expectations are the client's own math: same portion+unit, density when
 * the unit systems cross, per-food alt_units first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foodScaleShape, linkedFoodId, scaleForItem, reapplyItem, nutritionEqual,
} from '../server/lib/reapply-nutrition.js';

const food = (o) => foodScaleShape({ portion: 100, unit: 'g', nutrition: '{}', ...o });

test('same unit: the logged portion ratio', () => {
  const f = food({ nutrition: JSON.stringify({ calories: 260, proteins: 26, fat: 13 }) });
  const n = scaleForItem(f, { portion: 75, unit: 'g', nutrition: {} });
  assert.equal(n.calories, 195);
  assert.equal(n.proteins, 19.5);
  assert.equal(n.fat, 9.75);
});

test('ml food logged in grams uses the density', () => {
  const f = food({
    unit: 'ml', nutrition_basis: 'ml', density_g_ml: 0.92,
    nutrition: JSON.stringify({ calories: 900, fat: 100 }),
  });
  const n = scaleForItem(f, { portion: 20, unit: 'g', nutrition: {} });
  assert.ok(Math.abs(n.calories - 195.652) < 0.01, `got ${n.calories}`);
  assert.ok(Math.abs(n.fat - 21.739) < 0.01, `got ${n.fat}`);
});

test('per-food alt_units win over the table', () => {
  const f = food({
    alt_units: [{ abbr: 'slice', grams: 30 }],
    nutrition: JSON.stringify({ calories: 260 }),
  });
  const n = scaleForItem(f, { portion: 1, unit: 'slice', nutrition: {} });
  assert.equal(n.calories, 78);
});

test('an opaque unit falls back to the plain ratio, as the client does', () => {
  const f = food({ nutrition: JSON.stringify({ calories: 100 }) });
  const n = scaleForItem(f, { portion: 2, unit: 'piece', nutrition: {} });
  assert.equal(n.calories, 2);
});

test('nothing to do: no food nutrition, no link, or a recipe', () => {
  assert.equal(scaleForItem(food({ nutrition: '{}' }), { portion: 50, unit: 'g' }), null);
  assert.equal(linkedFoodId({ food_server_id: null, id: 603 }), null);
  assert.equal(linkedFoodId({ is_recipe: true, food_server_id: 5 }), null);
  assert.equal(linkedFoodId({ id: 603 }), 603);
  assert.equal(linkedFoodId({ food_server_id: 610, id: 1 }), 610);
});

test('_derived is never copied into the numbers', () => {
  const f = food({ nutrition: JSON.stringify({ calories: 100, _derived: { sodium: true } }) });
  const n = scaleForItem(f, { portion: 100, unit: 'g', nutrition: {} });
  assert.deepEqual(Object.keys(n), ['calories']);
});

test('an unchanged item is returned as the same object', () => {
  const f = food({ nutrition: JSON.stringify({ calories: 260 }) });
  const item = { portion: 100, unit: 'g', nutrition: { calories: 260 } };
  assert.equal(reapplyItem(item, f), item);
  assert.equal(nutritionEqual({ calories: 260 }, { calories: 260.0000001 }), true);
  assert.equal(nutritionEqual({ calories: 260 }, { calories: 261 }), false);
  assert.equal(nutritionEqual({ calories: 260 }, { calories: 260, fat: 1 }), false);
});
