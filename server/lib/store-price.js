/**
 * server/lib/store-price.js
 *
 * A scanned product's price at the shops, beside its macros.
 *
 *   Willys  (Axfood online): exact. The search index has no EAN, so one name
 *           search, then compare the product detail's `ean` to the scanned
 *           GTIN. A wrong product cannot slip in because the join is the
 *           barcode itself.
 *   ICA     (handlaprivatkund): approximate, and labelled so. ICA's payload
 *           has no EAN at all, so the join is brand + size + name similarity,
 *           and the price is the chosen online store's, which may not be the
 *           local shop. The store name rides in the answer.
 *
 * Prices are per package (`amount`, SEK), with the shop's own comparison
 * price when it has one (kr/kg or kr/l). A miss is a normal answer: the food
 * row still carries its macros.
 */
// Loaded on first network call so the parsers and matchers stay importable
// from a test that has no server dependencies installed.
let _guardPromise = null;
const guard = () => (_guardPromise ||= import('./ssrf-guard.js').then(m => m.fetchChecked));

const WILLYS = 'https://www.willys.se';
const ICA_STORE_API = 'https://handla.ica.se';
const ICA_WEB_API = 'https://handlaprivatkund.ica.se';
// The WAF token is bound to this UA: it is minted by `nt-ingest ica-token`
// with the same string, so keep the two in step.
const ICA_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0';
const WILLYS_UA = 'Mozilla/5.0 (X11; Linux x86_64) NutriTrace/1.0';

const SEARCH_CANDIDATES = 6;
const FETCH_TIMEOUT_MS = 8000;

async function fetchJson(url, { ua = WILLYS_UA, cookie = null } = {}) {
  const headers = { 'User-Agent': ua, Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetchChecked = await guard();
    const res = await fetchChecked(url, { headers, signal: ctrl.signal }, { maxRedirects: 2 });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const foldText = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

/** Both "7340083475962" and "07340083475962" resolve to one comparable key. */
export function eanKey(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 8) return null;
  return d.replace(/^0+/, '');
}

export function sameEan(a, b) {
  const ka = eanKey(a);
  const kb = eanKey(b);
  return !!ka && ka === kb;
}

/** "700g", "0,7kg", "1,5 l" -> grams; null when the unit is a volume. */
export function packGrams(raw) {
  const s = foldText(raw).replace(',', '.');
  const kg = s.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg) return Math.round(Number(kg[1]) * 1000);
  const g = s.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (g) return Number(g[1]);
  return null;
}

/** Words that carry no identity, dropped before comparing product names. */
const STOP = new Set(['ica', 'basic', 'garant', 'farsk', 'fryst', 'farsk', 'fardig', 'med', 'och', 'utan', 'extra', 'stor', 'liten']);

function words(s) {
  return foldText(s)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

/**
 * Whether a shop row is the same product: at least half the meaningful words
 * of the shorter name appear in the longer one, and the packs agree within
 * 10% when both are known. Deliberately loose enough for "Kycklinginnerfilé
 * 700g ICA Basic" vs "Kycklinginnerfile", strict enough to keep a different
 * cut or brand out.
 */
export function looksSame({ name, brand, package_g }, candidate) {
  const a = words(`${name || ''}`);
  const b = words(`${candidate?.name || ''}`);
  if (!a.length || !b.length) return false;
  const [shortList, longList] = a.length <= b.length ? [a, b] : [b, a];
  // A one-word name has to lead the other: "Salt" must not match "Lax kokt
  // m. salt", while "Lax" still matches "Laxfile".
  if (shortList.length === 1) {
    const w = shortList[0];
    if (w.length < 4) return false;
    const lead = longList[0];
    if (!(lead === w || lead.startsWith(w) || w.startsWith(lead))) return false;
  }
  const hit = shortList.filter(w => longList.some(x => x.startsWith(w) || w.startsWith(x))).length;
  if (hit / shortList.length < 0.5) return false;
  if (brand && candidate?.brand) {
    const bd = words(brand);
    const cd = words(candidate.brand);
    if (bd.length && cd.length && !bd.some(w => cd.some(x => x.startsWith(w) || w.startsWith(x)))) return false;
  }
  if (package_g && candidate?.package_g) {
    const ratio = Number(package_g) / Number(candidate.package_g);
    if (ratio < 0.9 || ratio > 1.1) return false;
  }
  return true;
}

async function willysPrice({ barcode, name, brand, package_g }) {
  const queries = [brand ? `${brand} ${name}` : '', name].filter(Boolean).slice(0, 2);
  const seen = new Set();
  for (const q of queries) {
    const data = await fetchJson(`${WILLYS}/search?q=${encodeURIComponent(q)}`);
    const hits = (data?.results || []).filter(h => h.code && !seen.has(h.code)).slice(0, SEARCH_CANDIDATES);
    for (const hit of hits) {
      seen.add(hit.code);
      const product = await fetchJson(`${WILLYS}/axfood/rest/p/${encodeURIComponent(hit.code)}`);
      if (!product || !sameEan(product.ean, barcode)) continue;
      const amount = Number(product.priceValue);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return {
        amount,
        currency: 'SEK',
        store: 'Willys (online)',
        exact: true,
        compare: product.comparePrice || null,
        compare_unit: product.comparePriceUnit || null,
        pack: product.displayVolume || null,
      };
    }
  }
  return null;
}

// ── ICA ──────────────────────────────────────────────────────────────────

let _icaStores = null;

/** The nearest online stores, in the order the API answers them. */
async function icaStores() {
  if (_icaStores) return _icaStores;
  const zip = String(process.env.NT_ICA_ZIP || '51440').replace(/\D/g, '') || '51440';
  const data = await fetchJson(`${ICA_STORE_API}/api/store/v1?zip=${encodeURIComponent(zip)}`, { ua: ICA_UA });
  // Larger formats first: a Kvantum carries the own-brands a Nära does not,
  // and the token is metered, so the first store should usually be the hit.
  const rank = { kvantum: 0, supermarket: 1, maxi: 2, nara: 3 };
  const rows = [...(data?.forPickupDelivery || []), ...(data?.forHomeDelivery || [])]
    .filter(s => s?.accountId)
    .map((s, i) => ({
      account: String(s.accountId),
      name: s.name || 'ICA',
      _rank: rank[String(s.storeFormat || '').toLowerCase()] ?? 4,
      _i: i,
    }))
    .sort((a, b) => a._rank - b._rank || a._i - b._i);
  _icaStores = rows.slice(0, 3).map(({ account, name }) => ({ account, name }));
  return _icaStores;
}

async function icaRows(account, query, cookie) {
  const params = new URLSearchParams({
    q: query, tag: 'web', maxPageSize: '10', maxProductsToDecorate: '10',
  });
  const data = await fetchJson(
    `${ICA_WEB_API}/stores/${account}/api/webproductpagews/v6/product-pages/search?${params}`,
    { ua: ICA_UA, cookie },
  );
  if (!data) return null;
  const out = [];
  for (const group of data.productGroups || []) {
    let products = group.decoratedProducts || [];
    if (!Array.isArray(products)) products = products.products || [];
    for (const p of products) {
      if (!p?.name) continue;
      out.push({
        name: p.name,
        brand: p.brand || null,
        package_g: packGrams(p.packSizeDescription),
        amount: Number(p.price?.amount),
        pack: p.packSizeDescription || null,
      });
    }
  }
  return out;
}

/**
 * Name match only: ICA has no EAN, so the guard in looksSame is the whole
 * safety story, and the answer is marked approximate with its store.
 *
 * One query per store, nearest first, because the token is metered: a small
 * ICA Nära carries less than a Kvantum, so stop at the first store that has
 * a matching row rather than asking every store for every scan.
 */
async function icaPrice({ name, brand, package_g }) {
  const cookie = String(process.env.NT_ICA_COOKIE || '').trim();
  if (!cookie) return null;
  const query = String(name || '').trim().slice(0, 80);
  if (!query) return null;
  const stores = await icaStores();
  for (const store of stores) {
    const rows = await icaRows(store.account, query, cookie);
    if (!rows?.length) continue;
    const hit = rows.find(r => Number.isFinite(r.amount) && r.amount > 0
      && looksSame({ name, brand, package_g }, r));
    if (!hit) continue;
    return {
      amount: hit.amount,
      currency: 'SEK',
      store: store.name,
      exact: false,
      compare: null,
      compare_unit: null,
      pack: hit.pack,
    };
  }
  return null;
}

/** Both shops, best first: an exact Willys EAN beats an ICA name match. */
export async function priceFor(product) {
  if (!product?.barcode) return null;
  const willys = await willysPrice(product).catch(() => null);
  if (willys) return willys;
  return await icaPrice(product).catch(() => null);
}
