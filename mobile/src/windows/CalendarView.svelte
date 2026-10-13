<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { addMonths, dayDistance, longDate, monthGrid, monthTitle, weekdayHeads } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import Fab from "../components/Fab.svelte";
  import Icon from "../components/Icon.svelte";
  import TodoGroups from "../components/TodoGroups.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { ui } from "../lib/ui.svelte";

  /** 日曆：月份格子上用圓點表示那天有待辦，下面列出選到的那一天 */
  let { today, onmenu }: { today: string; onmenu: () => void } = $props();

  let selected = $state(store.today);
  /** 正在看的月份，例如 "2026-10" */
  let month = $state(store.today.slice(0, 7));
  let showDone = $state(false);

  const days = $derived(monthGrid(month));
  const monthLabel = $derived(monthTitle(month));

  const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;
  /** 每一天到期的未完成待辦（有時間的照時間，再來高優先先） */
  const byDay = $derived.by(() => {
    const first = days[0];
    const last = days[days.length - 1];
    const map = new Map<string, Todo[]>();
    for (const t of store.allOpen) {
      if (!t.due || t.due < first || t.due > last) continue;
      const list = map.get(t.due);
      if (list) list.push(t);
      else map.set(t.due, [t]);
    }
    for (const list of map.values())
      list.sort(
        (a, b) =>
          (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
          (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1),
      );
    return map;
  });

  const dayTodos = $derived(store.allOpen.filter((t) => t.due === selected));
  const dayDone = $derived(store.done.filter((t) => t.due === selected));

  function select(day: string) {
    selected = day;
    if (day.slice(0, 7) !== month) month = day.slice(0, 7);
  }

  function goToday() {
    month = today.slice(0, 7);
    selected = today;
  }

  // ---- 左右滑換月份 ----
  let touch: { x: number; y: number } | null = null;
  function touchStart(e: TouchEvent) {
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function touchEnd(e: TouchEvent) {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) month = addMonths(month, dx < 0 ? 1 : -1);
  }

  function tone(t: Todo): string {
    if (store.waiting.has(t.id)) return "waiting";
    if (store.overdue(t) || t.priority === "high") return "warn";
    return t.priority;
  }
</script>

<div class="page">
  <TopBar title={monthLabel} lead="menu" onlead={onmenu}>
    {#snippet actions()}
      <button class="icon-btn" onclick={() => (month = addMonths(month, -1))} aria-label={t("上個月", "Previous month")}><Icon name="chevronLeft" size={24} /></button>
      <button class="icon-btn" onclick={() => (month = addMonths(month, 1))} aria-label={t("下個月", "Next month")}><Icon name="chevron" size={24} /></button>
      <button class="today" onclick={goToday} disabled={month === today.slice(0, 7) && selected === today}>{t("今天", "Today")}</button>
    {/snippet}
  </TopBar>

  <div class="scroll">
    <div class="week" aria-hidden="true">
      {#each weekdayHeads() as w (w)}<span>{w}</span>{/each}
    </div>
    <div class="grid" role="group" aria-label={monthLabel} ontouchstart={touchStart} ontouchend={touchEnd}>
      {#each days as day (day)}
        {@const items = byDay.get(day) ?? []}
        <button
          class="cell"
          class:out={day.slice(0, 7) !== month}
          class:sel={day === selected}
          class:today={day === today}
          onclick={() => select(day)}
          aria-label={t(`${longDate(day)}，${items.length} 項待辦`, `${longDate(day)}, ${items.length} to-dos`)}
          aria-pressed={day === selected}
        >
          <span class="num">{Number(day.slice(8))}</span>
          <span class="dots">
            {#each items.slice(0, 3) as t (t.id)}<i class={tone(t)}></i>{/each}
          </span>
        </button>
      {/each}
    </div>

    <div class="day-head">
      <h2>{longDate(selected)}</h2>
      <span>{dayDistance(selected, today)}{dayTodos.length ? ` · ${t(`${dayTodos.length} 項`, `${dayTodos.length} to-dos`)}` : ""}</span>
    </div>
    {#key selected}
      <TodoGroups
        todos={dayTodos}
        done={dayDone}
        {today}
        flat
        {showDone}
        ontoggledone={() => (showDone = !showDone)}
        emptyText={t("這天沒有待辦", "Nothing due this day")}
      />
    {/key}
  </div>

  <Fab aria={t("在這天新增待辦", "Add a to-do on this day")} onclick={() => ui.add({ due: selected })} />
</div>

<style>
  .page {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .today {
    height: 36px;
    margin-left: 4px;
    padding: 0 14px;
    border-radius: 18px;
    border: 1px solid var(--line);
    font-size: 14px;
    font-weight: 500;
    color: var(--accent);
  }
  .today:disabled {
    opacity: 0.4;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 96px;
  }
  .week,
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    padding: 0 12px;
  }
  .week span {
    padding: 8px 0 6px;
    text-align: center;
    font-size: 12px;
    color: var(--sub);
  }
  .cell {
    height: 54px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }
  .num {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 15px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .cell.out .num {
    color: var(--faint);
    opacity: 0.6;
  }
  .cell.today .num {
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .cell.sel .num {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: none;
  }
  .dots {
    display: flex;
    gap: 3px;
    height: 5px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }
  .dots i.warn {
    background: var(--warn);
  }
  .dots i.low,
  .dots i.waiting {
    background: var(--faint);
  }
  .day-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
    padding: 16px 20px 4px;
    border-top: 1px solid var(--c-high);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }
  .day-head span {
    font-size: 13px;
    color: var(--sub);
  }
</style>
