/**
 * server/routes/lookup.js
 *
 * Swedish product lookup for the phone's barcode scanner and label camera.
 *
 *   GET  /api/lookup/gtin/:code   one GTIN -> a food row (Matsiktet)
 *   GET  /api/lookup/search?q=    name -> [{ gtin, name, brand }]
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
import { spawn } from 'child_process';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { makeRateLimiter } from '../middleware/rate-limit.js';
import { fetchChecked } from '../lib/ssrf-guard.js';
import {
  MATSIKTET_UA, normalizeGtin, productUrl, searchUrl,
  parseProduct, parseSearch, firstSearchGtin, parseLabelText,
} from '../lib/matsiktet.js';
import { priceFor } from '../lib/store-price.js';

const router = Router();
router.use(requireAuth);
router.use(makeRateLimiter({ max: 30, windowMs: 60_000, label: 'lookup' }));

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Prices move; the product itself does not. A separate, short cache keeps a
// shelf change visible the same day without a second catalogue request.
const PRICE_TTL_MS = 6 * 60 * 60 * 1000;
const PRICE_CACHE_MAX = 1000;
const _priceCache = new Map();

async function withPrice(result) {
  if (!result?.found) return result;
  const key = result.gtin || result.barcode || result.name;
  const hit = _priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return { ...result, price: hit.value };
  const price = await priceFor({
    barcode: result.gtin,
    name: result.name,
    brand: result.brand,
    package_g: result.package_g,
  }).catch(() => null);
  if (_priceCache.size >= PRICE_CACHE_MAX) {
    const oldest = _priceCache.keys().next().value;
    if (oldest !== undefined) _priceCache.delete(oldest);
  }
  _priceCache.set(key, { at: Date.now(), value: price });
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

const labelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(Object.assign(new Error('Images only'), { status: 415 }));
  },
});

/** tesseract on stdin with the Swedish model; resolves the plain text. */
function ocr(buffer) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('tesseract', ['stdin', 'stdout', '-l', 'swe', '--psm', '6'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return reject(Object.assign(new Error('OCR is not installed on this server'), { status: 503 }));
    }
    const out = [];
    let err = '';
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => {
      const missing = e?.code === 'ENOENT';
      reject(Object.assign(new Error(missing ? 'OCR is not installed on this server' : 'OCR failed'), { status: missing ? 503 : 500 }));
    });
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      reject(Object.assign(new Error(`OCR failed (${String(err).slice(0, 120)})`), { status: 500 }));
    });
    child.stdin.end(buffer);
  });
}

router.post('/label', labelUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'photo required' });
  try {
    const text = await ocr(req.file.buffer);
    const { nutrition, name } = parseLabelText(text);
    if (Object.keys(nutrition).length === 0) {
      return res.status(422).json({ found: false, reason: 'no nutrition rows read', text: text.slice(0, 1200) });
    }
    res.json({ found: true, source: 'label', name: name || 'Label scan', nutrition });
  } catch (err) {
    logger.warn({ err: err?.message }, 'label OCR failed');
    res.status(err?.status || 500).json({ found: false, error: err?.message || 'OCR failed' });
  }
});

export default router;
