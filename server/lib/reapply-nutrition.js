/**
 * reapply-nutrition.js — pure helpers that make a logged diary item follow
 * the food it came from (user 2026-11-28: "i dont see why updating
 * retroactively shouldnt work").
 *
 * At log time the client scales the food's stored nutrition to the portion
 * the user picked, using the same `scaleFactor` (src/lib/units.js) that
 * lives in this repo. The item then kept that copy forever, so a food
 * corrected afterwards never reached a row already logged. The server now
 * recomputes it with the identical math, so the stored snapshot is only a
 * fallback for a food that has been deleted.
 *
 * No db import: `scripts/reapply-nutrition.test.js` loads this module in
 * plain Node.
 */
import { scaleFactor } from '../../src/lib/units.js';

/** Normalize a raw foods row for scaleFactor (alt_units JSON -> array). */
export function foodScaleShape(row) {
  if (!row) return null;
  let alt = row.alt_units;
  if (typeof alt === 'string' && alt) {
    try { alt = JSON.parse(alt); } catch { alt = null; }
  }
  if (!Array.isArray(alt)) alt = null;
  let nutrition = row.nutrition;
  if (typeof nutrition === 'string') {
    try { nutrition = JSON.parse(nutrition || '{}'); } catch { nutrition = {}; }
  }
  return {
    id: row.id,
    price: row.price,
    package_weight_g: row.package_weight_g,
    portion: row.portion,
    unit: row.unit,
    nutrition_basis: row.nutrition_basis,
    alt_units: alt,
    density_g_ml: row.density_g_ml,
    nutrition: nutrition && typeof nutrition === 'object' ? nutrition : {},
  };
}

/**
 * The food a diary item came from, using the same rule the client's
 * `_foodKey` follows: an item with `food_server_id: null` was logged on a
 * phone before its food reached the server and names no food here.
 * Recipe items point at a meal, not a food, and are left alone.
 */
export function linkedFoodId(item) {
  if (!item || typeof item !== 'object' || item.is_recipe) return null;
  if (item.food_server_id === null) return null;
  const id = item.food_server_id ?? item.id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

/**
 * The food's money fields copied onto the item. The item stores the
 * package price and the package weight; costOf() scales them to the
 * logged portion. Both follow the food now, like nutrition.
 */
export function foodItemFields(food) {
  return {
    price: food?.price == null || food.price === '' ? null : Number(food.price),
    package_weight_g: food?.package_weight_g == null || food.package_weight_g === '' ? null : Number(food.package_weight_g),
  };
}

function sameNumber(a, b) {
  const an = (a == null || a === '') ? null : Number(a);
  const bn = (b == null || b === '') ? null : Number(b);
  if (an === null || bn === null) return an === bn;
  return Math.abs(an - bn) <= 1e-9;
}

/**
 * Work out the item's nutrition from the food's current numbers at the
 * item's own logged portion/unit. Returns null when there is nothing to
 * recompute (no nutrition, or an all-zero result that would only wipe the
 * item).
 */
export function scaleForItem(food, item) {
  if (!food || !item) return null;
  const keys = Object.keys(food.nutrition || {}).filter(k => k !== '_derived');
  if (!keys.length) return null;
  const factor = scaleFactor(food.portion, food.unit, item.portion, item.unit, food);
  if (!Number.isFinite(factor)) return null;
  const out = {};
  for (const k of keys) {
    const v = parseFloat(food.nutrition[k]);
    if (!Number.isFinite(v)) continue;
    out[k] = v * factor;
  }
  return Object.keys(out).length ? out : null;
}

/** Same key set and every value within float noise. */
export function nutritionEqual(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a).filter(k => k !== '_derived');
  const kb = Object.keys(b).filter(k => k !== '_derived');
  if (ka.length !== kb.length) return false;
  const set = new Set(kb);
  for (const k of ka) {
    if (!set.has(k)) return false;
    const x = parseFloat(a[k]), y = parseFloat(b[k]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (String(a[k]) !== String(b[k])) return false;
      continue;
    }
    if (Math.abs(x - y) > 1e-6) return false;
  }
  return true;
}

/**
 * Return the item with nutrition and money re-derived from `food`, plus
 * what changed. Used on every diary save so a phone holding an old copy
 * cannot push either back over a correction.
 */
export function applyFood(item, food) {
  if (!item || !food) return { item, changed: false, nutritionChanged: false, priceChanged: false };
  const next = scaleForItem(food, item);
  const fields = foodItemFields(food);
  const nutritionChanged = !!next && !nutritionEqual(item.nutrition, next);
  const priceChanged = !sameNumber(item.price, fields.price)
    || !sameNumber(item.package_weight_g, fields.package_weight_g);
  if (!nutritionChanged && !priceChanged) {
    return { item, changed: false, nutritionChanged: false, priceChanged: false };
  }
  const out = { ...item };
  if (nutritionChanged) out.nutrition = next;
  out.price = fields.price;
  out.package_weight_g = fields.package_weight_g;
  return { item: out, changed: true, nutritionChanged, priceChanged };
}

/** Item with nutrition and money re-derived, or the same object. */
export function reapplyItem(item, food) {
  return applyFood(item, food).item;
}
