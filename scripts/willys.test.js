/**
 * Willys catalogue parsers: the search results, the per-100 nutrient block,
 * the product payload and the shelf name.
 *
 * Fixtures mirror the live payloads (read 2026-11-22): search rows carry
 * `code`, `name`, `manufacturer`, `priceValue` and `displayVolume` and no
 * EAN; the detail carries `nutrientHeaders` with a basis-100 block whose
 * `nutrientDetails` use Swedish codes, plus `ean`, `priceValue`,
 * `displayVolume` and `breadcrumbs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearch, parseNutritionHeaders, rowFromWillys, shelfOf,
} from '../server/lib/willys.js';

const DETAIL = {
  name: 'Innerfilé av Svensk Kyckling Fryst',
  manufacturer: 'Garant',
  ean: '7340083434723',
  priceValue: 58.9,
  displayVolume: '700g',
  productLine2: 'GARANT, 700g',
  breadcrumbs: [{ name: 'Fryst' }, { name: 'Kyckling' }],
  nutrientHeaders: [{
    nutrientBasisQuantity: '100',
    nutrientDetails: [
      { nutrientTypeCode: 'energi', quantityContained: '430', measurementUnitCode: 'kilojoule' },
      { nutrientTypeCode: 'energi', quantityContained: '100', measurementUnitCode: 'kilokalori' },
      { nutrientTypeCode: 'fett', quantityContained: '2', measurementUnitCode: 'gram' },
      { nutrientTypeCode: 'varav mättat fett', quantityContained: '0.7', measurementUnitCode: 'gram' },
      { nutrientTypeCode: 'kolhydrat', quantityContained: '0.5', measurementUnitCode: 'gram' },
      { nutrientTypeCode: 'varav sockerarter', quantityContained: '0.5', measurementUnitCode: 'gram' },
      { nutrientTypeCode: 'protein', quantityContained: '21', measurementUnitCode: 'gram' },
      { nutrientTypeCode: 'salt', quantityContained: '0.7', measurementUnitCode: 'gram' },
    ],
  }],
};

test('search rows read the storefront shape', () => {
  const rows = parseSearch({ results: [
    {
      code: '101222356_ST', name: 'Innerfilé av Svensk Kyckling Fryst',
      manufacturer: 'Garant', priceValue: 58.9, displayVolume: '700g',
    },
    { name: 'no code' },
    { code: '2', name: 'Lax', manufacturer: 'Garant', priceValue: 89.5, productLine2: 'GARANT, 500g' },
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    code: '101222356_ST', name: 'Innerfilé av Svensk Kyckling Fryst',
    brand: 'Garant', pack: '700g', package_g: 700, amount: 58.9, shelf: null,
  });
  assert.equal(rows[1].pack, 'GARANT, 500g');
  assert.equal(rows[1].package_g, 500);
});

test('the per-100 block maps to the app nutrient ids', () => {
  assert.deepEqual(parseNutritionHeaders(DETAIL.nutrientHeaders), {
    calories: 100, kilojoules: 430, fat: 2, 'saturated-fat': 0.7,
    carbohydrates: 0.5, sugars: 0.5, proteins: 21, salt: 0.7,
  });
  // A block for another basis is not the printed 100 g table.
  assert.deepEqual(parseNutritionHeaders([{ nutrientBasisQuantity: '50', nutrientDetails: [
    { nutrientTypeCode: 'protein', quantityContained: '10', measurementUnitCode: 'gram' },
  ] }]), {});
  assert.deepEqual(parseNutritionHeaders(null), {});
});

test('one product payload becomes a complete food row', () => {
  const row = rowFromWillys(DETAIL, { code: '101222356_ST' });
  assert.equal(row.found, true);
  assert.equal(row.name, 'Innerfilé av Svensk Kyckling Fryst');
  assert.equal(row.brand, 'Garant');
  assert.equal(row.barcode, '7340083434723');
  assert.equal(row.nutrition.calories, 100);
  assert.equal(row.nutrition.proteins, 21);
  assert.equal(row.package_g, 700);
  assert.equal(row.price, 58.9);
  assert.equal(row.portion, 100);
  assert.equal(row.unit, 'g');
  assert.equal(row.source, 'willys');
  assert.equal(row.category, 'Kyckling');
  assert.match(row.notes, /willys · 101222356_ST/);
});

test('a payload without energy is not a hit', () => {
  assert.deepEqual(rowFromWillys({ nutrientHeaders: [] }, { code: '1' }), { found: false });
  assert.equal(rowFromWillys({ ...DETAIL, nutrientHeaders: [] }, { code: '1' }).found, false);
});

test('an impossible read is dropped by the ceiling', () => {
  const damaged = JSON.parse(JSON.stringify(DETAIL));
  damaged.nutrientHeaders[0].nutrientDetails.find(d => d.nutrientTypeCode === 'protein')
    .quantityContained = '209';
  const row = rowFromWillys(damaged, { code: '1' });
  assert.equal(row.nutrition.proteins, undefined);
  assert.equal(row.nutrition.calories, 100);
});

test('the shelf name is the last real breadcrumb', () => {
  assert.equal(shelfOf(DETAIL), 'Kyckling');
  assert.equal(shelfOf({}), null);
  // The live trail ends on the product itself; the shelf is the one before.
  assert.equal(shelfOf({
    name: 'Innerfilé av Svensk Kyckling Fryst',
    breadcrumbs: [
      { name: 'Alla varor' }, { name: 'Fryst' }, { name: 'Kött & fågel' },
      { name: 'Fågel' }, { name: 'Innerfilé av Svensk Kyckling Fryst' },
    ],
  }), 'Fågel');
});
