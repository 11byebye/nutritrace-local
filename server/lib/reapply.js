/**
 * reapply.js — the database side of "a food edit reaches rows already
 * logged from it" (see reapply-nutrition.js for why).
 *
 * Two entry points:
 *   reapplyItems(items)            read/write guard for one diary save:
 *                                  the food's current numbers win over a
 *                                  client's stale snapshot.
 *   reapplyFoodToDiary(foodId)     write-through: rewrite every live diary
 *                                  date that references the food, bump the
 *                                  item's updatedAt and the row's
 *                                  updated_at so clients pull the change.
 *
 * The rows are a handful per user (JSON chooses no index), and the pull
 * keys on diary.updated_at, so a bump is what makes the phone see it.
 */
import db from '../db.js';
import { foodScaleShape, linkedFoodId, reapplyItem, scaleForItem, nutritionEqual } from './reapply-nutrition.js';

function loadFoods(ids) {
  const list = [...new Set(ids)].filter(n => Number.isFinite(n));
  if (!list.length) return new Map();
  const rows = db.prepare(
    `SELECT * FROM foods WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`
  ).all(JSON.stringify(list));
  return new Map(rows.map(r => [r.id, foodScaleShape(r)]));
}

/** Re-derive linked items against the current foods; same array when unchanged. */
export function reapplyItems(items) {
  if (!Array.isArray(items) || !items.length) return items;
  const ids = items.map(linkedFoodId).filter(n => n !== null);
  if (!ids.length) return items;
  const foods = loadFoods(ids);
  let changed = false;
  const out = items.map(item => {
    const id = linkedFoodId(item);
    const food = id === null ? null : foods.get(id);
    if (!food) return item;
    const next = reapplyItem(item, food);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}

/**
 * Rewrite every live diary row that references `foodId`.
 * `options.nowIso` is the item-level timestamp (client format);
 * `options.transaction === false` lets a caller wrap several steps itself.
 * Returns { rows, items } counts of what changed.
 */
export function reapplyFoodToDiary(foodId, options = {}) {
  const row = db.prepare('SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL').get(foodId);
  if (!row) return { rows: 0, items: 0, changes: [] };
  const food = foodScaleShape(row);
  const nowIso = options.nowIso || new Date().toISOString();
  const dates = db.prepare('SELECT id, date, items FROM diary WHERE deleted_at IS NULL').all();
  const changes = [];
  const updates = [];

  for (const entry of dates) {
    let items;
    try { items = JSON.parse(entry.items || '[]'); } catch { continue; }
    if (!Array.isArray(items) || !items.length) continue;
    let touched = false;
    const nextItems = items.map(item => {
      if (linkedFoodId(item) !== food.id) return item;
      const next = scaleForItem(food, item);
      if (!next || nutritionEqual(item.nutrition, next)) return item;
      touched = true;
      changes.push({
        date: entry.date,
        name: item.name,
        before: item.nutrition?.calories,
        after: next.calories,
      });
      return { ...item, nutrition: next, updatedAt: nowIso };
    });
    if (touched) updates.push({ id: entry.id, items: JSON.stringify(nextItems) });
  }

  if (!updates.length) return { rows: 0, items: 0, changes: [] };

  const write = () => {
    const stmt = db.prepare(`UPDATE diary SET items = ?, updated_at = datetime('now') WHERE id = ?`);
    for (const u of updates) stmt.run(u.items, u.id);
  };
  if (options.transaction === false) write(); else db.transaction(write)();

  return { rows: updates.length, items: changes.length, changes };
}

/**
 * One-shot backfill over every live diary row (the repair run). Loads the
 * foods once, reports what would change in dry-run, and writes in a single
 * transaction when asked.
 */
export function reapplyAllDiary({ dryRun = false, nowIso, transaction = true } = {}) {
  const foodRows = db.prepare('SELECT * FROM foods WHERE deleted_at IS NULL').all();
  const foods = new Map(foodRows.map(r => [r.id, foodScaleShape(r)]));
  const stamp = nowIso || new Date().toISOString();
  const dates = db.prepare('SELECT id, date, items FROM diary WHERE deleted_at IS NULL ORDER BY date').all();
  const changes = [];
  const updates = [];

  for (const entry of dates) {
    let items;
    try { items = JSON.parse(entry.items || '[]'); } catch { continue; }
    if (!Array.isArray(items) || !items.length) continue;
    let touched = false;
    const nextItems = items.map(item => {
      const id = linkedFoodId(item);
      const food = id === null ? null : foods.get(id);
      if (!food) return item;
      const next = scaleForItem(food, item);
      if (!next || nutritionEqual(item.nutrition, next)) return item;
      touched = true;
      changes.push({ date: entry.date, name: item.name, before: item.nutrition?.calories, after: next.calories });
      return { ...item, nutrition: next, updatedAt: stamp };
    });
    if (touched) updates.push({ id: entry.id, items: JSON.stringify(nextItems) });
  }

  if (!dryRun && updates.length) {
    const write = () => {
      const stmt = db.prepare(`UPDATE diary SET items = ?, updated_at = datetime('now') WHERE id = ?`);
      for (const u of updates) stmt.run(u.items, u.id);
    };
    if (transaction) db.transaction(write)(); else write();
  }

  return { rows: updates.length, items: changes.length, changes };
}
