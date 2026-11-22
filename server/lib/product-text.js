/**
 * server/lib/product-text.js
 *
 * The small text rules every shop catalogue needs: fold Swedish letters,
 * read a number out of a printed string, split a pack size, and peel a size
 * and a brand off a store title. Pure, so the parsers can be tested without
 * network or a database.
 */

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

