<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { localDate, monthDay, relativeDue, rowDue } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import { ui } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";

  /** 清單上的一筆：左邊勾選，點其他地方打開詳情 */
  let { todo, today }: { todo: Todo; today: string } = $props();

  /** 勾選後先播完打勾動畫，再真的標記完成 */
  let checking = $state(false);

  const sending = $derived(todo.id.startsWith("tmp-"));
  const high = $derived(todo.priority === "high" && !todo.done);
  const low = $derived(todo.priority === "low" && !todo.done);
  const due = $derived(!todo.done && todo.due ? rowDue(todo.due, today, todo.dueTime, store.now) : null);
  const checked = $derived(todo.done || checking);
  const next = $derived(todo.done ? undefined : store.nextOf.get(todo.id));
  /** 前一步還沒完成（標籤頁、搜尋時才看得到） */
  const waitingFor = $derived(store.waiting.has(todo.id) ? store.prevOf(todo) : undefined);
  const doneOn = $derived(todo.done && todo.doneAt ? monthDay(localDate(todo.doneAt) ?? today, today) : "");
  const hasMeta = $derived(high || low || todo.tags.length > 0 || todo.source === "email" || (!!todo.note && !todo.done) || !!doneOn || !!waitingFor);

  function toggle() {
    if (sending || checking) return;
    if (todo.done) {
      store.reopen(todo);
      return;
    }
    checking = true;
    setTimeout(() => store.complete(todo), 380);
    // 送出失敗、項目被復原時，把打勾狀態還原
    setTimeout(() => (checking = false), 2000);
  }
</script>

<div class="item" class:done={todo.done} class:sending class:low class:waiting={!!waitingFor} data-row={todo.id}>
  <button
    class="chk"
    onclick={toggle}
    disabled={sending}
    aria-label={todo.done ? t(`標記「${todo.title}」為未完成`, `Mark "${todo.title}" as not done`) : t(`完成「${todo.title}」`, `Complete "${todo.title}"`)}
  >
    <span class="ring" class:hi={high && !checked} class:on={checked}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path class="ck" d="M3 8.4l3.2 3.1L13 4.6" />
      </svg>
    </span>
  </button>
  <button class="body" onclick={() => ui.openTodo(todo.id)} disabled={sending}>
    <span class="text">
      <span class="title" class:struck={checked}>{todo.title}</span>
      {#if hasMeta}
        <span class="meta">
          {#if waitingFor}<span class="mi"><Icon name="link" size={13} />{t(`等「${waitingFor.title}」完成`, `After "${waitingFor.title}"`)}</span>{/if}
          {#if doneOn}<span>{t(`${doneOn} 完成`, `Done ${doneOn}`)}</span>{/if}
          {#if high}<span class="mi warn"><Icon name="flag" size={13} stroke={1.8} />{t("高優先", "High")}</span>{/if}
          {#if low}<span class="mi">{t("低優先", "Low")}</span>{/if}
          {#each todo.tags as tag (tag)}<span class="mi clip">#{tag}</span>{/each}
          {#if todo.source === "email"}<span class="mi"><Icon name="mail" size={13} />Gmail</span>{/if}
          {#if todo.note && !todo.done}<span class="mi"><Icon name="note" size={13} />{t("備註", "Note")}</span>{/if}
        </span>
      {/if}
      {#if next}
        <span class="next clip">↳ {t("接著：", "Next: ")}{next.title}{next.due ? ` · ${relativeDue(next.due, today, next.dueTime)}` : ""}</span>
      {/if}
    </span>
    {#if due}
      <span class="due {due.tone}">
        <span class="count">{due.count}</span>
        {#if due.date}<span class="date">{due.date}</span>{/if}
      </span>
    {/if}
  </button>
</div>

<style>
  .item {
    display: flex;
    align-items: flex-start;
    min-height: 64px;
    padding: 0 12px 0 4px;
  }
  .item.sending {
    opacity: 0.55;
  }
  .chk {
    flex: none;
    width: 48px;
    height: 56px;
    display: grid;
    place-items: center;
  }
  .ring {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--ring);
    display: grid;
    place-items: center;
    transition: background 0.18s, border-color 0.18s;
  }
  .ring.hi {
    border-color: var(--warn);
  }
  .ring .ck {
    stroke: transparent;
    stroke-dasharray: 16;
    stroke-dashoffset: 16;
    transition: stroke-dashoffset 0.25s ease;
  }
  .ring.on {
    background: var(--accent);
    border-color: var(--accent);
    animation: pop 0.3s ease;
  }
  .item.done .ring.on {
    background: var(--faint);
    border-color: var(--faint);
    animation: none;
  }
  .ring.on .ck {
    stroke: var(--bg);
    stroke-dashoffset: 0;
  }
  .item.waiting .ring {
    border-style: dashed;
  }
  @keyframes pop {
    50% {
      transform: scale(1.18);
    }
  }
  .body {
    flex: 1;
    min-width: 0;
    min-height: 64px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    text-align: left;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .title {
    font-size: 16px;
    line-height: 1.4;
    word-break: break-word;
    transition: color 0.2s;
  }
  .title.struck {
    color: var(--faint);
    text-decoration: line-through;
  }
  .item.low .title,
  .item.waiting .title {
    color: var(--sub);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    font-size: 13px;
    color: var(--sub);
  }
  .mi {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
  }
  .mi.warn {
    color: var(--warn);
  }
  .next {
    font-size: 13px;
    color: var(--faint);
  }
  .due {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    white-space: nowrap;
  }
  .count {
    font-size: 13px;
    font-weight: 700;
    color: var(--sub);
  }
  .date {
    font-size: 12px;
    color: var(--sub);
  }
  .due.soon .count {
    color: var(--accent);
  }
  .due.warn .count {
    color: var(--warn);
  }
</style>
