<script>
  /**
   * Comparison table for the Foods tab.
   *
   * The card list answers "what did I eat before"; this answers "which of
   * these is cheaper or leaner per 100". So every number is normalised to 100
   * of the food's own unit (g or ml) — a 700 g pack and a 150 ml glass then
   * sit side by side honestly — and the stored portion is shown in its own
   * column instead of silently changing the basis (2026-11-17: a wine batch
   * stored at 150 ml read "per 150" beside everything else "per 100").
   *
   * Units that are not mass or volume (each, slice) cannot be normalised, so
   * those cells stay blank rather than showing a confident wrong number.
   */
  import { _ } from 'svelte-i18n';
  import { Nutrition } from '../../lib/nutrition.js';
  import { amountAndUnit } from '../../lib/units.js';
  import { energyUnit } from '../../stores/settings.js';

  export let foods = [];
  export let manageMode = false;
  export let manageSelected = new Set();
  export let pickMode = false;
  export let selectedFoods = new Set();
  export let onPick = () => {};
  export let onManage = () => {};
  export let onSelect = () => {};

  const MASS_UNITS = new Set(['g', 'ml']);

  let sortKey = 'name';
  let sortDir = 1;

  const COLUMNS = [
    { key: 'name', label: 'foods.list.name', align: 'left' },
    { key: 'basis', label: 'foods.list.basis', align: 'left' },
    { key: 'calories', label: 'foods.list.kcal', align: 'right' },
    { key: 'proteins', label: 'foods.list.protein', align: 'right' },
    { key: 'carbohydrates', label: 'foods.list.carbs', align: 'right' },
    { key: 'sugars', label: 'foods.list.sugars', align: 'right' },
    { key: 'fat', label: 'foods.list.fat', align: 'right' },
    { key: 'price', label: 'foods.list.price', align: 'right' },
    { key: 'price_100', label: 'foods.list.price_100', align: 'right' },
  ];

  function sortBy(key) {
    if (key === 'basis') return;
    if (sortKey === key) sortDir = -sortDir;
    else {
      sortKey = key;
      sortDir = key === 'name' ? 1 : -1;
    }
  }

  function normable(food) {
    return MASS_UNITS.has(String(food.unit || 'g').toLowerCase());
  }

  function per100(food, id) {
    const raw = food.nutrition?.[id];
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (!normable(food)) return null;
    const portion = Number(food.portion) || 100;
    if (!(portion > 0)) return null;
    return (value * 100) / portion;
  }

  function price100(food) {
    const stored = Number(food.price_per_100g);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return null;
  }

  function show(value, digits = 1) {
    if (value == null) return '';
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(digits).replace('.', ',');
  }

  function money(value) {
    if (value == null) return '';
    return value.toFixed(2).replace('.', ',');
  }

  function sortValue(food, key) {
    if (key === 'name') return String(food.name || '').toLowerCase();
    if (key === 'basis') return String(food.unit || 'g');
    if (key === 'price') return Number(food.price) || -1;
    if (key === 'price_100') return price100(food) ?? -1;
    return per100(food, key) ?? -1;
  }

  $: sorted = (() => {
    const rows = [...foods];
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'sv') * sortDir;
      }
      return (va - vb) * sortDir;
    });
    return rows;
  })();

  function activate(food) {
    if (manageMode) onManage(food);
    else if (pickMode) onSelect(food);
    else onPick(food);
  }
</script>

<div class="listview">
  <p class="listview-note">
    {$_('foods.list.per_100_note')}
  </p>
  <div class="listview-scroll">
    <table class="food-table">
      <thead>
        <tr>
          {#each COLUMNS as col}
            <th class="col-{col.key}" class:right={col.align === 'right'}>
              {#if col.key === 'basis'}
                <span class="th-plain">{$_(col.label)}</span>
              {:else}
                <button type="button" class="th-sort" class:active={sortKey === col.key}
                  on:click={() => sortBy(col.key)}
                  title={$_('foods.list.sort_by', { values: { col: $_(col.label) } })}>
                  {$_(col.label)}
                  {#if sortKey === col.key}
                    <span class="material-symbols-rounded th-arrow">{sortDir > 0 ? 'arrow_upward' : 'arrow_downward'}</span>
                  {/if}
                </button>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sorted as food (food.id)}
          {@const _kcal = per100(food, 'calories')}
          {@const _energy = _kcal == null ? null : Nutrition.displayEnergy(_kcal, $energyUnit)}
          {@const _marked = manageMode ? (food.id != null && manageSelected.has(food.id)) : selectedFoods.has(food)}
          <tr class="food-row" class:marked={_marked} tabindex="0"
            role="button"
            on:click={() => activate(food)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(food); } }}>
            <td class="col-name">
              <span class="cell-name">
                {#if food.favorite}<span class="material-symbols-rounded fav">favorite</span>{/if}
                {food.name}
              </span>
              {#if food.brand || food._shared_by}
                <span class="cell-brand">
                  {food.brand || ''}{#if food.brand && food._shared_by} · {/if}{#if food._shared_by}by {food._shared_by}{/if}
                </span>
              {/if}
            </td>
            <td class="col-basis">{amountAndUnit(Number(food.portion) || 100, food.unit || 'g')}</td>
            <td class="col-calories right">{_energy ? `${_energy.value.toLocaleString()} ${_energy.unit}` : ''}</td>
            <td class="col-proteins right">{show(per100(food, 'proteins'))}</td>
            <td class="col-carbohydrates right">{show(per100(food, 'carbohydrates'))}</td>
            <td class="col-sugars right">{show(per100(food, 'sugars'))}</td>
            <td class="col-fat right">{show(per100(food, 'fat'))}</td>
            <td class="col-price right">{money(Number(food.price) || null)}</td>
            <td class="col-price_100 right">{money(price100(food))}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .listview { display: flex; flex-direction: column; gap: 8px; }
  .listview-note {
    margin: 0;
    font-size: 11px;
    color: var(--text-3);
  }
  .listview-scroll {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .food-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    padding: 0;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
    white-space: nowrap;
  }
  .th-plain { display: block; padding: 8px 10px; }
  .th-sort {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }
  .right .th-sort, th.right { justify-content: flex-end; }
  .th-sort.active { color: var(--text-1); }
  .th-arrow { font-size: 13px; }
  tbody tr {
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--surface-2); }
  tbody tr.marked { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  tbody tr:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  td {
    padding: 7px 10px;
    vertical-align: top;
  }
  td.right {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .col-name { min-width: 190px; }
  .cell-name { display: flex; align-items: center; gap: 4px; color: var(--text-1); }
  .cell-brand { display: block; font-size: 11px; color: var(--text-3); }
  .col-basis { color: var(--text-2); white-space: nowrap; }
  .fav { font-size: 13px; color: var(--accent); }
</style>
