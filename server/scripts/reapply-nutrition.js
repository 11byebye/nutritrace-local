#!/usr/bin/env node
/**
 * One-shot backfill: re-derive every live diary item from its source food.
 *
 *   node scripts/reapply-nutrition.js --dry-run   # print the delta table
 *   node scripts/reapply-nutrition.js --apply     # snapshot, then write
 *
 * Runs inside the container (`docker exec nutritrace node
 * scripts/reapply-nutrition.js …`). The snapshot is the SQLite backup API,
 * taken before any write, at <db>.pre-reapply-<stamp>; it is the rollback.
 */
import db from '../db.js';
import { reapplyAllDiary } from '../lib/reapply.js';

const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const result = reapplyAllDiary({ dryRun: true });

console.log(`reapply-nutrition: ${apply ? 'APPLY' : 'DRY RUN'}`);
for (const c of result.changes) {
  const before = c.before == null ? '?' : Number(c.before).toFixed(1);
  const after = c.after == null ? '?' : Number(c.after).toFixed(1);
  const delta = (c.before != null && c.after != null) ? (c.after - c.before) : null;
  const money = c.priceChanged
    ? `  price ${c.priceBefore == null ? '–' : Number(c.priceBefore).toFixed(2)} -> ${c.priceAfter == null ? '–' : Number(c.priceAfter).toFixed(2)}`
    : '';
  console.log(`  ${c.date}  ${String(c.name).slice(0, 28).padEnd(28)}  ${before} -> ${after} kcal${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`}${money}`);
}
console.log(`  ${result.items} item(s) in ${result.rows} day(s) ${apply ? 'rewritten' : 'would change'}`);

if (!apply) process.exit(0);

if (!result.items) { console.log('  nothing to write'); process.exit(0); }

const dest = `${db.name}.pre-reapply-${stamp}`;
db.backup(dest).then(() => {
  console.log(`  snapshot: ${dest}`);
  const written = reapplyAllDiary({ dryRun: false });
  console.log(`  wrote ${written.items} item(s) in ${written.rows} day(s)`);
}).catch((e) => {
  console.error(`  backup failed, nothing written: ${e.message}`);
  process.exit(1);
});
