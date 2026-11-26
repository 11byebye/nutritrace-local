/**
 * stats-sma.js — trailing simple moving average for the Statistics chart.
 *
 * The chart already draws two other reference lines: `Average` is the flat
 * mean of the whole range and `Trend` is a linear regression. Neither is a
 * rolling mean, so a reading that jumps today barely moves them. This helper
 * answers the other question: "what does the last N days look like?"
 *
 * Rules (user request 2026-11-26):
 *  - simple, not weighted: every finite value in the trailing window counts once
 *  - gaps are skipped, never counted as zero, so a day with no weigh-in does
 *    not drag the line down
 *  - a point is drawn only when the window holds at least `minCount` values,
 *    so a lone reading cannot paint a fake flat line over its neighbour
 *  - windows at the left edge of the range are shorter, which keeps a 7-day
 *    line useful on a 7-day range instead of a single dot
 */

export const SMA_WINDOW_MIN = 2;
export const SMA_WINDOW_MAX = 90;
export const SMA_WINDOW_DEFAULT = 7;

/**
 * Clamp a user-entered window to a whole number of days.
 * @param {unknown} value
 * @returns {number}
 */
export function clampSmaWindow(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SMA_WINDOW_DEFAULT;
  return Math.min(SMA_WINDOW_MAX, Math.max(SMA_WINDOW_MIN, n));
}

/**
 * Trailing simple moving average, one entry per input value.
 *
 * @param {Array<number|null|undefined>} values
 * @param {number} window days in the trailing window (clamped to >= 1 here)
 * @param {{ minCount?: number }} [opts] finite values required to draw a point
 * @returns {Array<number|null>} rounded to one decimal, null where no average
 */
export function movingAverage(values, window, { minCount = 2 } = {}) {
  const list = values || [];
  const n = Math.max(1, Math.floor(Number(window)) || 1);
  const need = Math.max(1, Math.min(Number(minCount) || 1, n));
  const out = new Array(list.length).fill(null);
  for (let i = 0; i < list.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) {
      const v = list[j];
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count >= need) out[i] = Math.round((sum / count) * 10) / 10;
  }
  return out;
}
