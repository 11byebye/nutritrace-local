/**
 * Matsiktet parsers: the product page, the search page and OCR text.
 *
 * Fixtures mirror the live markup (read 2026-11-18): the nutrition table is
 * `table.nutrition-table` with one `<td>label</td><td>value</td>` per row,
 * the brand is `a.product-brand-link`, the name is the `<h1>`, the net weight
 * lives in `<strong>Nettoinnehåll</strong><div>…</div>`, and the search cards
 * are `article.product-card`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGtin, parseAmount, parseEnergy, parseNutritionTable,
  parseProduct, parseSearch, firstSearchGtin, parsePackageWeight,
  parseVolumeNote, parseLabelText, productUrl, searchUrl,
} from '../server/lib/matsiktet.js';

const PRODUCT_HTML = `<!doctype html><html><body>
<nav><a href="varumarke_produkter.php?varumarke=248">ICA Basic</a></nav>
<div class="product-title-box">
  <div class="product-title-brand"><a class="product-brand-link" href="varumarke_produkter.php?varumarke=248">ICA Basic</a></div>
  <h1>Kycklinginnerfilé</h1>
</div>
<section class="info-section content-section">
  <div class="info-section-field"><strong>Nettoinnehåll</strong><div>700 g</div></div>
</section>
<section class="nutrition-section">
  <table class="nutrition-table">
    <thead><tr><th>Näringsämne</th><th>Värde per 100 g</th></tr></thead>
    <tbody>
      <tr><td>Energi</td><td>390 kJ / 90 kcal</td></tr>
      <tr><td>Fett</td><td>1 g</td></tr>
      <tr><td>– Varav mättat fett</td><td>0,5 g</td></tr>
      <tr><td>Kolhydrat</td><td>0 g</td></tr>
      <tr><td>– Varav sockerarter</td><td>0 g</td></tr>
      <tr><td>Protein</td><td>20 g</td></tr>
      <tr><td>Salt</td><td>0,6 g</td></tr>
    </tbody>
  </table>
</section>
</body></html>`;

const SEARCH_HTML = `<html><body>
<div class="product-card-grid">
  <article class="product-card">
    <a class="product-card-image-link" href="produkt.php?gtin=07318690093213"><img src="x.jpg"></a>
    <div class="product-card-body">
      <a class="product-card-title" href="varumarke_produkter.php?varumarke=248">ICA Basic</a>
      <a class="product-card-name" href="produkt.php?gtin=07318690093213">Kycklinginnerfilé</a>
    </div>
  </article>
  <article class="product-card">
    <a class="product-card-image-link" href="produkt.php?gtin=07318690176121"><img src="y.jpg"></a>
    <div class="product-card-body">
      <a class="product-card-title" href="varumarke_produkter.php?varumarke=248">ICA Basic</a>
      <a class="product-card-name" href="produkt.php?gtin=07318690176121">Kycklinginnerfilé 2-pack</a>
    </div>
  </article>
</div></body></html>`;

const STUB_HTML = `<html><body><h1>Matsiktet</h1><p>Se annan produktinformation</p></body></html>`;

test('normalizeGtin pads to the 14-digit form the site uses', () => {
  assert.equal(normalizeGtin('7318690093213'), '07318690093213');
  assert.equal(normalizeGtin('07318690093213'), '07318690093213');
  assert.equal(normalizeGtin('7 318 690 093 213'), '07318690093213');
  assert.equal(normalizeGtin('abc'), null);
  assert.equal(normalizeGtin('123'), null);
  assert.equal(normalizeGtin('123456789012345'), null);
});

test('energy keeps both units and never invents a kcal from nothing', () => {
  assert.deepEqual(parseEnergy('390 kJ / 90 kcal'), { kilojoules: 390, calories: 90 });
  assert.deepEqual(parseEnergy('146 kcal'), { calories: 146 });
  assert.deepEqual(parseEnergy('610 kJ'), { kilojoules: 610, calories: 145.8 });
  assert.deepEqual(parseEnergy('–'), {});
});

test('amounts take the Swedish decimal comma', () => {
  assert.equal(parseAmount('0,5 g'), 0.5);
  assert.equal(parseAmount('22 g'), 22);
  assert.equal(parseAmount('< 0,1 g'), 0.1);
  assert.equal(parseAmount('–'), null);
});

test('the nutrition table maps every printed row to an app nutrient', () => {
  const n = parseNutritionTable(PRODUCT_HTML);
  assert.deepEqual(n, {
    kilojoules: 390,
    calories: 90,
    fat: 1,
    'saturated-fat': 0.5,
    carbohydrates: 0,
    sugars: 0,
    proteins: 20,
    salt: 0.6,
  });
});

test('a sub-row never swallows its parent', () => {
  const n = parseNutritionTable(`<table class="nutrition-table"><tbody>
    <tr><td>– Varav mättat fett</td><td>0,5 g</td></tr>
    <tr><td>Fett</td><td>1 g</td></tr>
    <tr><td>– Varav sockerarter</td><td>2 g</td></tr>
    <tr><td>Kolhydrat</td><td>9 g</td></tr>
  </tbody></table>`);
  assert.equal(n['saturated-fat'], 0.5);
  assert.equal(n.fat, 1);
  assert.equal(n.sugars, 2);
  assert.equal(n.carbohydrates, 9);
});

test('a product page yields name, brand, pack size and nutrition', () => {
  const p = parseProduct(PRODUCT_HTML, { gtin: '07318690093213' });
  assert.equal(p.found, true);
  assert.equal(p.name, 'Kycklinginnerfilé');
  assert.equal(p.brand, 'ICA Basic');
  assert.equal(p.package_g, 700);
  assert.equal(p.nutrition.calories, 90);
});

test('a page without a table is a miss, so the caller can fall through', () => {
  assert.equal(parseProduct(STUB_HTML, { gtin: '07318690093213' }).found, false);
  assert.equal(parseProduct(PRODUCT_HTML).found, true);
});

test('search cards decode to gtin + brand + name', () => {
  const rows = parseSearch(SEARCH_HTML);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    gtin: '07318690093213', name: 'Kycklinginnerfilé', brand: 'ICA Basic',
  });
  assert.equal(firstSearchGtin(SEARCH_HTML), '07318690093213');
  assert.equal(firstSearchGtin(STUB_HTML), null);
});

test('weights: grams, kilos, and a volume that stays a note', () => {
  assert.equal(parsePackageWeight('600 g'), 600);
  assert.equal(parsePackageWeight('1,5 kg'), 1500);
  assert.equal(parsePackageWeight('500 ml'), null);
  assert.equal(parseVolumeNote('500 ml'), '500 ml pack');
  assert.equal(parseVolumeNote('330 cl'), '330 cl pack');
  assert.equal(parseVolumeNote('600 g'), null);
});

test('OCR text: value on the same line, and the two-column layout', () => {
  const same = parseLabelText(`ICA Basic Kycklinginnerfilé
Näringsvärde per 100 g
Energi 390 kJ / 90 kcal
Fett 1 g
varav mättat fett 0,5 g
Kolhydrat 0 g
varav sockerarter 0 g
Protein 20 g
Salt 0,6 g`);
  assert.equal(same.nutrition.calories, 90);
  assert.equal(same.nutrition.proteins, 20);
  assert.equal(same.nutrition['saturated-fat'], 0.5);
  assert.equal(same.name, 'ICA Basic Kycklinginnerfilé');

  const stacked = parseLabelText(`Havregryn
Energi
370 kcal
Fett
7 g
Protein
13 g`);
  assert.equal(stacked.nutrition.calories, 370);
  assert.equal(stacked.nutrition.fat, 7);
  assert.equal(stacked.nutrition.proteins, 13);
});

test('URLs stay on the fixed host', () => {
  assert.equal(productUrl('07318690093213'), 'https://matsiktet.se/produkt.php?gtin=07318690093213');
  assert.match(searchUrl('grädde 40%'), /^https:\/\/matsiktet\.se\/produkter\.php\?sok=gr%C3%A4dde%2040%25$/);
});
