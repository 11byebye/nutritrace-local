/**
 * ICA catalogue parsers: the nutrition table on the product payload, the
 * search groups, the store list, and the title split.
 *
 * Fixtures mirror the live payloads (read 2026-11-18): nutrition arrives as
 * HTML in `bopData.fields[nutritionalData]`, header "100 Gram"; search rows
 * live in `productGroups[].decoratedProducts` (a list, or an object with a
 * `products` list on some responses); stores come from `api/store/v1` split
 * into pickup and home delivery.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseNutritionTable, parseSearch, parseStores,
  packGrams, packVolumeMl, cleanName, rowFromIca,
} from '../server/lib/ica.js';

const NUTRITION_HTML = `<table><tbody>
  <tr><td>Näringsvärde</td><td>100 Gram</td><td></td></tr>
  <tr><td>Energi (kcal)</td><td>370 kcal</td><td></td></tr>
  <tr><td>Energi (kJ)</td><td>1550 kJ</td><td></td></tr>
  <tr><td>Fett</td><td>7 g</td><td></td></tr>
  <tr><td>Varav mättat fett</td><td>1.1 g</td><td></td></tr>
  <tr><td>Kolhydrat</td><td>58 g</td><td></td></tr>
  <tr><td>Varav sockerarter</td><td>1 g</td><td></td></tr>
  <tr><td>Fiber</td><td>10 g</td><td></td></tr>
  <tr><td>Protein</td><td>13 g</td><td></td></tr>
  <tr><td>Salt</td><td>0 g</td><td></td></tr>
</tbody></table>`;

const PAYLOAD = {
  product: {
    name: 'Havregryn 750g ICA',
    brand: 'ICA',
    packSizeDescription: '0.75kg',
    price: { amount: '16.04', currency: 'SEK' },
  },
  bopData: {
    fields: [
      { title: 'nutritionalData', content: NUTRITION_HTML },
      { title: 'ingredients', content: 'Gryn av HAVRE.' },
    ],
  },
};

test('the ICA table maps to the app nutrient ids on the 100 basis', () => {
  assert.deepEqual(parseNutritionTable(NUTRITION_HTML), {
    calories: 370, kilojoules: 1550, fat: 7, 'saturated-fat': 1.1,
    carbohydrates: 58, sugars: 1, fiber: 10, proteins: 13, salt: 0,
  });
  assert.deepEqual(parseNutritionTable(''), {});
});

test('one product payload becomes a food row', () => {
  const row = rowFromIca(PAYLOAD, { code: '1393953' });
  assert.equal(row.found, true);
  assert.equal(row.name, 'Havregryn');
  assert.equal(row.brand, 'ICA');
  assert.equal(row.nutrition.calories, 370);
  assert.equal(row.package_g, 750);
  assert.equal(row.price, 16.04);
  assert.equal(row.portion, 100);
  assert.equal(row.unit, 'g');
  assert.equal(row.source, 'ica');
  assert.match(row.notes, /ica · 1393953/);
});

test('a page without energy is not a hit', () => {
  assert.deepEqual(rowFromIca({ product: {}, bopData: { fields: [] } }, { code: '1' }), { found: false });
  assert.equal(rowFromIca({ product: { name: 'X' }, bopData: { fields: [
    { title: 'nutritionalData', content: '<table><tr><td>Fett</td><td>7 g</td></tr></table>' },
  ] } }, { code: '1' }).found, false);
});

test('an impossible read is dropped by the ceiling', () => {
  const damaged = NUTRITION_HTML.replace('<td>13 g</td>', '<td>209 g</td>');
  const row = rowFromIca({ product: { name: 'X' }, bopData: { fields: [
    { title: 'nutritionalData', content: damaged },
  ] } }, { code: '1' });
  assert.equal(row.nutrition.proteins, undefined);
  assert.equal(row.nutrition.calories, 370);
});

test('search rows read both decorated-product shapes', () => {
  const row = (code, name) => ({
    retailerProductId: code, name, brand: 'ICA Basic',
    packSizeDescription: '700g', price: { amount: 49.94 },
    categoryPath: ['Färskt', 'Kyckling'],
  });
  const list = parseSearch({ productGroups: [{ decoratedProducts: [row(1, 'Kycklinginnerfilé 700g')] }] });
  const dict = parseSearch({ productGroups: [{ decoratedProducts: { products: [row(2, 'Lax 500g')] } }] });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    code: '1', name: 'Kycklinginnerfilé 700g', brand: 'ICA Basic', pack: '700g',
    package_g: 700, amount: 49.94, shelf: 'Kyckling',
  });
  assert.equal(dict[0].code, '2');
  assert.equal(parseSearch({}).length, 0);
});

test('stores are ranked with the larger formats first', () => {
  const stores = parseStores({
    forPickupDelivery: [
      { accountId: 'nara', name: 'ICA Nära A', storeFormat: 'Nara' },
      { accountId: 'kv', name: 'ICA Kvantum B', storeFormat: 'Kvantum' },
    ],
    forHomeDelivery: [{ accountId: 'sup', name: 'ICA Supermarket C', storeFormat: 'Supermarket' }],
  });
  assert.deepEqual(stores.map(s => s.account), ['kv', 'sup', 'nara']);
  assert.deepEqual(parseStores(null), []);
});

test('pack sizes, volume and the title split', () => {
  assert.equal(packGrams('0.75kg'), 750);
  assert.equal(packGrams('700 g'), 700);
  assert.equal(packGrams('1 l'), null);
  assert.equal(packVolumeMl('1,5 l'), 1500);
  assert.equal(packVolumeMl('33 cl'), 330);
  assert.equal(packVolumeMl('500g'), null);
  assert.equal(parseAmount('16,04 kr'), 16.04);
  assert.equal(parseAmount('–'), null);

  assert.deepEqual(cleanName('Havregryn 750g ICA', 'ICA'), {
    name: 'Havregryn', brand: 'ICA', package_g: 750,
  });
  assert.deepEqual(cleanName('Kycklinginnerfilé 700g', 'ICA Basic'), {
    name: 'Kycklinginnerfilé', brand: 'ICA Basic', package_g: 700,
  });
  // A leading brand is the product's own name, not a suffix to peel.
  assert.equal(cleanName('Sprite Zero Sugar', 'Coca-Cola').name, 'Sprite Zero Sugar');
});
