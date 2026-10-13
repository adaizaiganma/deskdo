<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { compareDue, diffDays, rowDue } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";

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

  const URGENT_DAYS = 2;

  const sorted = $derived(
    store.open
      .filter(matches)
      .sort(
        (a, b) =>
          compareDue(a, b),
      ),
  );
  const urgent = (t: Todo) => !!t.due && diffDays(today, t.due) <= URGENT_DAYS;
  const important = (t: Todo) => t.priority === "high";

  const quadrants = $derived([
    { key: "do", title: t("馬上做", "Do now"), axis: t("重要・緊急", "Important · Urgent"), items: sorted.filter((t) => important(t) && urgent(t)) },
    { key: "plan", title: t("排時間做", "Schedule"), axis: t("重要・不緊急", "Important · Not urgent"), items: sorted.filter((t) => important(t) && !urgent(t)) },
    { key: "quick", title: t("盡快處理", "Get it done"), axis: t("不重要・緊急", "Not important · Urgent"), items: sorted.filter((t) => !important(t) && urgent(t)) },
    { key: "later", title: t("有空再做", "Someday"), axis: t("不重要・不緊急", "Not important · Not urgent"), items: sorted.filter((t) => !important(t) && !urgent(t)) },
  ]);
</script>

<section class="matrix" aria-label={t("優先矩陣", "Priority matrix")} title={t("高優先算重要，3 天內到期或逾期算緊急", "High priority counts as important; due within 3 days or overdue counts as urgent")}>
  <div class="cols" aria-hidden="true">
    <span></span><span>{t("緊急", "Urgent")}</span><span>{t("不緊急", "Not urgent")}</span>
  </div>
  <div class="grid">
    <span class="row-label" aria-hidden="true">{t("重要", "Important")}</span>
    {#each quadrants.slice(0, 2) as q (q.key)}{@render quadrant(q)}{/each}
    <span class="row-label" aria-hidden="true">{t("不重要", "Not important")}</span>
    {#each quadrants.slice(2) as q (q.key)}{@render quadrant(q)}{/each}
  </div>
</section>

{#snippet quadrant(q: { key: string; title: string; axis: string; items: Todo[] })}
  <div class="q {q.key}" aria-label="{q.title} ({q.axis})">
    <div class="qhead">
      <span class="qtitle">{q.title}</span>
      <span class="qcount">{q.items.length}</span>
    </div>
    {#each q.items as t (t.id)}
      {@const due = t.due ? rowDue(t.due, today, t.dueTime, store.now) : null}
      <button class="item" onclick={() => onpick(t)} title={t.title}>
        <span class="ititle">{t.title}</span>
        {#if due}<span class="idue {due.tone}">{due.count}</span>{/if}
      </button>
    {:else}
      <span class="none">{t("沒有", "None")}</span>
    {/each}
  </div>
{/snippet}

<style>
  /* 填滿組件的格子；每一格的待辦太多時在格子裡捲動 */
  .matrix {
    height: 100%;
    padding: 10px;
    display: flex;
    flex-direction: column;
  }
  .cols,
  .grid {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
  .grid {
    flex: 1;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .cols {
    flex: none;
    margin-bottom: 6px;
    font-size: calc(11.5px * var(--fs, 1));
    font-weight: 700;
    color: var(--sub);
    text-align: center;
  }
  .row-label {
    writing-mode: vertical-rl;
    display: grid;
    place-items: center;
    font-size: calc(11.5px * var(--fs, 1));
    font-weight: 700;
    color: var(--sub);
    letter-spacing: 0.2em;
  }
  /* 英文側躺著由下往上讀，字距不用拉開 */
  :global(html[lang="en"]) .row-label {
    transform: rotate(180deg);
    letter-spacing: 0.02em;
  }
  .q {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 8px 8px;
    border-radius: 12px;
    background: var(--inner, var(--raised));
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
    font-size: calc(13.5px * var(--fs, 1));
    font-weight: 700;
    color: var(--tone);
  }
  .q.later .qtitle {
    color: var(--sub);
  }
  .qcount {
    margin-left: auto;
    font-size: calc(12px * var(--fs, 1));
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
    font-size: calc(13px * var(--fs, 1));
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
    font-size: calc(11.5px * var(--fs, 1));
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .idue.warn {
    color: var(--warn);
  }
  .idue.soon {
    color: var(--accent);
  }
  .none {
    padding: 4px 6px;
    font-size: calc(12px * var(--fs, 1));
    color: var(--faint);
  }
</style>
