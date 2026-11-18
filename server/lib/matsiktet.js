/**
 * server/lib/matsiktet.js
 *
 * Matsiktet (matsiktet.se) is a Swedish product catalogue: 721k products,
 * one server-rendered page per GTIN, nutrition printed as the label shows it
 * (Energi kJ/kcal, fett, varav mättat, kolhydrat, varav sockerarter, fiber,
 * protein, salt). It carries the own-brands OFF is thin on (ICA Basic, Garant,
 * Felix), so a scan prefers it and falls back to OFF.
 *
 * Everything here is pure: HTML or OCR text in, app-shaped data out. The
 * fetching and caching live in routes/lookup.js so the parsers can be tested
 * from fixtures without network.
 */

const BASE = 'https://matsiktet.se';
export const MATSIKTET_BASE = BASE;
export const MATSIKTET_UA = 'NutriTrace/1.0 (self-hosted; Swedish product label lookup)';

/** EAN-8/12/13 and GTIN-14 all resolve on Matsiktet once left-padded to 14. */
export function normalizeGtin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits.padStart(14, '0');
}

export function productUrl(gtin14) {
  return `${BASE}/produkt.php?gtin=${encodeURIComponent(gtin14)}`;
}

export function searchUrl(query) {
  return `${BASE}/produkter.php?sok=${encodeURIComponent(String(query || '').trim())}`;
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aring: 'å', auml: 'ä', ouml: 'ö', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö',
};

function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

function textOf(fragment) {
  return decodeEntities(String(fragment || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "4,3 g", "0.5g", "22" -> number; "–" / "" -> null. */
export function parseAmount(raw) {
  const s = String(raw || '').replace(/\u00a0/g, ' ').trim();
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "610 kJ / 150 kcal" -> { kilojoules: 610, calories: 150 } */
export function parseEnergy(raw) {
  const s = String(raw || '').replace(/\u00a0/g, ' ');
  const out = {};
  const kcal = s.match(/([\d.,]+)\s*kcal/i);
  const kj = s.match(/([\d.,]+)\s*kJ/i);
  if (kcal) out.calories = parseAmount(kcal[1]);
  if (kj) out.kilojoules = parseAmount(kj[1]);
  if (out.calories == null && out.kilojoules != null) {
    out.calories = Math.round((out.kilojoules / 4.184) * 10) / 10;
  }
  return out;
}

/**
 * One label row -> one or two app nutrients. The sub-rows are matched first
 * ("– Varav mättat fett" contains "fett"), and every pattern is anchored so a
 * category name cannot swallow a neighbour.
 */
const ROW_PATTERNS = [
  [/^energi\b/i, 'energy'],
  [/^(?:–|-|\.\.)?\s*varav\s+mättat\s+fett/i, 'saturated-fat'],
  [/^(?:–|-|\.\.)?\s*varav\s+sockerarter/i, 'sugars'],
  [/^fett\b/i, 'fat'],
  [/^kolhydrat/i, 'carbohydrates'],
  [/^fiber/i, 'fiber'],
  [/^protein/i, 'proteins'],
  [/^salt\b/i, 'salt'],
];

export function nutrientFromRow(label, value) {
  const name = String(label || '').replace(/\s+/g, ' ').trim();
  for (const [re, key] of ROW_PATTERNS) {
    if (!re.test(name)) continue;
    if (key === 'energy') {
      const e = parseEnergy(value);
      return Object.keys(e).length ? e : null;
    }
    const n = parseAmount(value);
    return n == null ? null : { [key]: n };
  }
  return null;
}

/** The product page's nutrition table. Energi lands as kJ + kcal. */
export function parseNutritionTable(html) {
  const src = String(html || '');
  const table = src.match(/<table[^>]*class="[^"]*nutrition-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  const body = table ? table[1] : src;
  const nutrition = {};
  const rows = body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => textOf(m[1]));
    if (cells.length < 2) continue;
    const parsed = nutrientFromRow(cells[0], cells[1]);
    if (!parsed) continue;
    for (const [k, v] of Object.entries(parsed)) {
      if (nutrition[k] == null && v != null) nutrition[k] = v;
    }
  }
  return nutrition;
}

function firstMatch(src, re) {
  const m = src.match(re);
  return m ? textOf(m[1]) : null;
}

/** "600 g" -> 600 (g only; a volume stays null and is reported as a note). */
export function parsePackageWeight(raw) {
  const s = textOf(raw);
  const kg = s.match(/([\d.,]+)\s*kg\b/i);
  if (kg) return Math.round(parseAmount(kg[1]) * 1000);
  const g = s.match(/([\d.,]+)\s*g\b/i);
  if (g) return parseAmount(g[1]);
  return null;
}

export function parseVolumeNote(raw) {
  const s = textOf(raw);
  const l = s.match(/([\d.,]+)\s*(l|liter|cl|ml)\b/i);
  if (!l) return null;
  if (/^\s*(?:[\d.,]+)\s*(?:g|kg)\b/i.test(s)) return null;
  return `${s} pack`;
}

/**
 * One product page -> { found, name, brand, package_g, volume_note, nutrition }.
 * A page without a nutrition table is not a hit: the caller falls through.
 */
export function parseProduct(html, { gtin = null } = {}) {
  const src = String(html || '');
  const nutrition = parseNutritionTable(src);
  const name = firstMatch(src, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!name || Object.keys(nutrition).length === 0) {
    return { found: false, gtin };
  }
  const brand = firstMatch(src, /<a[^>]*class="[^"]*product-brand-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  const weightBlock = src.match(/<strong>\s*Nettoinneh[^<]*<\/strong>\s*<div>([\s\S]*?)<\/div>/i)
    || src.match(/<strong>\s*Nettovikt[^<]*<\/strong>\s*<div>([\s\S]*?)<\/div>/i);
  const weightText = weightBlock ? textOf(weightBlock[1]) : null;
  const package_g = weightText ? parsePackageWeight(weightText) : null;
  const volume_note = weightText ? parseVolumeNote(weightText) : null;
  return {
    found: true,
    gtin,
    name,
    brand: brand || null,
    package_g: package_g ?? null,
    volume_note: package_g == null ? volume_note : null,
    nutrition,
  };
}

/** The search page's cards: [{ gtin, name, brand }]. */
export function parseSearch(html) {
  const src = String(html || '');
  const out = [];
  const seen = new Set();
  const cards = src.match(/<article[^>]*class="[^"]*product-card[^"]*"[\s\S]*?<\/article>/gi) || [];
  for (const card of cards) {
    const gtin = normalizeGtin((card.match(/produkt\.php\?gtin=(\d+)/i) || [])[1]);
    if (!gtin || seen.has(gtin)) continue;
    const name = firstMatch(card, /<a[^>]*class="[^"]*product-card-name[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const brand = firstMatch(card, /<a[^>]*class="[^"]*product-card-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!name) continue;
    seen.add(gtin);
    out.push({ gtin, name, brand: brand || null });
  }
  return out;
}

/** First GTIN on a search page, for when the direct page is an empty stub. */
export function firstSearchGtin(html) {
  const hit = normalizeGtin((String(html || '').match(/produkt\.php\?gtin=(\d+)/i) || [])[1]);
  return hit || null;
}

/**
 * OCR text from a photographed label -> nutrition. Lines look like
 * "Energi 610 kJ / 150 kcal", "Fett 4,3 g", "varav mättat fett 0,5 g".
 * A label split across columns ("Fett\n4,3 g") is paired here too.
 */
export function parseLabelText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const nutrition = {};
  let pending = null;
  for (const line of lines) {
    if (pending) {
      const parsed = nutrientFromRow(pending, line);
      if (parsed) {
        for (const [k, v] of Object.entries(parsed)) if (nutrition[k] == null) nutrition[k] = v;
        pending = null;
        continue;
      }
    }
    const m = line.match(/^([A-Za-zÅÄÖåäö–\-.\s]{3,40}?)\s*[:.]?\s*((?:\d[\d.,\s]*\s*(?:kcal|kJ|g|mg)\b.*))$/i);
    if (m) {
      const parsed = nutrientFromRow(m[1], m[2]);
      if (parsed) {
        for (const [k, v] of Object.entries(parsed)) if (nutrition[k] == null) nutrition[k] = v;
        continue;
      }
    }
    if (ROW_PATTERNS.some(([re]) => re.test(line))) pending = line;
  }
  const nameLine = lines.find(l => /^[A-Za-zÅÄÖåäö]/.test(l) && !ROW_PATTERNS.some(([re]) => re.test(l)) && l.length <= 60);
  return { nutrition, name: nameLine || null };
}
