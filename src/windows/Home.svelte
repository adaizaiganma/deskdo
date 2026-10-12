<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { countdowns, resolve } from "@deskdo/core/countdowns.svelte";
  import { addDays, diffDays, monthDay, weekday } from "@deskdo/core/dates";
  import { dailyQuote } from "@deskdo/core/saying.svelte";
  import { store } from "@deskdo/core/store.svelte";
  import { toast } from "@deskdo/core/toast.svelte";
  import Fab from "../components/Fab.svelte";
  import Icon from "../components/Icon.svelte";
  import TodoGroups from "../components/TodoGroups.svelte";
  import TodoItem from "../components/TodoItem.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { closeOnBack } from "../lib/back.svelte";
  import { quadrants, type QuadrantKey } from "../lib/matrix";
  import { ui } from "../lib/ui.svelte";
  import SyncStatus from "./SyncStatus.svelte";

  /** 主頁：日期、每日一言、釘選的倒數日、四象限，以及今天、明天到期的待辦 */
  interface Props {
    today: string;
    /** 頁面最上方的提示（有新版本等） */
    top?: Snippet;
    onmenu: () => void;
    onsearch: () => void;
    onall: () => void;
    oncountdowns: () => void;
  }
  let { today, top, onmenu, onsearch, onall, oncountdowns }: Props = $props();

  const quote = dailyQuote(() => today);
  const refreshQuote = () => quote.refresh().catch(() => toast.error("換不了句子，請檢查網路"));
  const tomorrow = $derived(addDays(today, 1));
  const late = $derived(store.open.filter((t) => t.due && t.due < today).length);
  const dueToday = $derived(store.open.filter((t) => t.due === today).length);
  /** 逾期、今天、明天到期的 */
  const soon = $derived(store.open.filter((t) => t.due && t.due <= tomorrow));
  /** 接下來 7 天（不含今天、明天）到期的 */
  const week = $derived(store.open.filter((t) => t.due && t.due > tomorrow && diffDays(today, t.due) <= 7).length);

  /** 釘選在主頁的倒數日：還沒到的（越近越前面），接著是已經過了的 */
  const pinned = $derived(
    countdowns.list
      .filter((c) => c.pinned !== false)
      .map((c) => resolve(c, today))
      .sort((a, b) => ((a.n >= 0) !== (b.n >= 0) ? (a.n >= 0 ? -1 : 1) : Math.abs(a.n) - Math.abs(b.n))),
  );

  const quads = $derived(quadrants(store.open, today));
  let openQ = $state<QuadrantKey | null>(null);
  const shown = $derived(quads.find((q) => q.key === openQ));
  closeOnBack("quadrant", () => !!openQ, () => (openQ = null));
</script>

<div class="page">
  <TopBar lead="menu" onlead={onmenu}>
    <span></span>
    {#snippet actions()}
      <button class="icon-btn" onclick={onsearch} aria-label="搜尋"><Icon name="search" size={24} /></button>
      <SyncStatus />
    {/snippet}
  </TopBar>

  <div class="scroll">
    <div class="when">
      <span class="year">{Number(today.slice(0, 4))}年 · {weekday(today)}</span>
      <h1>{Number(today.slice(5, 7))}月{Number(today.slice(8))}日</h1>
      <p class="summary">
        {#if late}<span class="warn">逾期 <b>{late}</b> 項</span> · {/if}
        {#if dueToday}今天到期 <b class="warn">{dueToday}</b> 項 · {/if}
        共 <b>{store.open.length}</b> 項待辦
      </p>
    </div>

    {@render top?.()}

    <button class="card quote" class:loading={quote.loading} onclick={refreshQuote} aria-label="每日一言：{quote.current.text}（{quote.current.source}），點一下換一句">
      <span class="qcap"><span class="clip">每日一言 · {quote.current.source}</span><Icon name="refresh" size={14} /></span>
      <span class="qtext">{quote.current.text}</span>
    </button>

    {#if pinned.length}
      <div class="cds" aria-label="倒數日">
        {#each pinned as c (c.id)}
          <button class="card cd" onclick={oncountdowns}>
            <span class="cd-title clip">{c.title}</span>
            {#if c.n === 0}
              <span class="cd-num"><b class="now">就是今天</b></span>
            {:else}
              <span class="cd-num"><small>{c.n > 0 ? "還有" : "已經"}</small><b class:past={c.n < 0}>{Math.abs(c.n)}</b><small>天</small></span>
            {/if}
            <span class="cd-date">{monthDay(c.target, today)} {weekday(c.target)}{c.yearly ? " · 每年" : ""}</span>
          </button>
        {/each}
      </div>
    {/if}

    <section class="card matrix" aria-label="四象限">
      <div class="mhead">
        <span class="mtitle">四象限</span>
        <span class="maxis">重要 × 緊急</span>
      </div>
      <div class="mgrid">
        {#each quads as q (q.key)}
          <button class="tile" onclick={() => (openQ = q.key)} aria-haspopup="dialog" aria-label="{q.title}，{q.items.length} 項">
            <span class="trow">
              <span class="tname"><span class="dot {q.key}"></span>{q.title}</span>
              <span class="tcount">{q.items.length}</span>
            </span>
            <span class="tpeek clip">{q.items.length ? q.items.slice(0, 3).map((t) => t.title).join(" · ") : "沒有"}</span>
          </button>
        {/each}
      </div>
    </section>

    <TodoGroups todos={soon} {today} emptyText="今天和明天沒有到期的待辦" />

    <button class="more" onclick={onall}>
      <span>{week ? `接下來 7 天還有 ${week} 項` : `查看全部 ${store.open.length} 項待辦`}</span>
      <Icon name="chevron" size={20} />
    </button>
  </div>

  <Fab aria="新增待辦" onclick={() => ui.add()} />
</div>

{#if shown}
  <div class="dlg-layer">
    <button class="scrim" onclick={() => (openQ = null)} aria-label="關閉" transition:fade={{ duration: 180 }}></button>
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="qtitle" transition:scale={{ start: 0.92, duration: 200 }}>
      <header class="dhead">
        <div class="dtext">
          <h2 id="qtitle"><span class="dot big {shown.key}"></span>{shown.title}<span class="dcount">{shown.items.length}</span></h2>
          <span class="daxis">{shown.axis}</span>
        </div>
        <button class="icon-btn" onclick={() => (openQ = null)} aria-label="關閉"><Icon name="close" size={22} /></button>
      </header>
      <div class="dlist">
        {#each shown.items as t (t.id)}
          <TodoItem todo={t} {today} />
        {:else}
          <p class="dnone">這一格沒有待辦</p>
        {/each}
      </div>
      <footer class="dfoot">
        <button class="text-btn" onclick={() => ((openQ = null), onall())}>在「全部」查看</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .page {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 96px;
  }
  .when {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 20px 8px;
  }
  .year {
    font-size: 14px;
    color: var(--sub);
  }
  h1 {
    margin: 0;
    font-size: 44px;
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.5px;
  }
  .summary {
    margin: 0;
    font-size: 14px;
    color: var(--sub);
  }
  .summary b {
    color: var(--text);
  }
  .summary .warn,
  .summary b.warn,
  .summary .warn b {
    color: var(--warn);
  }
  .card {
    border-radius: 20px;
    background: var(--c);
  }
  .quote {
    width: calc(100% - 32px);
    margin: 12px 16px 0;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
  }
  .quote:active {
    filter: brightness(1.08);
  }
  .qcap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    color: var(--sub);
  }
  .qcap :global(svg) {
    flex: none;
    color: var(--faint);
  }
  .loading .qcap :global(svg) {
    animation: spin 0.8s linear infinite;
  }
  .qtext {
    font-size: 17px;
    font-weight: 500;
    line-height: 1.6;
    transition: opacity 0.2s;
  }
  .loading .qtext {
    opacity: 0.5;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .cds {
    display: flex;
    gap: 10px;
    padding: 12px 16px 0;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: 16px;
  }
  .cd {
    flex: none;
    width: 150px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    scroll-snap-align: start;
  }
  .cd-title {
    font-size: 13px;
    color: var(--sub);
  }
  .cd-num {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .cd-num b {
    font-size: 30px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--accent);
  }
  .cd-num b.past {
    color: var(--text);
  }
  .cd-num b.now {
    font-size: 22px;
    color: var(--warn);
  }
  .cd-num small,
  .cd-date {
    font-size: 12px;
    color: var(--sub);
  }
  .matrix {
    margin: 12px 16px 0;
    padding: 14px 12px 12px;
  }
  .mhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 10px;
  }
  .mtitle {
    font-size: 14px;
    font-weight: 700;
  }
  .maxis {
    font-size: 12px;
    color: var(--sub);
  }
  .mgrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .tile {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--c-high);
    text-align: left;
  }
  .tile:active {
    filter: brightness(1.08);
  }
  .trow {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tname {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
  }
  .tcount {
    font-size: 20px;
    font-weight: 700;
  }
  .tpeek {
    font-size: 12px;
    color: var(--sub);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.big {
    width: 10px;
    height: 10px;
  }
  .dot.do {
    background: var(--warn);
  }
  .dot.plan {
    background: var(--accent);
  }
  .dot.quick {
    background: var(--yellow);
  }
  .dot.later {
    background: var(--faint);
  }
  .more {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: calc(100% - 32px);
    height: 48px;
    margin: 8px 16px 0;
    padding: 0 12px 0 16px;
    border-radius: 24px;
    background: var(--c);
    font-size: 14px;
    color: var(--text);
  }
  .more :global(svg) {
    color: var(--sub);
  }

  .dlg-layer {
    position: fixed;
    inset: 0;
    z-index: 35;
    display: grid;
    place-items: center;
    padding: 24px 20px calc(24px + var(--nav-inset));
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
  }
  .dlg {
    position: relative;
    width: 100%;
    max-width: 480px;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 28px;
    background: var(--c-high);
    box-shadow: var(--pop-shadow);
    overflow: hidden;
  }
  .dhead {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 20px 8px 8px 24px;
  }
  .dtext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h2 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 22px;
    font-weight: 500;
  }
  .dcount {
    font-size: 15px;
    color: var(--sub);
  }
  .daxis {
    font-size: 13px;
    color: var(--sub);
  }
  .dlist {
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 4px;
  }
  .dnone {
    margin: 0;
    padding: 24px;
    text-align: center;
    font-size: 14px;
    color: var(--sub);
  }
  .dfoot {
    display: flex;
    justify-content: flex-end;
    padding: 8px 16px 16px;
    border-top: 1px solid var(--c-highest);
  }
</style>
