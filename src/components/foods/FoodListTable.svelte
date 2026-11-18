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
   * The two money columns are mass-only on purpose: the fork's price math
   * divides by package grams, so an ml food gets no SEK/100 and no P/SEK
   * rather than a number that pretends 1 ml = 1 g.
   */
  import { _ } from 'svelte-i18n';
  import { Nutrition } from '../../lib/nutrition.js';
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

  // One exclusive filter, Food by default. The chips are a selector, not a
  // set of toggles: Food shows the whole library, a category shows only its
  // rows. Alcohol owns its rows, so a wine never appears under Beverage.
  let filter = 'food';

  // Alcohol is its own category, never a drink. "Sprite" contains "sprit",
  // so every word here needs its boundaries.
  const ALCOHOL_RE = /\bvin\b|\böl\b|\bipa\b|\blager\b|\bcider\b|\bsprit\b|whisk(e)?y|\bgin\b|\brom\b|\bvodka\b|sangria|glögg|mousserande|prosecco|champagne|cava/i;

  // Snacks, Meat and Veg are multi-tag: a chorizo answers both. The filter
  // still shows one category at a time.
  const TAG_DEFS = [
    { key: 'snacks', label: 'foods.list.tag_snacks', icon: 'cookie',
      re: /chips|ostbåg|popcorn|jordnöt|cashew|mandel|nöt|godis|choklad|kaka\b|kakor|kex|glass|snack|salami|chark|saltad/i },
    { key: 'meat', label: 'foods.list.tag_meat', icon: 'kebab_dining',
      re: /kyckling|fläsk|nöt\b|nötkött|kött|färs|bacon|skinka|korv|salami|kalkon|lamm|kalv|kebab|hamburgare|biff|filé|fransyska|fläskytterfilé/i },
    { key: 'veg', label: 'foods.list.tag_veg', icon: 'eco',
      re: /grönsak|tomat|gurka|paprika|sallad|spenat|broccoli|blomkål|morot|lök|potatis|kål|zucchini|svamp|avokado|majs|böna|lins|kikärt|ärt|rödbeta|kålrot|purjolök|vitlök|fänkål|sparris|ingefära/i },
  ];

  const TAG_CATEGORY = {
    snacks: /sötsaker|socker/i,
    meat: /kött|fågel/i,
    veg: /grönsak|rotfrukt/i,
  };

  /** The API maps `category` to a one-element `categories` array; the scalar
   *  is gone by the time a food reaches this table. */
  function catText(food) {
    const list = food?.categories;
    if (Array.isArray(list) && list.length) return list.join(' ');
    return String(food?.category || '');
  }

  function isAlcohol(food) {
    if (Number(food?.nutrition?.alcohol) > 0) return true;
    return ALCOHOL_RE.test(`${food?.name || ''} ${food?.brand || ''}`);
  }

  function tagsOf(food) {
    const text = `${food.name || ''} ${food.brand || ''}`;
    const cat = catText(food);
    const out = [];
    for (const def of TAG_DEFS) {
      const byName = def.re.test(text);
      const byCat = TAG_CATEGORY[def.key] ? TAG_CATEGORY[def.key].test(cat) : false;
      if (byName || byCat) out.push(def.key);
    }
    return out;
  }

  const DRINK_RE = /dryck|drink|beverage/i;
  const DRINK_NAME_RE = /\b(läsk|saft|juice|vatten|dryck|cola|pepsi|sprite|fanta|kaffe|te|öl|vin|cider|must|nektar|smoothie|kombucha|mjölk|havredryck|sojadryck)\b/i;

  /** A drink is the Dryck category, an ml unit, or a name that says so.
   *  Alcohol is excluded here on purpose: it has its own chip. */
  function isBeverage(food) {
    if (isAlcohol(food)) return false;
    if (DRINK_RE.test(catText(food))) return true;
    if (String(food?.unit || '').toLowerCase() === 'ml') return true;
    return DRINK_NAME_RE.test(String(food?.name || ''));
  }

  const FILTERS = [
    { key: 'food', label: 'foods.list.show_food', icon: 'restaurant' },
    { key: 'beverage', label: 'foods.list.show_beverage', icon: 'local_drink' },
    { key: 'alcohol', label: 'foods.list.tag_alcohol', icon: 'wine_bar' },
    ...TAG_DEFS,
  ];

  function matches(food, key) {
    if (key === 'food') return true;
    if (key === 'alcohol') return isAlcohol(food);
    if (key === 'beverage') return isBeverage(food);
    return tagsOf(food).includes(key);
  }

  // Sugar is deliberately not a column: the carb figure answers the same
  // question at a glance and the sugar value is still stored on the food.
  // The basis moved into the one note above the table, because every row is
  // on the same 100 basis and a repeated column buys nothing.
  const COLUMNS = [
    { key: 'name', label: 'foods.list.name', align: 'left' },
    { key: 'category', label: 'foods.list.category', align: 'left' },
    { key: 'calories', label: 'foods.list.kcal', align: 'right' },
    { key: 'proteins', label: 'foods.list.protein', align: 'right' },
    { key: 'carbohydrates', label: 'foods.list.carbs', align: 'right' },
    { key: 'fat', label: 'foods.list.fat', align: 'right' },
    { key: 'package_g', label: 'foods.list.pack', align: 'right' },
    { key: 'price', label: 'foods.list.price', align: 'right' },
    { key: 'price_100', label: 'foods.list.price_100', align: 'right' },
    { key: 'protein_sek', label: 'foods.list.protein_sek', align: 'right' },
  ];

  function sortBy(key) {
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

  /** Grams of protein per krona, on the same 100 basis as the other columns.
   *  Equal to (protein per 100 g) / (price per 100 g), so it needs no package
   *  size and stays comparable between a 700 g tray and a 250 g one. */
  function proteinSek(food) {
    const protein = per100(food, 'proteins');
    const price = price100(food);
    if (protein == null || price == null || price <= 0) return null;
    return protein / price;
  }

  function gramsPerKrona(value) {
    if (value == null) return '';
    return (value < 1 ? value.toFixed(2) : value.toFixed(1)).replace('.', ',');
  }

  function show(value, digits = 1) {
    if (value == null) return '';
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(digits).replace('.', ',');
  }

  function num(value, digits = 0) {
    if (value == null) return '';
    if (Number.isInteger(Number(value))) return String(Number(value));
    return Number(value).toFixed(digits).replace('.', ',');
  }

  function money(value) {
    if (value == null) return '';
    return value.toFixed(2).replace('.', ',');
  }

  function sortValue(food, key) {
    if (key === 'name') return String(food.name || '').toLowerCase();
    if (key === 'category') return catText(food).toLowerCase();
    if (key === 'package_g') return Number(food.package_weight_g) || -1;
    if (key === 'price') return Number(food.price) || -1;
    if (key === 'price_100') return price100(food) ?? -1;
    if (key === 'protein_sek') return proteinSek(food) ?? -1;
    return per100(food, key) ?? -1;
  }

  // Two independent selectors. Food/Drink picks the kind, the four tags pick
  // a category *regardless of kind*: Alcohol lists every drink-tagged item
  // even with Drink off, and Meat/Veg/Snacks list their items even with Food
  // off. A row with no tag still follows the kind chip only.
  $: filtered = foods.filter((f) => matches(f, filter));

  $: sorted = (() => {
    const rows = [...filtered];
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
  <div class="listview-bar">
    {#each FILTERS as item}
      <button type="button" class="chip" class:on={filter === item.key}
        aria-pressed={filter === item.key}
        on:click={() => (filter = item.key)}>
        <span class="material-symbols-rounded chip-icon">{item.icon}</span>
        {$_(item.label)}
      </button>
    {/each}
    <span class="listview-note">{$_('foods.list.per_100_note')}</span>
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
            <td colspan={COLUMNS.length}>{$_('foods.list.filters_empty')}</td>
          </tr>
        {/if}
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
            <td class="col-category">{catText(food)}</td>
            <td class="col-calories right">{_energy ? `${_energy.value.toLocaleString()} ${_energy.unit}` : ''}</td>
            <td class="col-proteins right">{show(per100(food, 'proteins'))}</td>
            <td class="col-carbohydrates right">{show(per100(food, 'carbohydrates'))}</td>
            <td class="col-fat right">{show(per100(food, 'fat'))}</td>
            <td class="col-package_g right">{food.package_weight_g ? `${num(food.package_weight_g, 0)} g` : ''}</td>
            <td class="col-price right">{money(Number(food.price) || null)}</td>
            <td class="col-price_100 right">{money(price100(food))}</td>
            <td class="col-protein_sek right">{gramsPerKrona(proteinSek(food))}</td>
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
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent-dim);
    border-color: transparent;
    color: var(--accent);
  }
  .chip-icon { font-size: 15px; }
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
  .col-category {
    color: var(--text-2);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Phone: the table scrolls sideways with the name pinned, so a row keeps
     its identity while the numbers slide. Hiding columns instead would hide
     the very numbers being compared. */
  @media (max-width: 719px) {
    .food-table { font-size: 12px; }
    thead th, td { padding: 6px 7px; }
    .col-name { min-width: 150px; }
    /* Frozen column: tinted and shadowed so the names read as a fixed
       gutter, not as another value column that happens to stay put. The
       tint is the accent at low strength, so it works on both themes. */
    th.col-name, td.col-name {
      position: sticky;
      left: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--accent) 8%, var(--surface-1));
      box-shadow: 1px 0 0 var(--border), 3px 0 8px -4px rgba(0, 0, 0, 0.35);
    }
    th.col-name { background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); }
    .chip { padding: 4px 9px; font-size: 11px; }
  }
  .cell-name { display: flex; align-items: center; gap: 4px; color: var(--text-1); }
  .cell-brand { display: block; font-size: 11px; color: var(--text-3); }
  .col-package_g { color: var(--text-2); white-space: nowrap; }
  .listview-note { font-size: 11px; color: var(--text-3); }
  .fav { font-size: 13px; color: var(--accent); }
</style>
