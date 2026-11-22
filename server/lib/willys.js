/**
 * server/lib/willys.js
 *
 * Willys' storefront (Axfood) as a product catalogue, for the Foods tab.
 *
 *   search   `/search?q=` -> results[] with code, name, manufacturer,
 *            priceValue, displayVolume. No EAN here.
 *   product  `/axfood/rest/p/<code>` -> the per-100 block in
 *            `nutrientHeaders` (basis 100 g, Swedish nutrient codes), plus
 *            the EAN, the shelf price and the pack.
 *
 * Two hops, but the second one is a complete food row: macros on the 100 g
 * basis, brand, pack, price and a barcode that can be joined exactly. Willys
 * also carries the Swedish own-brands OFF is thin on (Garant and friends).
 *
 * `store-price.js` still owns the price leg's exact-EAN join; this file owns
 * the catalogue calls and the parsers, and the two share their text rules
 * with ICA through product-text.js.
 */
import { sanitizeNutrition } from './matsiktet.js';
import { parseAmount, packGrams, packVolumeMl, cleanName } from './product-text.js';

export const WILLYS_BASE = 'https://www.willys.se';
export const WILLYS_UA = 'Mozilla/5.0 (X11; Linux x86_64) NutriTrace/1.0';

const FETCH_TIMEOUT_MS = 8000;

let _guardPromise = null;
const guard = () => (_guardPromise ||= import('./ssrf-guard.js').then(m => m.fetchChecked));

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetchChecked = await guard();
    const res = await fetchChecked(url, {
      headers: { 'User-Agent': WILLYS_UA, Accept: 'application/json' },
      signal: ctrl.signal,
    }, { maxRedirects: 2 });
    if (!res.ok) throw new Error(`willys answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Search payload -> [{ code, name, brand, pack, package_g, amount, shelf }]. */
export function parseSearch(data) {
  const out = [];
  for (const hit of data?.results || []) {
    if (!hit?.code || !hit?.name) continue;
    const pack = hit.displayVolume || hit.productLine2 || null;
    out.push({
      code: String(hit.code),
      name: hit.name,
      brand: hit.manufacturer || null,
      pack,
      package_g: packGrams(pack),
      amount: parseAmount(hit.priceValue ?? hit.priceNoUnit),
      shelf: null,
    });
  }
  return out;
}

const NUTRIENT_SV = {
  'energi': 'energy',
  'fett': 'fat',
  'varav mättat fett': 'saturated-fat',
  'kolhydrat': 'carbohydrates',
  'varav sockerarter': 'sugars',
  'fiber': 'fiber',
  'protein': 'proteins',
  'salt': 'salt',
  'natrium': 'sodium',
};

/**
 * The storefront's per-100 block -> app nutrient ids. Energy appears twice
 * under the same Swedish label, so the unit decides where it lands; values
 * arrive as strings with dot decimals.
 */
export function parseNutritionHeaders(headers) {
  const block = (headers || []).find(h => String(h?.nutrientBasisQuantity) === '100');
  if (!block) return {};
  const nutrition = {};
  for (const detail of block.nutrientDetails || []) {
    const label = String(detail?.nutrientTypeCode || '').trim().toLowerCase();
    const unit = String(detail?.measurementUnitCode || '').trim().toLowerCase();
    const value = parseAmount(detail?.quantityContained);
    if (value == null) continue;
    const target = NUTRIENT_SV[label];
    if (target === 'energy') {
      if (unit === 'kilokalori') nutrition.calories = value;
      else if (unit === 'kilojoule' || unit === 'kj') nutrition.kilojoules = value;
      continue;
    }
    if (target && nutrition[target] == null) nutrition[target] = value;
  }
  return sanitizeNutrition(nutrition);
}

/**
 * The store's own shelf name. The crumb trail ends on the product itself
 * ("Alla varor / Fryst / Kött & fågel / Fågel / Innerfilé …"), so the shelf
 * is the last crumb that is not the product and not the root.
 */
export function shelfOf(product, name = null) {
  const crumbs = product?.breadcrumbs || product?.breadCrumbs || [];
  const named = crumbs
    .filter(c => c && c.name && c.name !== 'Alla varor')
    .map(c => c.name);
  const productName = String(name ?? product?.name ?? '').trim();
  const last = named[named.length - 1];
  if (!last) return null;
  return productName && last === productName ? (named[named.length - 2] || null) : last;
}

/** One product payload -> a food row on the 100 g basis. */
export function rowFromWillys(product, { code = null } = {}) {
  const nutrition = parseNutritionHeaders(product?.nutrientHeaders);
  if (!nutrition.calories) return { found: false };
  const pack = product.displayVolume || product.productLine2 || '';
  const cleaned = cleanName(product.name || '', product.manufacturer || null);
  const price = parseAmount(product.priceValue);
  return {
    found: true,
    source: 'willys',
    name: cleaned.name || product.name || '',
    brand: cleaned.brand,
    barcode: String(product.ean || '').trim() || null,
    nutrition,
    portion: 100,
    unit: 'g',
    package_g: cleaned.package_g ?? packGrams(pack),
    volume_ml: packVolumeMl(pack),
    price: price != null && price > 0 ? price : null,
    category: shelfOf(product),
    notes: `willys · ${code}` + (shelfOf(product) ? ` · ${shelfOf(product)}` : ''),
  };
}

/** One free-text search. */
export async function willysSearchRows(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  return parseSearch(await fetchJson(`${WILLYS_BASE}/search?q=${encodeURIComponent(q)}`));
}

/** One product detail, nutrition included. */
export async function willysProduct(code) {
  return fetchJson(`${WILLYS_BASE}/axfood/rest/p/${encodeURIComponent(code)}`);
}

/**
 * The shelf price of one product, in SEK. The product row is cached for a
 * month upstream; a price is not, so the caller keeps its own short clock.
 */
export async function willysShelfPrice(code) {
  const product = await willysProduct(code);
  const price = parseAmount(product?.priceValue);
  return price != null && price > 0 ? price : null;
}
