/**
 * se-lookup.js — the phone's Swedish product lookup, shared by every surface
 * that takes a barcode.
 *
 * The server does the fetching (`/api/lookup/*`), so this file is shape only:
 * it asks, unwraps, and hands back a food the editors can prefill. Keeping it
 * here is what stops the Foods scanner and the food editor's barcode field
 * from drifting apart — the editor used to ask Open Food Facts alone and lost
 * the pack size the scanner had already been filling in.
 */
import { NtApi } from './api.js';

/** "200g", "0,7kg", "1,5 l" -> grams; null for a volume. */
export function packGrams(raw) {
  const s = String(raw || '').toLowerCase().replace(',', '.');
  const kg = s.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg) return Math.round(Number(kg[1]) * 1000);
  const g = s.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (g) return Number(g[1]);
  return null;
}

/** The Swedish catalogue by GTIN; `{found:false}` on a miss, null on error. */
export async function lookupGtin(code) {
  if (!code) return null;
  try { return await NtApi.get('/api/lookup/gtin/' + encodeURIComponent(code)); }
  catch { return null; }
}

/** ICA's catalogue by name; a hit carries no macros until it is hydrated. */
export async function lookupIcaSearch(q) {
  if (!q) return { items: [] };
  try { return await NtApi.get('/api/lookup/ica/search?q=' + encodeURIComponent(q)); }
  catch { return { items: [] }; }
}

/** One ICA product id -> the numbers; null on a miss or a spent WAF token. */
export async function lookupIca(code) {
  if (!code) return null;
  try { return await NtApi.get('/api/lookup/ica/' + encodeURIComponent(code)); }
  catch { return null; }
}

/** A shop price for a name/barcode; null when no shop carries it. */
export async function lookupPrice({ code, name, brand, pack } = {}) {
  if (!code && !name) return null;
  try {
    const params = new URLSearchParams({ code: code || '', name: name || '', brand: brand || '' });
    if (pack) params.set('pack', String(pack));
    const r = await NtApi.get('/api/lookup/price?' + params.toString());
    return r?.price?.amount ? r.price : null;
  } catch { return null; }
}

/**
 * A lookup hit as a food row: per 100 g (what the catalogue prints), the pack
 * from the page or the shop, and the price when one exists. `notes` records
 * the source so a row can say where it came from.
 */
export function foodFromGtin(code, hit) {
  const price = hit?.price && Number.isFinite(Number(hit.price.amount)) ? hit.price : null;
  const pack = hit?.package_g ?? packGrams(price?.pack) ?? null;
  return {
    name: hit?.name || '',
    brand: hit?.brand || '',
    barcode: code,
    nutrition: hit?.nutrition || {},
    portion: 100,
    unit: 'g',
    package_weight_g: pack,
    price: price ? Number(price.amount) : null,
    notes: [
      hit?.volume_note,
      price ? `${price.exact ? 'pris' : 'pris ca'} ${price.store}` : null,
      'matsiktet.se',
    ].filter(Boolean).join(' · '),
  };
}

/** An ICA detail hit as a food row: per 100 g, pack and shelf price. */
export function foodFromIca(hit) {
  const price = Number.isFinite(Number(hit?.price)) ? Number(hit.price) : null;
  return {
    name: hit?.name || '',
    brand: hit?.brand || '',
    barcode: null,
    nutrition: hit?.nutrition || {},
    portion: 100,
    unit: hit?.unit || 'g',
    package_weight_g: hit?.package_g ?? null,
    price,
    notes: hit?.notes || null,
  };
}
