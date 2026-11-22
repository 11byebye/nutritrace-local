/**
 * server/routes/lookup.js
 *
 * Swedish product lookup for the phone's barcode scanner and label camera.
 *
 *   GET  /api/lookup/gtin/:code   one GTIN -> a food row (Matsiktet)
 *   GET  /api/lookup/search?q=    name -> [{ gtin, name, brand }]
 *   GET  /api/lookup/ica/search?q= name -> ICA rows (no macros, no EAN)
 *   GET  /api/lookup/ica/:code    one ICA product id -> a food row
 *   POST /api/lookup/label        one label photo -> a food row (tesseract OCR)
 *
 * Why Matsiktet first: it carries the Swedish own-brands OFF is thin on
 * (ICA Basic, Garant, Felix) with the printed label, and it is keyed by GTIN.
 * The client falls back to OFF only when this answers found:false.
 *
 * Egress is one fixed HTTPS host through fetchChecked (the shared SSRF guard),
 * one request per lookup with a 30-day cache, so a scan burst cannot hammer
 * the site.
 */
import { Router } from 'express';
import multer from 'multer';

import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { makeRateLimiter } from '../middleware/rate-limit.js';
import { fetchChecked } from '../lib/ssrf-guard.js';
import {
  MATSIKTET_UA, normalizeGtin, productUrl, searchUrl,
  parseProduct, parseSearch, firstSearchGtin, parseLabelText,
} from '../lib/matsiktet.js';
import { priceFor } from '../lib/store-price.js';
import {
  icaSearchRows, icaProductPayload, rowFromIca, icaShelfPrice, IcaChallengeError,
} from '../lib/ica.js';
import { readLabel } from '../lib/label-ocr.js';

const router = Router();
router.use(requireAuth);
router.use(makeRateLimiter({ max: 30, windowMs: 60_000, label: 'lookup' }));

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Prices move; the product itself does not. A separate, short cache keeps a
// shelf change visible the same day without a second catalogue request.
const PRICE_TTL_MS = 6 * 60 * 60 * 1000;
const PRICE_CACHE_MAX = 1000;
const _priceCache = new Map();

/** Cached price for one product shape; six hours, keyed by barcode + name. */
async function cachedPrice(product) {
  const key = `${product?.barcode || ''}|${String(product?.name || '').toLowerCase()}`;
  const hit = _priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.value;
  const price = await priceFor(product).catch(() => null);
  if (_priceCache.size >= PRICE_CACHE_MAX) {
    const oldest = _priceCache.keys().next().value;
    if (oldest !== undefined) _priceCache.delete(oldest);
  }
  _priceCache.set(key, { at: Date.now(), value: price });
  return price;
}

async function withPrice(result) {
  if (!result?.found) return result;
  const price = await cachedPrice({
    barcode: result.gtin,
    name: result.name,
    brand: result.brand,
    package_g: result.package_g,
  });
  return { ...result, price };
}
const CACHE_MAX = 2000;
const _cache = new Map();

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, { at: Date.now(), value });
}

const MAX_HTML = 2 * 1024 * 1024;
// ICA search answers a query, not a product: a short cache keeps a typo
// retype cheap without hiding a shelf change for a day.
const ICA_SEARCH_TTL_MS = 30 * 60 * 1000;
const ICA_SEARCH_MAX = 500;
const _icaSearchCache = new Map();
// A product row is good for a month; its price is not. Prices move on their
// own six-hour clock, and a failed refresh keeps the last known value rather
// than blanking the field.
const ICA_PRICE_TTL_MS = 6 * 60 * 60 * 1000;
const ICA_PRICE_MAX = 1000;
const _icaPriceCache = new Map();

function icaPriceCached(code) {
  const hit = _icaPriceCache.get(code);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ICA_PRICE_TTL_MS) {
    _icaPriceCache.delete(code);
    return undefined;
  }
  return hit.value;
}

function icaPriceSet(code, value) {
  if (_icaPriceCache.size >= ICA_PRICE_MAX) {
    const oldest = _icaPriceCache.keys().next().value;
    if (oldest !== undefined) _icaPriceCache.delete(oldest);
  }
  _icaPriceCache.set(code, { at: Date.now(), value });
}

function icaSearchCached(key) {
  const hit = _icaSearchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ICA_SEARCH_TTL_MS) {
    _icaSearchCache.delete(key);
    return null;
  }
  return hit.value;
}

function icaSearchSet(key, value) {
  if (_icaSearchCache.size >= ICA_SEARCH_MAX) {
    const oldest = _icaSearchCache.keys().next().value;
    if (oldest !== undefined) _icaSearchCache.delete(oldest);
  }
  _icaSearchCache.set(key, { at: Date.now(), value });
}

async function fetchHtml(url) {
  const res = await fetchChecked(url, {
    headers: { 'User-Agent': MATSIKTET_UA, 'Accept-Language': 'sv-SE,sv;q=0.9' },
  }, { maxRedirects: 2 });
  if (!res.ok) throw new Error(`matsiktet answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_HTML) throw new Error('matsiktet page too large');
  return buf.toString('utf8');
}

/** One GTIN -> food row. `found:false` is a normal miss, not an error. */
export async function lookupGtin(rawCode) {
  const gtin = normalizeGtin(rawCode);
  if (!gtin) return { found: false, reason: 'invalid barcode' };
  const cached = cacheGet(`g:${gtin}`);
  if (cached) return cached;
  let page = await fetchHtml(productUrl(gtin));
  let product = parseProduct(page, { gtin });
  if (!product.found) {
    // The direct page is an empty stub for some codes; the search page still
    // resolves them to the canonical GTIN.
    const found = firstSearchGtin(await fetchHtml(searchUrl(gtin)));
    if (found && found !== gtin) {
      page = await fetchHtml(productUrl(found));
      product = parseProduct(page, { gtin: found });
    }
  }
  const result = product.found ? { ...product, source: 'matsiktet' } : { found: false, gtin };
  cacheSet(`g:${gtin}`, result);
  return result;
}

async function lookupSearch(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const cached = cacheGet(`s:${q.toLowerCase()}`);
  if (cached) return cached;
  const rows = parseSearch(await fetchHtml(searchUrl(q))).slice(0, 20);
  cacheSet(`s:${q.toLowerCase()}`, rows);
  return rows;
}

router.get('/gtin/:code', async (req, res) => {
  try {
    res.json(await withPrice(await lookupGtin(req.params.code)));
  } catch (err) {
    logger.warn({ err: err?.message }, 'matsiktet gtin lookup failed');
    res.status(502).json({ found: false, error: 'lookup unavailable' });
  }
});

router.get('/search', async (req, res) => {
  try {
    res.json({ items: await lookupSearch(req.query.q) });
  } catch (err) {
    logger.warn({ err: err?.message }, 'matsiktet search failed');
    res.status(502).json({ items: [], error: 'lookup unavailable' });
  }
});

/**
 * Price only, for a product whose macros came from another source (an OFF hit
 * has no price and usually no pack size). `name` and `brand` are what the
 * shop search needs; `pack` is grams when known.
 */
router.get('/price', async (req, res) => {
  const code = String(req.query.code || '').trim();
  const name = String(req.query.name || '').trim();
  if (!code && !name) return res.status(400).json({ price: null, error: 'code or name required' });
  try {
    const pack = Number(req.query.pack);
    const price = await cachedPrice({
      barcode: code || null,
      name,
      brand: String(req.query.brand || '').trim() || null,
      package_g: Number.isFinite(pack) && pack > 0 ? pack : null,
    });
    res.json({ price });
  } catch (err) {
    logger.warn({ err: err?.message }, 'price lookup failed');
    res.json({ price: null });
  }
});

/**
 * ICA's own catalogue by name. A hit carries name, brand, pack and shelf
 * price only — ICA publishes no EAN and the macros live on the product page —
 * so the client says "Tap to load the numbers" and asks /ica/:id on tap.
 *
 * A spent WAF token answers `reason: 'token'` with an empty list rather than
 * an error: the search itself worked, the shop just would not talk.
 */
router.get('/ica/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ items: [] });
  const key = q.toLowerCase();
  const cached = icaSearchCached(key);
  if (cached) return res.json({ items: cached });
  try {
    const items = (await icaSearchRows(q))
      .filter(r => r.code && r.name)
      .slice(0, 20)
      .map(({ code, name, brand, pack, package_g, amount, shelf }) => ({
        code, name, brand, pack, package_g, price: amount, shelf,
      }));
    icaSearchSet(key, items);
    res.json({ items });
  } catch (err) {
    if (err instanceof IcaChallengeError) {
      logger.info('ica search skipped: WAF token missing or spent');
      return res.json({ items: [], reason: 'token' });
    }
    logger.warn({ err: err?.message }, 'ica search failed');
    res.status(502).json({ items: [], error: 'ica unavailable' });
  }
});

/** One ICA product id -> a food row on the 100 g basis. */
router.get('/ica/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!/^\d{1,20}$/.test(code)) return res.status(400).json({ found: false, error: 'invalid id' });
  const cached = cacheGet(`ica:p:${code}`);
  if (cached) {
    // The row is a month old at worst; the price rides its own clock. A
    // refresh that cannot reach the shop keeps the last known price.
    let price = icaPriceCached(code);
    if (price === undefined) {
      try {
        price = await icaShelfPrice(code);
        icaPriceSet(code, price);
      } catch (err) {
        price = cached.price ?? null;
        logger.info({ err: err?.message, code }, 'ica price refresh failed; serving last known');
      }
    }
    return res.json({ ...cached, price });
  }
  try {
    const payload = await icaProductPayload(code);
    const row = rowFromIca(payload, { code });
    if (!row.found) return res.status(422).json({ found: false, reason: 'no nutrition table' });
    icaPriceSet(code, row.price ?? null);
    cacheSet(`ica:p:${code}`, row);
    res.json(row);
  } catch (err) {
    if (err instanceof IcaChallengeError) {
      return res.status(503).json({ found: false, reason: 'token', error: 'ICA token missing or spent' });
    }
    logger.warn({ err: err?.message }, 'ica product lookup failed');
    res.status(502).json({ found: false, error: 'ica unavailable' });
  }
});

const labelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(Object.assign(new Error('Images only'), { status: 415 }));
  },
});

router.post('/label', labelUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'photo required' });
  try {
    const r = await readLabel(req.file.buffer);
    if (!r.found) {
      return res.status(422).json({
        found: false,
        reason: 'no nutrition rows read',
        preprocessed: r.preprocessed,
        text: String(r.text || '').slice(0, 1200),
      });
    }
    res.json({
      found: true,
      source: 'label',
      name: r.name || 'Label scan',
      nutrition: r.nutrition,
      preprocessed: r.preprocessed,
    });
  } catch (err) {
    logger.warn({ err: err?.message }, 'label OCR failed');
    res.status(err?.status || 500).json({ found: false, error: err?.message || 'OCR failed' });
  }
});

export default router;
