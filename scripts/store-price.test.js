/**
 * Store price matching: the barcode join at Willys and the guard that keeps
 * an ICA name match from pricing the wrong product.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eanKey, sameEan, packGrams, looksSame } from '../server/lib/store-price.js';

test('EAN keys meet across the 13/14-digit forms', () => {
  assert.equal(eanKey('7340083475962'), '7340083475962');
  assert.equal(eanKey('07340083475962'), '7340083475962');
  assert.equal(eanKey('734-0083-475962'), '7340083475962');
  assert.equal(eanKey('abc'), null);
  assert.equal(sameEan('7340083475962', '07340083475962'), true);
  assert.equal(sameEan('7340083475962', '7318690093213'), false);
});

test('pack sizes read grams and kilos, and refuse a volume', () => {
  assert.equal(packGrams('700g'), 700);
  assert.equal(packGrams('0,7kg'), 700);
  assert.equal(packGrams('2 kg'), 2000);
  assert.equal(packGrams('1,5 l'), null);
  assert.equal(packGrams(''), null);
});

test('a Swedish own-brand row matches its shop row', () => {
  assert.equal(looksSame(
    { name: 'Kycklinginnerfilé', brand: 'ICA Basic', package_g: 700 },
    { name: 'Kycklinginnerfilé 700g ICA Basic', brand: null, package_g: 700 },
  ), true);
});

test('the guards refuse a different cut, brand or pack size', () => {
  // Wrong cut: shares "kyckling" but not "innerfile".
  assert.equal(looksSame(
    { name: 'Kycklinginnerfilé', brand: 'ICA Basic', package_g: 700 },
    { name: 'Kycklinglårfilé mörad 700 Gram Kronfågel', brand: null, package_g: 700 },
  ), false, 'a different cut is a different product');

  assert.equal(looksSame(
    { name: 'Kycklinginnerfilé', brand: 'Kronfågel', package_g: 700 },
    { name: 'Kycklinginnerfilé 700g ICA Basic', brand: null, package_g: 700 },
  ), true, 'no brand on the candidate means no brand conflict');

  assert.equal(looksSame(
    { name: 'Kycklinginnerfilé', brand: 'ICA Basic', package_g: 700 },
    { name: 'Kycklinginnerfilé 2kg ICA Basic', brand: null, package_g: 2000 },
  ), false, 'a pack more than 10% off is another product');

  assert.equal(looksSame(
    { name: 'Havregryn', brand: 'Garant', package_g: 1500 },
    { name: 'Havregryn 750g ICA', brand: null, package_g: 750 },
  ), false, 'half the pack weight is not the same product');

  assert.equal(looksSame(
    { name: 'Lax', package_g: null },
    { name: 'Laxfile', package_g: null },
  ), false, 'a three-letter name may not stretch over a compound');
  assert.equal(looksSame(
    { name: 'Havregryn', package_g: null },
    { name: 'Havregryn 1,5kg ICA', package_g: 1500 },
  ), true, 'a real single-word name leads the shop row');
  
  assert.equal(looksSame(
    { name: 'Salt', package_g: null },
    { name: 'Lax kokt m. salt', package_g: null },
  ), false, 'a short word inside a longer name is not a match');
});
