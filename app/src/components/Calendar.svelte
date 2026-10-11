<script lang="ts">
  import { addMonths, dayDistance, longDate, monthGrid } from "../lib/dates";
  import { mobile } from "../lib/platform";
  import { store } from "../lib/store.svelte";
  import type { Todo } from "../lib/types";
  import Icon from "./Icon.svelte";
  import QuickAdd from "./QuickAdd.svelte";
  import TodoList from "./TodoList.svelte";

  interface Props {
    today: string;
    /** 搜尋：只顯示符合的待辦 */
    matches: (t: Todo) => boolean;
    /** 搜尋中（已完成區固定展開） */
    searching: boolean;
  }
  let { today, matches, searching }: Props = $props();

  /** 選到的那一天，下方列出那天到期的待辦 */
  let selected = $state(store.today);
  /** 正在看的月份，例如 "2026-10" */
  let month = $state(store.today.slice(0, 7));
  let showDone = $state(false);
  let quickAdd = $state<ReturnType<typeof QuickAdd>>();

  export function focus() {
    quickAdd?.focus();
  }

  const days = $derived(monthGrid(month));
  const monthLabel = $derived(`${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`);

  const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;
  /** 每一天到期的待辦：未完成的在前（高優先先），已完成的在後 */
  const byDay = $derived.by(() => {
    const first = days[0];
    const last = days[days.length - 1];
    const map = new Map<string, Todo[]>();
    const add = (t: Todo) => {
      if (!t.due || t.due < first || t.due > last || !matches(t)) return;
      const list = map.get(t.due);
      if (list) list.push(t);
      else map.set(t.due, [t]);
    };
    store.allOpen.forEach(add);
    store.done.forEach(add);
    for (const list of map.values())
      list.sort(
        (a, b) =>
          Number(a.done) - Number(b.done) ||
          Number(store.waiting.has(a.id)) - Number(store.waiting.has(b.id)) ||
          (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
          a.createdAt.localeCompare(b.createdAt),
      );
    return map;
  });

  const dayTodos = $derived(store.allOpen.filter((t) => t.due === selected && matches(t)));
  const dayDone = $derived(store.done.filter((t) => t.due === selected && matches(t)));

  /** 格子裡最多列幾筆，其餘顯示「還有 N 項」 */
  const SHOWN = 3;

  function select(day: string) {
    selected = day;
    if (day.slice(0, 7) !== month) month = day.slice(0, 7);
  }

  function shift(n: number) {
    month = addMonths(month, n);
  }

  function goToday() {
    month = today.slice(0, 7);
    selected = today;
  }

  /** 點格子裡的待辦：選那一天，並在下方展開它 */
  function openTodo(t: Todo) {
    if (suppressClick) return;
    select(t.due!);
    if (!t.done) store.focus = t.id;
  }

  // ---- 電腦版：把待辦拖到別天改期限 ----
  let drag = $state<{ todo: Todo; x: number; y: number; moved: boolean; over: string | null } | null>(null);
  /** 剛拖完放開時會再觸發一次 click，不要當成點擊 */
  let suppressClick = false;

  function dragStart(e: PointerEvent, t: Todo) {
    if (mobile || e.button !== 0 || t.done || t.id.startsWith("tmp-")) return;
    drag = { todo: t, x: e.clientX, y: e.clientY, moved: false, over: null };
  }

  function dragMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-day]");
    drag = { ...drag, x: e.clientX, y: e.clientY, moved: true, over: cell?.dataset.day ?? null };
  }

  function dragEnd() {
    if (!drag) return;
    const { todo, moved, over } = drag;
    drag = null;
    if (!moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false));
    if (over && over !== todo.due) {
      store.update(todo.id, { due: over });
      select(over);
    }
  }

  // ---- 手機：左右滑換月份 ----
  let touch: { x: number; y: number } | null = null;
  function touchStart(e: TouchEvent) {
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function touchEnd(e: TouchEvent) {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  }

  function tone(t: Todo): string {
    if (t.done) return "done";
    if (store.waiting.has(t.id)) return "waiting";
    if (t.due! < today) return "late";
    return t.priority;
  }
</script>

<svelte:window onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={() => (drag = null)} />

<div class="cal" class:dragging={drag?.moved}>
  <div class="bar">
    <h2>{monthLabel}</h2>
    <button class="icon-btn" onclick={() => shift(-1)} aria-label="上個月" title="上個月">
      <span class="flip"><Icon name="chevron" size={14} /></span>
    </button>
    <button class="icon-btn" onclick={() => shift(1)} aria-label="下個月" title="下個月"><Icon name="chevron" size={14} /></button>
    <button class="today-btn" onclick={goToday} disabled={month === today.slice(0, 7) && selected === today}>今天</button>
  </div>

  <div class="week" aria-hidden="true">
    {#each "一二三四五六日" as w, i (w)}<span class:weekend={i >= 5}>{w}</span>{/each}
  </div>

  <div class="grid" ontouchstart={touchStart} ontouchend={touchEnd} role="group" aria-label={monthLabel}>
    {#each days as day (day)}
      {@const items = byDay.get(day) ?? []}
      {@const open = items.filter((t) => !t.done)}
      <!-- 鍵盤使用者用格子裡的日期按鈕 -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="cell"
        class:out={day.slice(0, 7) !== month}
        class:on={day === selected}
        class:drop={drag?.moved && drag.over === day}
        data-day={day}
        onclick={() => select(day)}
        ondblclick={() => !mobile && (select(day), quickAdd?.focus())}
      >
        <button class="num" class:today={day === today} onclick={(e) => (e.stopPropagation(), select(day))} aria-label={longDate(day)} aria-pressed={day === selected}>
          {Number(day.slice(8))}
        </button>
        {#if mobile}
          {#if open.length}
            <span class="dots">
              {#each open.slice(0, 3) as t (t.id)}<i class={tone(t)}></i>{/each}
            </span>
          {/if}
        {:else}
          {#each items.slice(0, SHOWN) as t (t.id)}
            <button
              class="chip {tone(t)}"
              class:lifted={drag?.moved && drag.todo.id === t.id}
              title={t.title}
              onpointerdown={(e) => dragStart(e, t)}
              onclick={(e) => (e.stopPropagation(), openTodo(t))}
            >
              {t.title}
            </button>
          {/each}
          {#if items.length > SHOWN}
            <span class="more">還有 {items.length - SHOWN} 項</span>
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  <div class="day-head">
    <h3>{longDate(selected)}</h3>
    <span>{dayDistance(selected, today)}</span>
  </div>
  <QuickAdd bind:this={quickAdd} defaultDue={selected} />
  {#key selected}
    <TodoList
      todos={dayTodos}
      done={dayDone}
      {today}
      flat
      showDone={showDone || searching}
      ontoggledone={() => (showDone = !showDone)}
      emptyText={searching ? "這天沒有符合的待辦" : "這天沒有待辦"}
    />
  {/key}
</div>

{#if drag?.moved}
  <div class="ghost" style:left="{drag.x}px" style:top="{drag.y}px">{drag.todo.title}</div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px 10px 10px;
  }
  h2 {
    margin: 0 auto 0 0;
    font-size: 16px;
    font-weight: 700;
  }
  .flip {
    display: grid;
    transform: scaleX(-1);
  }
  .today-btn {
    margin-left: 6px;
    height: 28px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--sub);
  }
  .today-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .today-btn:disabled {
    opacity: 0.45;
  }
  .week,
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .week span {
    padding: 0 0 6px;
    text-align: center;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--sub);
  }
  .week .weekend {
    color: var(--faint);
  }
  .grid {
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .cell {
    min-height: 96px;
    min-width: 0;
    padding: 4px 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    transition: background 0.12s;
  }
  .cell:hover {
    background: var(--hover);
  }
  .cell.on {
    background: var(--accent-soft);
  }
  .cell.drop {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .cell.out .num,
  .cell.out .chip {
    opacity: 0.45;
  }
  .num {
    align-self: flex-start;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: var(--sub);
  }
  .num.today {
    background: var(--accent);
    color: #fff;
    font-weight: 700;
  }
  .chip {
    display: block;
    width: 100%;
    height: 20px;
    padding: 0 6px;
    border-radius: 5px;
    border-left: 2.5px solid var(--accent);
    background: var(--raised);
    box-shadow: 0 0 0 1px var(--line);
    font-size: 11.5px;
    line-height: 20px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: grab;
  }
  .chip:hover {
    background: var(--bg2);
  }
  .chip.high,
  .chip.late {
    border-left-color: var(--warn);
  }
  .chip.late {
    color: var(--warn);
  }
  .chip.low,
  .chip.waiting {
    border-left-color: var(--ring);
    color: var(--sub);
  }
  .chip.done {
    border-left-color: var(--ring);
    color: var(--faint);
    text-decoration: line-through;
    cursor: pointer;
  }
  .chip.lifted {
    opacity: 0.35;
  }
  .more {
    padding: 0 6px;
    font-size: 11px;
    color: var(--faint);
  }
  .dragging,
  .dragging .chip {
    cursor: grabbing;
  }
  .ghost {
    position: fixed;
    z-index: 50;
    max-width: 180px;
    padding: 3px 10px;
    border-radius: 6px;
    background: var(--raised);
    box-shadow: var(--pop-shadow);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    transform: translate(-50%, -130%);
  }
  .day-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 22px 10px 12px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }
  .day-head span {
    font-size: 12.5px;
    color: var(--sub);
  }

  /* ---- 手機：格子小，只用圓點表示那天有待辦 ---- */
  :global(html.mobile) .cell {
    min-height: 50px;
    align-items: center;
    gap: 3px;
    padding: 4px 0 6px;
  }
  :global(html.mobile) .cell:hover {
    background: none;
  }
  :global(html.mobile) .cell.on {
    background: var(--accent-soft);
  }
  :global(html.mobile) .num {
    align-self: center;
    min-width: 28px;
    height: 28px;
    font-size: 14px;
  }
  .dots {
    display: flex;
    gap: 3px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }
  .dots i.high,
  .dots i.late {
    background: var(--warn);
  }
  .dots i.low,
  .dots i.waiting {
    background: var(--ring);
  }
</style>
