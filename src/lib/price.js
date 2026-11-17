/**
 * price.js — shelf-price math for the local fork (sysadmin 2026-11-15).
 *
 * A food stores what the package cost (`price`, SEK) and how heavy the
 * package was (`package_weight_g`), so a receipt line such as "21.90 /
 * 500 g" is typed in as it reads. Everything else is derived: per 100 g,
 * cost of a logged portion, and protein per krona.
 *
 * Unit caveat kept honest: the price is per gram, so the food's portion
 * unit must be a mass unit. A food measured in ml or "each" returns null
 * rather than a number that looks authoritative and is wrong.
 */
const MASS_TO_G = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237, mg: 0.001 };

/** Grams per one unit, or null when the unit is not a mass unit. */
export function gramsPerUnit(unit) {
  const u = String(unit || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MASS_TO_G, u) ? MASS_TO_G[u] : null;
}

/**
 * Tolerant money/number parse. A receipt line is typed the way it reads:
 * "21,90", "21.90 kr", "21,90 SEK", "1 234,56". Everything that is not a
 * digit, separator or sign is dropped, then a comma is treated as the
 * decimal mark. Returns NaN when nothing numeric is left.
 *
 * This exists because a silent Number() on "21,90" yields NaN, and a NaN
 * price saved as null is data loss with no error shown (2026-11-16).
 */
export function parseMoney(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let t = String(v).trim().toLowerCase();
  if (!t) return NaN;
  t = t.replace(/(kr|sek)/g, '');
  t = t.replace(/[^0-9,.-]/g, '');
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Positive finite number or null. Zero price is "unknown", not "free". */
function pos(v) {
  const n = parseMoney(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Price per 100 g of the food, or null when it cannot be known. */
export function pricePer100g(food) {
  const price = pos(food?.price);
  const pkg = pos(food?.package_weight_g);
  if (price == null || pkg == null) return null;
  return price / pkg * 100;
}

/** Cost of `amount` of `unit` of this food, or null. */
export function costOf(food, amount, unit = food?.unit) {
  const price = pos(food?.price);
  const pkg = pos(food?.package_weight_g);
  const factor = gramsPerUnit(unit);
  const grams = Number(amount);
  if (price == null || pkg == null || factor == null) return null;
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return price / pkg * grams * factor;
}

/** Grams of protein per SEK spent, or null. */
export function proteinPerSek(food, grams, proteinGrams) {
  const cost = costOf(food, grams);
  const p = Number(proteinGrams);
  if (cost == null || !Number.isFinite(p) || p <= 0) return null;
  return p / cost;
}

/** Sum a list of {cost} entries, ignoring nulls. Null when nothing priced. */
export function sumCost(entries) {
  let total = null;
  for (const e of entries || []) {
    const c = e?.cost;
    if (typeof c === 'number' && Number.isFinite(c)) total = (total || 0) + c;
  }
  return total;
}
