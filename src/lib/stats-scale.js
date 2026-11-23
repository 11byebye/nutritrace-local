/**
 * stats-scale.js — explicit y-axis range for the Statistics chart.
 *
 * The chart auto-fits to its data. For weight that reads badly: a goal
 * outside the data range stretches the canvas out to the goal with no
 * breathing room, and a goal just inside it sits on the frame. The ask
 * (user 2026-11-23) is one kilogram of air beyond every plotted value,
 * the goal included: a max of 88 renders as 89 and a goal of 78 puts the
 * floor at 77.
 *
 * Only metrics listed in PAD_KG get a range today; everything else keeps
 * the existing auto-fit (add an entry to pad another metric). The margin
 * is expressed in kg and converted for pound display, so 1 renders as
 * ~2.2 lb rather than 1 lb.
 */

const KG_TO_LB = 2.20462;

/** Margin in kg per metric. A missing entry means "no explicit range". */
const PAD_KG = {
  weight: 1,
};

/**
 * The margin for a metric in display units, or 0 when it gets none.
 * @param {string} metric
 * @param {string} [weightUnit] 'kg' | 'lb'
 * @returns {number}
 */
export function padForMetric(metric, weightUnit) {
  const kg = PAD_KG[metric];
  if (!kg) return 0;
  return weightUnit === 'lb' ? kg * KG_TO_LB : kg;
}

/**
 * A padded range around every finite value handed in.
 *
 * Rounded to one decimal because weight is logged at 0.1 and float noise
 * in a tick label is worse than the rounding. `floorZero` keeps a body
 * measurement from starting below zero, which is never real.
 *
 * @param {Array<number|null|undefined>} values
 * @param {{ pad?: number, floorZero?: boolean }} [opts]
 * @returns {{ min: number, max: number } | null} null when nothing finite
 */
export function paddedRange(values, { pad = 0, floorZero = true } = {}) {
  const nums = (values || []).filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  const step = Number.isFinite(pad) && pad > 0 ? pad : 0;
  let min = Math.min(...nums) - step;
  const max = Math.max(...nums) + step;
  if (floorZero && min < 0) min = 0;
  const round = (v) => Math.round(v * 10) / 10;
  return { min: round(min), max: round(max) };
}
