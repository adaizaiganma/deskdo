<script lang="ts">
  import { diffDays, rowDue } from "../lib/dates";
  import { store } from "../lib/store.svelte";
  import type { Todo } from "../lib/types";

  /**
   * 艾森豪矩陣：依優先和期限自動分類。
   * 重要 = 高優先；緊急 = 已經逾期，或 3 天內（今天、明天、後天）到期。
   */
  interface Props {
    today: string;
    matches: (t: Todo) => boolean;
    onpick: (t: Todo) => void;
  }
  let { today, matches, onpick }: Props = $props();

  /** 每一格最多列幾筆 */
  const SHOWN = 5;
  const URGENT_DAYS = 2;

  const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;
  const sorted = $derived(
    store.open
      .filter(matches)
      .sort(
        (a, b) =>
          (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
          (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
          a.createdAt.localeCompare(b.createdAt),
      ),
  );
  const urgent = (t: Todo) => !!t.due && diffDays(today, t.due) <= URGENT_DAYS;
  const important = (t: Todo) => t.priority === "high";

  const quadrants = $derived([
    { key: "do", title: "馬上做", axis: "重要・緊急", items: sorted.filter((t) => important(t) && urgent(t)) },
    { key: "plan", title: "排時間做", axis: "重要・不緊急", items: sorted.filter((t) => important(t) && !urgent(t)) },
    { key: "quick", title: "盡快處理", axis: "不重要・緊急", items: sorted.filter((t) => !important(t) && urgent(t)) },
    { key: "later", title: "有空再做", axis: "不重要・不緊急", items: sorted.filter((t) => !important(t) && !urgent(t)) },
  ]);
</script>

<section class="matrix" aria-label="優先矩陣" title="高優先算重要，3 天內到期或逾期算緊急">
  <div class="cols" aria-hidden="true">
    <span></span><span>緊急</span><span>不緊急</span>
  </div>
  <div class="grid">
    <span class="row-label" aria-hidden="true">重要</span>
    {#each quadrants.slice(0, 2) as q (q.key)}{@render quadrant(q)}{/each}
    <span class="row-label" aria-hidden="true">不重要</span>
    {#each quadrants.slice(2) as q (q.key)}{@render quadrant(q)}{/each}
  </div>
</section>

{#snippet quadrant(q: { key: string; title: string; axis: string; items: Todo[] })}
  <div class="q {q.key}" aria-label="{q.title}（{q.axis}）">
    <div class="qhead">
      <span class="qtitle">{q.title}</span>
      <span class="qcount">{q.items.length}</span>
    </div>
    {#each q.items.slice(0, SHOWN) as t (t.id)}
      {@const due = t.due ? rowDue(t.due, today) : null}
      <button class="item" onclick={() => onpick(t)} title={t.title}>
        <span class="ititle">{t.title}</span>
        {#if due}<span class="idue {due.tone}">{due.count}</span>{/if}
      </button>
    {:else}
      <span class="none">沒有</span>
    {/each}
    {#if q.items.length > SHOWN}
      <span class="more">還有 {q.items.length - SHOWN} 項</span>
    {/if}
  </div>
{/snippet}

<style>
  .matrix {
    margin-bottom: 18px;
  }
  .cols,
  .grid {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
  .cols {
    margin-bottom: 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--sub);
    text-align: center;
  }
  .row-label {
    writing-mode: vertical-rl;
    display: grid;
    place-items: center;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--sub);
    letter-spacing: 0.2em;
  }
  .q {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    min-height: 150px;
    padding: 10px 8px 8px;
    border-radius: 12px;
    background: var(--raised);
    box-shadow: 0 0 0 1px var(--line);
    border-top: 3px solid var(--tone);
  }
  .q.do {
    --tone: var(--warn);
  }
  .q.plan {
    --tone: var(--accent);
  }
  .q.quick {
    --tone: #d4a015;
  }
  .q.later {
    --tone: var(--ring);
  }
  .qhead {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 0 4px 6px;
  }
  .qtitle {
    white-space: nowrap;
    font-size: 13.5px;
    font-weight: 700;
    color: var(--tone);
  }
  .q.later .qtitle {
    color: var(--sub);
  }
  .qcount {
    margin-left: auto;
    font-size: 12px;
    color: var(--faint);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 0 6px;
    border-radius: 7px;
    text-align: left;
    font-size: 13px;
  }
  .item:hover {
    background: var(--hover);
  }
  .ititle {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .idue {
    flex: none;
    font-size: 11.5px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .idue.warn {
    color: var(--warn);
  }
  .idue.soon {
    color: var(--accent);
  }
  .none,
  .more {
    padding: 4px 6px;
    font-size: 12px;
    color: var(--faint);
  }
</style>
