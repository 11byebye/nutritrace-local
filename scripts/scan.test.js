/**
 * Scan sanity: the GS1 check digit, and the wiring that makes a failed scan
 * leave a record.
 *
 * The check digit is what separates "misread" from "not in the catalogue":
 * both used to end at the same empty editor.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { gtinValid } from '../src/lib/gtin.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('valid retail codes pass their check digit', () => {
  assert.equal(gtinValid('81107773'), true, 'EAN-8');
  assert.equal(gtinValid('7340083434723'), true, 'EAN-13');
  assert.equal(gtinValid('07330797077194'), true, 'GTIN-14');
  assert.equal(gtinValid('1721011044805'), true, 'unusual but valid GTIN-13');
});

test('a single wrong digit is a misread', () => {
  assert.equal(gtinValid('7340083434724'), false);
  assert.equal(gtinValid('7318690093212'), false);
  assert.equal(gtinValid('81107774'), false);
});

test('nothing else is judged', () => {
  assert.equal(gtinValid(''), true);
  assert.equal(gtinValid('hello'), true);
  assert.equal(gtinValid('12345'), true, 'a 5-digit price code is not a GTIN');
  assert.equal(gtinValid('123456789012345'), true, 'not a retail length');
  assert.equal(gtinValid('73400834347'), true, '11 digits is not a retail length');
});

test('the scan paths guard, trace, and offer a name search', () => {
  const foods = read('src/routes/Foods.svelte');
  assert.match(foods, /if \(!gtinValid\(code\)\)/, 'Foods does not check the digit');
  assert.match(foods, /reportScanTrace\(code, hops\)/, 'a miss posts no trace');
  assert.match(foods, /scanMissOpen = true/, 'a miss never offers a way out');
  assert.match(foods, /searchSource = 'all'/, 'the name search does not fan out');
  assert.match(foods, /notes: `scan miss · \$\{scanMissCode\}`/, 'a manual save records the miss');

  const editor = read('src/routes/FoodEditor.svelte');
  assert.match(editor, /if \(!gtinValid\(code\)\)/, 'the editor scan does not check the digit');

  const route = read('server/routes/lookup.js');
  assert.match(route, /router\.post\('\/trace'/, 'no trace route');
  assert.match(route, /'scan gtin'/, 'the GTIN hop is not logged');
  assert.match(route, /'scan trace'/, 'the client trace is not logged');
});
