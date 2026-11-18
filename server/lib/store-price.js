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

let _icaAccount = null;
let _icaStoreName = null;

async function icaStore() {
  if (_icaAccount) return { account: _icaAccount, name: _icaStoreName };
  const zip = String(process.env.NT_ICA_ZIP || '51440').replace(/\D/g, '') || '51440';
  const data = await fetchJson(`${ICA_STORE_API}/api/store/v1?zip=${encodeURIComponent(zip)}`, { ua: ICA_UA });
  const stores = [...(data?.forPickupDelivery || []), ...(data?.forHomeDelivery || [])];
  const first = stores.find(s => s.accountId);
  if (!first) return null;
  _icaAccount = String(first.accountId);
  _icaStoreName = first.name || 'ICA';
  return { account: _icaAccount, name: _icaStoreName };
}

async function icaPrice({ name, brand, package_g }) {
  const cookie = String(process.env.NT_ICA_COOKIE || '').trim();
  if (!cookie) return null;
  const store = await icaStore();
  if (!store) return null;
  const query = [brand, name].filter(Boolean).join(' ').trim().slice(0, 80);
  if (!query) return null;
  const params = new URLSearchParams({
    q: query, tag: 'web', maxPageSize: '10', maxProductsToDecorate: '10',
  });
  const data = await fetchJson(
    `${ICA_WEB_API}/stores/${store.account}/api/webproductpagews/v6/product-pages/search?${params}`,
    { ua: ICA_UA, cookie },
  );
  if (!data) return null;
  const rows = [];
  for (const group of data.productGroups || []) {
    let products = group.decoratedProducts || [];
    if (!Array.isArray(products)) products = products.products || [];
    for (const p of products) {
      if (!p?.name) continue;
      rows.push({
        name: p.name,
        brand: p.brand || null,
        package_g: packGrams(p.packSizeDescription),
        amount: Number(p.price?.amount),
        pack: p.packSizeDescription || null,
      });
    }
  }
  const hit = rows.find(r => Number.isFinite(r.amount) && r.amount > 0 && looksSame({ name, brand, package_g }, r));
  if (!hit) return null;
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

/** Both shops, best first: an exact Willys EAN beats an ICA name match. */
export async function priceFor(product) {
  if (!product?.barcode) return null;
  const willys = await willysPrice(product).catch(() => null);
  if (willys) return willys;
  return await icaPrice(product).catch(() => null);
}
