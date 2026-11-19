import test from 'node:test';
import assert from 'node:assert/strict';

import { mealRollup, totalGrams } from '../src/lib/meal-rollup.js';

const chicken = {
  name: 'Kycklingfilé', portion: 200, unit: 'g', quantity: 1,
  price: 50, package_weight_g: 1000,
  nutrition: { calories: 160, proteins: 46, carbohydrates: 0, fat: 3 },
};

const rice = {
  name: 'Basmatiris', portion: 100, unit: 'g', quantity: 1,
  price: 20, package_weight_g: 500,
  nutrition: { calories: 350, proteins: 8, carbohydrates: 78, fat: 1 },
};

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('recipe: stored per-serving macros and cost per serving', () => {
  const meal = {
    name: 'Kyckling med ris', is_recipe: true, servings: 4,
    portion: 150, unit: 'g',
    nutrition: { calories: 300, proteins: 25, carbohydrates: 30, fat: 8 },
    items: [chicken, rice],
  };
  const r = mealRollup(meal);
  assert.equal(r.servings, 4);
  assert.equal(r.calories, 300);
  assert.equal(r.proteins, 25);
  close(r.totalCost, 14);
  close(r.costPerServing, 3.5);
  close(r.proteinPerSek, 25 / 3.5);
  assert.equal(r.partial, false);
});

test('plain meal: one serving is the whole meal', () => {
  const meal = {
    name: 'Lunch', is_recipe: false, servings: 1, portion: 100, unit: 'g',
    nutrition: { calories: 600, proteins: 50, carbohydrates: 40, fat: 20 },
    items: [chicken, rice],
  };
  const r = mealRollup(meal);
  assert.equal(r.calories, 600);
  close(r.costPerServing, 14);
  close(r.costPerServing, r.totalCost);
});

test('an unpriced ingredient makes the total a floor', () => {
  const meal = {
    name: 'Half priced', is_recipe: false, servings: 1,
    nutrition: { calories: 500, proteins: 40 },
    items: [chicken, { name: 'Okänd', portion: 100, unit: 'g', nutrition: {} }],
  };
  const r = mealRollup(meal);
  assert.equal(r.partial, true);
  close(r.totalCost, 10);
});

test('a volume ingredient has no mass price and is not guessed', () => {
  const meal = {
    name: 'Vatten', is_recipe: false, servings: 1,
    nutrition: { calories: 0, proteins: 0 },
    items: [chicken, { name: 'Vatten', portion: 300, unit: 'ml', price: 15, package_weight_g: 1500 }],
  };
  const r = mealRollup(meal);
  assert.equal(r.partial, true);
  close(r.totalCost, 10);
});

test('quantity multiplies both grams and cost', () => {
  const item = { ...chicken, portion: 100, quantity: 2 };
  const r = mealRollup({
    name: 'Dubbel', is_recipe: false, servings: 1,
    nutrition: { calories: 320, proteins: 92 }, items: [item],
  });
  close(r.totalCost, 10);
});

test('a meal without stored nutrition is derived from items, per serving', () => {
  const item = { name: 'X', portion: 100, unit: 'g', quantity: 1, nutrition: { calories: 100, proteins: 10 } };
  const r = mealRollup({ name: 'Legacy', is_recipe: true, servings: 2, portion: 50, unit: 'g', nutrition: {}, items: [item, item] });
  assert.equal(r.hasNutrition, true);
  assert.equal(r.calories, 100);
  assert.equal(r.proteins, 10);
});

test('total weight is the batch: per-serving portion times yields, or the items', () => {
  assert.equal(totalGrams({
    is_recipe: true, portion: 150, unit: 'g', servings: 4, items: [chicken, rice],
  }), 600);
  assert.equal(totalGrams({ is_recipe: false, servings: 1, items: [chicken, rice] }), 300);
  assert.equal(totalGrams({ is_recipe: true, portion: null, servings: 2, items: [chicken, rice] }), 300);
  assert.equal(totalGrams({ is_recipe: false, items: [] }), null);
});
