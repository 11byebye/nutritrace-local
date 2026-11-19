/**
 * meal-rollup.js - per-serving numbers for the Meals and Recipes tables
 * (sysadmin 2026-11-19).
 *
 * A meal row stores what one serving is worth: MealEditor divides the
 * ingredient totals by the recipe's yields before it saves, and for a plain
 * meal (yields = 1) the stored total is the meal itself. So the table reads
 * `nutrition` rather than re-summing ingredients, which would show a recipe's
 * whole batch as if it were one serving.
 *
 * Money is the batch cost of the priced ingredients. Each saved ingredient
 * keeps the price snapshot of the food it came from (`price` and
 * `package_weight_g`), so the same `costOf` that powers the food table works
 * here. An ingredient without a price is skipped, never counted as free, and
 * the row is marked partial: a floor is honest, a fake total is not.
 */
import { costOf, sumCost } from './price.js';

const TO_G = { g: 1, ml: 1, oz: 28.349523125, lb: 453.59237, cup: 240, tbsp: 15, tsp: 5, piece: 100, serving: 100 };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Grams in one serving of the meal: the stored per-serving portion for a
 *  recipe, the summed ingredient weight for a plain meal. */
export function servingGrams(meal) {
  const unit = String(meal?.unit || 'g').toLowerCase();
  const portion = num(meal?.portion);
  if (meal?.is_recipe && portion > 0) return portion * (TO_G[unit] ?? 1);
  const items = Array.isArray(meal?.items) ? meal.items : [];
  const total = items.reduce((s, it) => {
    const qty = num(it?.quantity) || 1;
    const p = num(it?.portion) || 0;
    return s + p * qty * (TO_G[String(it?.unit || 'g').toLowerCase()] ?? 1);
  }, 0);
  return total > 0 ? total : null;
}

/** Per-serving macros, batch cost and protein per krona for one meal row. */
export function mealRollup(meal) {
  const items = Array.isArray(meal?.items) ? meal.items : [];
  const servings = Math.max(1, parseInt(meal?.servings, 10) || 1);

  let nutrition = meal?.nutrition && typeof meal.nutrition === 'object' ? meal.nutrition : {};
  let hasStored = Object.values(nutrition).some((v) => num(v) > 0);

  if (!hasStored) {
    const totals = {};
    for (const it of items) {
      const qty = num(it?.quantity) || 1;
      const n = it?.nutrition && typeof it.nutrition === 'object' ? it.nutrition : {};
      for (const [k, v] of Object.entries(n)) {
        if (k === '_derived') continue;
        const value = num(v);
        if (value == null) continue;
        totals[k] = (totals[k] || 0) + value * qty;
      }
    }
    nutrition = Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, v / servings]),
    );
    hasStored = Object.keys(nutrition).length > 0;
  }

  const costs = items.map((it) => {
    const qty = num(it?.quantity) || 1;
    const portion = (num(it?.portion) || 0) * qty;
    return { cost: costOf(it, portion, it.unit) };
  });
  const totalCost = sumCost(costs);
  const pricedItems = costs.filter((c) => c.cost != null).length;
  const partial = totalCost != null && pricedItems < items.length;
  const costPerServing = totalCost != null ? totalCost / servings : null;
  const proteins = num(nutrition.proteins);

  return {
    servings,
    items: items.length,
    hasNutrition: hasStored,
    calories: num(nutrition.calories),
    proteins,
    carbohydrates: num(nutrition.carbohydrates),
    fat: num(nutrition.fat),
    servingGrams: servingGrams(meal),
    totalCost,
    costPerServing,
    partial,
    pricedItems,
    proteinPerSek:
      costPerServing != null && costPerServing > 0 && proteins > 0
        ? proteins / costPerServing
        : null,
  };
}
