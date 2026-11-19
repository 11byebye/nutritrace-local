<script>
  /**
   * Comparison table for the Meals and Recipes tabs (sysadmin 2026-11-19).
   *
   * The cards answer "which one was that"; this answers "which of my meals is
   * leaner or cheaper per serving". Macros come from the stored per-serving
   * nutrition, money from the ingredient price snapshots, so a recipe's whole
   * batch is never compared as one serving.
   *
   * A meal whose ingredients are only partly priced shows the sum of the
   * priced ones; the cell's title says so, and no marker or legend takes up
   * the bar (user 2026-11-19: the explainer goes).
   */
  import { _ } from 'svelte-i18n';
  import { Nutrition } from '../../lib/nutrition.js';
  import { energyUnit } from '../../stores/settings.js';
  import { mealRollup } from '../../lib/meal-rollup.js';

  export let foods = [];
  export let isRecipe = false;
  export let pickMode = false;
  export let selectedFoods = new Set();
  export let onPick = () => {};
  export let onSelect = () => {};

  let sortKey = 'name';
  let sortDir = 1;

  const COLUMNS = [
    { key: 'name', label: 'foods.list.name', align: 'left' },
    { key: 'calories', label: 'foods.list.kcal', align: 'right' },
    { key: 'proteins', label: 'foods.list.protein', align: 'right' },
    { key: 'carbohydrates', label: 'foods.list.carbs', align: 'right' },
    { key: 'fat', label: 'foods.list.fat', align: 'right' },
    { key: 'weight', label: 'foods.list.total_weight', align: 'right' },
    { key: 'price', label: 'foods.list.price', align: 'right' },
    { key: 'protein_sek', label: 'foods.list.protein_sek', align: 'right' },
  ];

  $: rows = foods.map((food) => ({ food, r: mealRollup(food) }));

  function sortBy(key) {
    if (sortKey === key) sortDir = -sortDir;
    else {
      sortKey = key;
      sortDir = key === 'name' ? 1 : -1;
    }
  }

  function sortValue(row, key) {
    if (key === 'name') return String(row.food.name || '').toLowerCase();
    if (key === 'weight') return row.r.totalGrams ?? -1;
    return row.r[key] ?? -1;
  }

  $: sorted = (() => {
    const list = [...rows];
    list.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'sv') * sortDir;
      }
      return (va - vb) * sortDir;
    });
    return list;
  })();

  function show(value, digits = 1) {
    if (value == null) return '';
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(digits).replace('.', ',');
  }

  function grams(value) {
    if (value == null) return '';
    return `${Math.round(value)} g`;
  }

  function money(value) {
    if (value == null) return '';
    return value.toFixed(2).replace('.', ',');
  }

  function proteinSek(value) {
    if (value == null) return '';
    return (value < 1 ? value.toFixed(2) : value.toFixed(1)).replace('.', ',');
  }

  function activate(food) {
    if (pickMode) onSelect(food);
    else onPick(food);
  }
</script>

<div class="listview">
  <div class="listview-bar">
    <span class="listview-count">{sorted.length} / {foods.length}</span>
  </div>
  <div class="listview-scroll">
    <table class="food-table">
      <thead>
        <tr>
          {#each COLUMNS as col}
            <th class="col-{col.key}" class:right={col.align === 'right'}>
              <button type="button" class="th-sort" class:active={sortKey === col.key}
                on:click={() => sortBy(col.key)}
                title={$_('foods.list.sort_by', { values: { col: $_(col.label) } })}>
                {$_(col.label)}
                {#if sortKey === col.key}
                  <span class="material-symbols-rounded th-arrow">{sortDir > 0 ? 'arrow_upward' : 'arrow_downward'}</span>
                {/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if sorted.length === 0}
          <tr class="empty-row">
            <td colspan={COLUMNS.length}>{isRecipe ? $_('foods.list.empty_recipes') : $_('foods.list.empty_meals')}</td>
          </tr>
        {/if}
        {#each sorted as { food, r } (food.id)}
          {@const _sel = selectedFoods.has(food)}
          {@const _energy = r.calories == null ? null : Nutrition.displayEnergy(r.calories, $energyUnit)}
          <tr class="food-row" class:marked={_sel} tabindex="0" role="button"
            on:click={() => activate(food)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(food); } }}>
            <td class="col-name">
              <span class="cell-name">{food.name}</span>
              {#if food._shared_by}
                <span class="cell-brand">by {food._shared_by}</span>
              {/if}
            </td>
            <td class="col-calories right">{_energy ? `${_energy.value.toLocaleString()} ${_energy.unit}` : ''}</td>
            <td class="col-proteins right">{show(r.proteins)}</td>
            <td class="col-carbohydrates right">{show(r.carbohydrates)}</td>
            <td class="col-fat right">{show(r.fat)}</td>
            <td class="col-weight right">{grams(r.totalGrams)}</td>
            <td class="col-price right" title={r.partial ? $_('foods.list.partial_note') : null}>{money(r.totalCost)}</td>
            <td class="col-protein_sek right" title={r.partial ? $_('foods.list.partial_note') : null}>{proteinSek(r.proteinPerSek)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .listview { display: flex; flex-direction: column; gap: 8px; }
  .listview-scroll {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .listview-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .listview-count { margin-left: auto; font-size: 11px; color: var(--text-3); }
  .empty-row td { text-align: center; color: var(--text-3); padding: 18px 10px; }
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
  /* Phone: the table scrolls sideways with the name pinned, so a row keeps
     its identity while the numbers slide. */
  @media (max-width: 719px) {
    .food-table { font-size: 12px; }
    thead th, td { padding: 6px 7px; }
    .col-name { min-width: 150px; }
    th.col-name, td.col-name {
      position: sticky;
      left: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--accent) 8%, var(--surface-1));
      box-shadow: 1px 0 0 var(--border), 3px 0 8px -4px rgba(0, 0, 0, 0.35);
    }
    th.col-name { background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); }
  }
  .cell-name { display: flex; align-items: center; gap: 4px; color: var(--text-1); }
  .cell-brand { display: block; font-size: 11px; color: var(--text-3); }
</style>
