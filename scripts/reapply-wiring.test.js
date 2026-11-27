/**
 * The retroactive rule is only real if both writes use it: the food save
 * rewrites logged rows, and a diary save cannot push a stale copy back.
 * Also guards the Docker copy of the unit scaler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a food save rewrites the diary rows logged from it', () => {
  const src = read('../server/routes/foods.js');
  assert.match(src, /import \{ reapplyFoodToDiary \} from '\.\.\/lib\/reapply\.js'/);
  const put = src.slice(src.indexOf("router.put('/:id'"));
  const end = put.indexOf('}));');
  assert.match(put.slice(0, end), /reapplyFoodToDiary\(Number\(req\.params\.id\)\)/);
});

test('a diary save re-derives linked items from the food', () => {
  const src = read('../server/routes/diary.js');
  assert.match(src, /import \{ reapplyItems \} from '\.\.\/lib\/reapply\.js'/);
  assert.match(src, /const mergedItems = reapplyItems\(mergedRaw\)/);
});

test('the unit scaler is in the runtime image', () => {
  assert.match(read('../Dockerfile'), /COPY src\/lib\/units\.js \/src\/lib\/units\.js/);
});

test('the one-shot backfill script exists', () => {
  assert.ok(existsSync(new URL('../server/scripts/reapply-nutrition.js', import.meta.url)));
  assert.match(read('../server/scripts/reapply-nutrition.js'), /reapplyAllDiary\(\{ dryRun: true \}\)/);
});

test('the client keeps and the server hydrates the money fields', () => {
  const store = read('../src/stores/diary.js');
  const keep = store.slice(store.indexOf('const _KEEP_FIELDS'));
  assert.match(keep.slice(0, keep.indexOf('];')), /'price', 'package_weight_g'/);
  const helpers = read('../server/lib/diary-helpers.js');
  assert.match(helpers, /const HYDRATE_FIELDS = \[[^\]]*'price', 'package_weight_g'/);
  assert.match(helpers, /f\.price, f\.package_weight_g/);
});

test('the backfill reports price-only changes', () => {
  const src = read('../server/scripts/reapply-nutrition.js');
  assert.match(src, /priceChanged/);
  assert.match(src, /price \$\{c\.priceBefore/);
});
