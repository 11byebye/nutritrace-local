/**
 * server/lib/ica.js
 *
 * ICA's own storefront catalogue: name search, one product by id, and the
 * nutrition table printed on the label.
 *
 *   search   `webproductpagews/v6/product-pages/search` — name, brand, pack
 *            and shelf price. No EAN anywhere in the payload, so a row can
 *            never be joined to a barcode.
 *   product  `webproductpagews/v5/products/bop?retailerProductId=` — the
 *            nutrition table arrives as HTML in `bopData.fields[
 *            nutritionalData]`, one row per nutrient, header "100 Gram", so
 *            the numbers are already on the 100 g basis and need no scaling.
 *
 * The account id comes from a postcode (`handla.ica.se/api/store/v1`), which
 * resolves to the nearest online stores; the local shops are often not in
 * that network, so a price is a reference store's and the caller says so.
 *
 * It is WAF-gated: a handful of tokenless calls work, then every protected
 * path answers 202 with `x-amzn-waf-action: challenge`. A valid
 * `aws-waf-token` cookie (NT_ICA_COOKIE, minted by `nt-ingest ln`) lifts the
 * cap. The token is bound to the user agent below, so the two stay in step.
 *
 * Everything pure is exported for tests; the fetching lives here too because
 * two callers need it (the price leg and the search route).
 */
import { sanitizeNutrition } from './matsiktet.js';

export const ICA_STORE_API = 'https://handla.ica.se';
export const ICA_WEB_API = 'https://handlaprivatkund.ica.se';
export const ICA_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0';

const FETCH_TIMEOUT_MS = 8000;
const STORE_CACHE_MS = 24 * 60 * 60 * 1000;

// Loaded on first network call so the parsers and matchers stay importable
// from a test that has no server dependencies installed.
let _guardPromise = null;
const guard = () => (_guardPromise ||= import('./ssrf-guard.js').then(m => m.fetchChecked));

/** The WAF answered with its challenge instead of data: a token is required. */
export class IcaChallengeError extends Error {
  constructor(message = 'ICA WAF challenge — refresh the aws-waf-token cookie') {
    super(message);
    this.name = 'IcaChallengeError';
  }
}

export function foldText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

/** "370", "7,5 g", "0.5" -> number; anything without digits -> null. */
export function parseAmount(raw) {
  const m = String(raw ?? '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "700g", "0,7kg" -> grams; a volume pack ("1 l") is not a mass. */
export function packGrams(raw) {
  const s = foldText(raw).replace(',', '.');
  const kg = s.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg) return Math.round(Number(kg[1]) * 1000);
  const g = s.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (g) return Number(g[1]);
  return null;
}

/** "1 l", "500 ml", "33 cl" -> millilitres; null when it is a mass. */
export function packVolumeMl(raw) {
  const m = foldText(raw).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(ml|cl|dl|l)\b/);
  if (!m) return null;
  const unit = { ml: 1, cl: 10, dl: 100, l: 1000 }[m[2]];
  return Math.round(Number(m[1]) * unit * 10) / 10;
}

/**
 * "Kycklinginnerfilé 700g ICA Basic" -> a name without the trailing size and
 * brand, and the pack mass on its own. Peeled in a loop because either can
 * come last. A leading brand stays in the name: "Sprite Zero Sugar" is the
 * product, and cutting it leaves a meaningless "Zero Sugar".
 */
export function cleanName(rawName, brand = null) {
  const original = String(rawName || '').trim();
  let text = original;
  let grams = null;
  for (let i = 0; i < 3; i++) {
    const before = text;
    const size = text.match(/[\s,/-]*(\d+(?:[.,]\d+)?)\s*(kg|hg|g)\s*$/i);
    if (size) {
      const value = Number(size[1].replace(',', '.'));
      const unit = size[2].toLowerCase();
      if (grams == null) grams = Math.round(value * { g: 1, hg: 100, kg: 1000 }[unit]);
      text = text.slice(0, size.index).trim();
    }
    if (brand) {
      const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const trailing = new RegExp(`[\\s,/-]*${escaped}\\s*$`, 'i');
      const stripped = text.replace(trailing, '').trim();
      if (stripped.length >= 4) text = stripped;
    }
    if (text === before) break;
  }
  return { name: text || original, brand: brand || null, package_g: grams };
}

const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const TAG_RE = /<[^>]+>/g;

/**
 * ICA's nutrition HTML -> app nutrient ids.
 *
 * The header is "100 Gram", so values land on the 100 basis unchanged. The
 * Swedish labels nest ("– Varav mättat fett"), so a specific needle is tried
 * before its parent; `energi` carries both kJ and kcal in one cell and is
 * split on the unit word.
 */
export function parseNutritionTable(html) {
  const nutrition = {};
  for (const row of String(html || '').match(ROW_RE) || []) {
    const cells = [];
    for (const cell of row.match(CELL_RE) || []) {
      cells.push(cell.replace(TAG_RE, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (cells.length < 2) continue;
    const label = foldText(cells[0]).replace(/:$/, '');
    const value = parseAmount(cells[1]);
    if (value == null) continue;
    if (label.startsWith('energi')) {
      const unit = foldText(cells[1]);
      if (unit.includes('kcal')) nutrition.calories = value;
      else if (unit.includes('kj')) nutrition.kilojoules = value;
      continue;
    }
    for (const [needle, target] of [
      ['varav mattat', 'saturated-fat'],
      ['varav socker', 'sugars'],
      ['mattat fett', 'saturated-fat'],
      ['sockerarter', 'sugars'],
      ['fett', 'fat'],
      ['kolhydrat', 'carbohydrates'],
      ['fiber', 'fiber'],
      ['protein', 'proteins'],
      ['salt', 'salt'],
      ['natrium', 'sodium'],
    ]) {
      if (label.includes(needle) && nutrition[target] == null) {
        nutrition[target] = value;
        break;
      }
    }
  }
  return nutrition;
}

/**
 * The store list from `api/store/v1`: larger formats first, because a Kvantum
 * carries the own-brands a Nära does not and the token is metered.
 */
export function parseStores(data) {
  const rank = { kvantum: 0, supermarket: 1, maxi: 2, nara: 3 };
  return [...(data?.forPickupDelivery || []), ...(data?.forHomeDelivery || [])]
    .filter(s => s?.accountId)
    .map((s, i) => ({
      account: String(s.accountId),
      name: s.name || 'ICA',
      _rank: rank[String(s.storeFormat || '').toLowerCase()] ?? 4,
      _i: i,
    }))
    .sort((a, b) => a._rank - b._rank || a._i - b._i)
    .map(({ account, name }) => ({ account, name }));
}

/** Search payload -> [{ code, name, brand, pack, package_g, amount, shelf }]. */
export function parseSearch(data) {
  const out = [];
  for (const group of data?.productGroups || []) {
    let products = group?.decoratedProducts || [];
    if (!Array.isArray(products)) products = products.products || [];
    for (const p of products) {
      if (!p?.name) continue;
      const path = p.categoryPath || [];
      out.push({
        code: p.retailerProductId != null ? String(p.retailerProductId) : null,
        name: p.name,
        brand: p.brand || null,
        pack: p.packSizeDescription || null,
        package_g: packGrams(p.packSizeDescription),
        amount: Number(p.price?.amount),
        shelf: path.length ? path[path.length - 1] : null,
      });
    }
  }
  return out;
}

/**
 * One product payload -> a food row on the 100 g/ml basis. A page without
 * energy is not a hit (the table did not parse), so the caller says so.
 */
export function rowFromIca(payload, { code = null, query = null, shelf = null } = {}) {
  const product = payload?.product || {};
  const fields = {};
  for (const f of payload?.bopData?.fields || []) {
    if (f?.title != null) fields[f.title] = f.content;
  }
  const nutrition = sanitizeNutrition(parseNutritionTable(fields.nutritionalData));
  if (!nutrition.calories) return { found: false };
  const pack = product.packSizeDescription || '';
  const cleaned = cleanName(product.name || query || '', product.brand || null);
  return {
    found: true,
    source: 'ica',
    name: cleaned.name || product.name || query || '',
    brand: cleaned.brand,
    barcode: null,
    nutrition,
    portion: 100,
    unit: 'g',
    package_g: cleaned.package_g ?? packGrams(pack),
    volume_ml: packVolumeMl(pack),
    price: parseAmount(product.price?.amount),
    category: shelf || null,
    notes: `ica · ${code}` + (shelf ? ` · ${shelf}` : ''),
  };
}

async function fetchJson(url, { cookie = null } = {}) {
  const headers = { 'User-Agent': ICA_UA, Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetchChecked = await guard();
    const res = await fetchChecked(url, { headers, signal: ctrl.signal }, { maxRedirects: 2 });
    if (res.status === 202 || res.status === 403 || res.headers.get('x-amzn-waf-action')) {
      throw new IcaChallengeError();
    }
    if (!res.ok) throw new Error(`ica answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let _stores = null;
let _storesAt = 0;

export async function icaStores() {
  if (_stores && Date.now() - _storesAt < STORE_CACHE_MS) return _stores;
  const zip = String(process.env.NT_ICA_ZIP || '51440').replace(/\D/g, '') || '51440';
  const data = await fetchJson(`${ICA_STORE_API}/api/store/v1?zip=${encodeURIComponent(zip)}`);
  _stores = parseStores(data).slice(0, 3);
  _storesAt = Date.now();
  return _stores;
}

function icaCookie() {
  const cookie = String(process.env.NT_ICA_COOKIE || '').trim();
  if (!cookie) throw new IcaChallengeError('no ICA WAF token (NT_ICA_COOKIE)');
  return cookie;
}

/** One free-text search at the nearest online store. */
export async function icaSearchRows(query, account = null) {
  const cookie = icaCookie();
  const store = account || (await icaStores())[0]?.account;
  if (!store) throw new Error('no ICA online store for that postcode');
  const params = new URLSearchParams({
    q: String(query || '').trim(),
    tag: 'web',
    maxPageSize: '10',
    maxProductsToDecorate: '10',
    includeAdditionalPageInfo: 'true',
  });
  const data = await fetchJson(
    `${ICA_WEB_API}/stores/${encodeURIComponent(store)}/api/webproductpagews/v6/product-pages/search?${params}`,
    { cookie },
  );
  return parseSearch(data);
}

/** One product detail, with the nutrition table. */
export async function icaProductPayload(code, account = null) {
  const cookie = icaCookie();
  const store = account || (await icaStores())[0]?.account;
  if (!store) throw new Error('no ICA online store for that postcode');
  return fetchJson(
    `${ICA_WEB_API}/stores/${encodeURIComponent(store)}`
      + `/api/webproductpagews/v5/products/bop?retailerProductId=${encodeURIComponent(code)}`,
    { cookie },
  );
}

/** Detail -> food row, with the search row's shelf as the category. */
export async function icaProduct(code, { query = null, shelf = null } = {}) {
  const payload = await icaProductPayload(code);
  return rowFromIca(payload, { code, query, shelf });
}

/**
 * The shelf price of one product id, in SEK; null when the shop lists none.
 * Separate from the product row on purpose: the row is good for a month, a
 * price is good for hours, and the caller caches the two on their own clocks.
 */
export async function icaShelfPrice(code) {
  const payload = await icaProductPayload(code);
  return parseAmount(payload?.product?.price?.amount) ?? null;
}
