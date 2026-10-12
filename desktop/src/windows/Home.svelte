<script lang="ts">
  import type { Snippet } from "svelte";
  import Clock from "../components/Clock.svelte";
  import CountdownCard from "../components/CountdownCard.svelte";
  import DashGrid from "../components/DashGrid.svelte";
  import Icon from "../components/Icon.svelte";
  import Matrix from "../components/Matrix.svelte";
  import TodoPanel from "../components/TodoPanel.svelte";
  import { weekday } from "@deskdo/core/dates";
  import { countdowns } from "@deskdo/core/countdowns.svelte";
  import { BASE, countdownId, homeLayout, isCountdown, spec, type WidgetId } from "../lib/homeLayout.svelte";
  import { homePrefs } from "@deskdo/core/homePrefs.svelte";
  import { dailyQuote } from "@deskdo/core/saying.svelte";
  import { store } from "@deskdo/core/store.svelte";
  import { toast } from "@deskdo/core/toast.svelte";
  import type { Todo } from "@deskdo/core/types";

  interface Props {
    today: string;
    matches: (t: Todo) => boolean;
    /** 頁面最上方的提示（有新版本等） */
    top?: Snippet;
    oncountdowns: () => void;
  }
  let { today, matches, top, oncountdowns }: Props = $props();

  let panel = $state<ReturnType<typeof TodoPanel>>();
  export function focus() {
    panel?.focus();
  }

  /** 調整版面：拖曳移動、調整大小、拿掉或加回組件（從右鍵選單進入） */
  let editing = $state(false);

  // ---- 左半的右鍵選單：調整版面、拿掉這個組件、加回組件、還原預設 ----
  let menu = $state<{ x: number; y: number; id: WidgetId | null } | null>(null);
  /** 可以加回來的：拿掉的組件，和還沒加到主頁的倒數日 */
  const addable = $derived<{ id: WidgetId; label: string }[]>([
    ...homeLayout.hidden.map((id) => ({ id, label: BASE[id].label })),
    ...countdowns.list.filter((c) => c.pinned === false).map((c) => ({ id: `cd:${c.id}` as const, label: c.title })),
  ]);

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-widget]");
    menu = { x: e.clientX, y: e.clientY, id: (cell?.dataset.widget as WidgetId | undefined) ?? null };
  }

  function act(fn: () => void) {
    fn();
    menu = null;
  }

  /** 選單別超出視窗 */
  function place(node: HTMLElement) {
    const r = node.getBoundingClientRect();
    if (r.right > innerWidth - 8) node.style.left = `${Math.max(8, innerWidth - 8 - r.width)}px`;
    if (r.bottom > innerHeight - 8) node.style.top = `${Math.max(8, innerHeight - 8 - r.height)}px`;
    node.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (menu) menu = null;
    else if (editing) editing = false;
  }

  function onWindowDown(e: PointerEvent) {
    if (menu && !(e.target as HTMLElement).closest(".ctx")) menu = null;
  }

  const quote = dailyQuote(() => today);
  const refreshQuote = () => quote.refresh().catch(() => toast.error("換不了句子，請檢查網路"));
  const late = $derived(store.open.filter((t) => t.due && t.due < today).length);
  const dueToday = $derived(store.open.filter((t) => t.due === today).length);
  const summary = $derived(
    [late && `${late} 項逾期`, dueToday && `今天到期 ${dueToday} 項`, `共 ${store.open.length} 項待辦`].filter(Boolean).join("・"),
  );

  // ---- 右邊待辦的寬度：拖曳中間的分隔線調整，每台電腦各自記住 ----
  const WIDTH_KEY = "home.panelWidth";
  const DEFAULT_WIDTH = 400;
  let width = $state(readWidth());
  let resizing = $state(false);

  function readWidth(): number {
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      return w >= 280 ? w : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  }

  function saveWidth() {
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {}
  }

  let panelEl = $state<HTMLElement>();
  function startResize(e: PointerEvent) {
    if (e.button !== 0 || !panelEl) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    // 從畫面上實際的寬度開始（視窗變窄時可能被 CSS 壓小了）
    const startX = e.clientX;
    const startW = panelEl.getBoundingClientRect().width;
    resizing = true;
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      width = Math.max(280, startW + startX - ev.clientX);
    };
    const up = () => {
      resizing = false;
      // 只是點一下沒有拖，不要把被視窗壓小的寬度存起來
      if (moved && panelEl) {
        width = panelEl.getBoundingClientRect().width;
        saveWidth();
      }
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  function resizeKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 60 : 20;
    if (e.key === "ArrowLeft") width += step;
    else if (e.key === "ArrowRight") width = Math.max(280, width - step);
    else return;
    e.preventDefault();
    saveWidth();
  }
</script>

{#snippet widget(id: WidgetId)}
  {#if id === "date"}
    <div class="when">
      <span class="year">{Number(today.slice(0, 4))}年・{weekday(today)}</span>
      <h1>{Number(today.slice(5, 7))}月{Number(today.slice(8))}日</h1>
      <span class="summary" class:warn={late > 0} title={summary}>{summary}</span>
    </div>
  {:else if id === "clock"}
    <div class="clock-box"><Clock size={120} mode={homePrefs.clock} /></div>
  {:else if id === "quote"}
    <button class="quote" class:loading={quote.loading} onclick={refreshQuote} title="換一句">
      <span class="qcap"><span class="qlabel">每日一言</span>{quote.current.source}<Icon name="refresh" size={12} /></span>
      <span class="qtext">{quote.current.text}</span>
    </button>
  {:else if id === "matrix"}
    <Matrix {today} {matches} onpick={(t) => (store.focus = t.id)} />
  {:else if isCountdown(id)}
    <CountdownCard id={countdownId(id)} {today} onopen={oncountdowns} />
  {/if}
{/snippet}

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowDown} onblur={() => (menu = null)} />

<!-- 外層是 container，下面才能依自己的寬度切換排版 -->
<div class="wrap">
<div class="home" class:resizing>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="left" oncontextmenu={openMenu} onscroll={() => (menu = null)}>
    {@render top?.()}
    <DashGrid {editing} content={widget} />
    {#if editing}
      <!-- 浮在下面，不佔版面 -->
      <div class="edit-dock">
        <div class="edit-bar">
          <span>拖曳移動・拖右下角調整大小・按右鍵加回組件</span>
          <button class="done" onclick={() => (editing = false)}>完成</button>
        </div>
      </div>
    {/if}
  </div>

  <!-- 可以聚焦的分隔線（ARIA 的 window splitter）：拖曳或用方向鍵調整寬度 -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label="調整待辦清單的寬度"
    aria-valuenow={Math.round(width)}
    tabindex="0"
    onpointerdown={startResize}
    ondblclick={() => ((width = DEFAULT_WIDTH), saveWidth())}
    onkeydown={resizeKey}
    title="拖曳調整寬度，按兩下還原"
  ></div>

  <section class="panel" bind:this={panelEl} style:--w="{width}px">
    <header>
      <h2>待辦事項</h2>
    </header>
    <TodoPanel bind:this={panel} doneKey="home.showDone" {matches} />
  </section>
</div>
</div>

{#if menu}
  {@const m = menu}
  <div class="ctx" role="menu" aria-label="主頁版面" style:left="{m.x}px" style:top="{m.y}px" use:place>
    {#if m.id}
      <div class="mhead">{spec(m.id).label}</div>
    {/if}
    <button role="menuitem" onclick={() => act(() => (editing = !editing))}>
      <Icon name="widget" size={14} />{editing ? "完成調整" : "調整版面"}
    </button>
    {#if m.id}
      {@const id = m.id}
      <button role="menuitem" onclick={() => act(() => homeLayout.remove(id))}>
        <Icon name="close" size={14} />{isCountdown(id) ? "從主頁拿掉" : "拿掉這個組件"}
      </button>
    {/if}
    {#if addable.length}
      <div class="sep"></div>
      <div class="mhead">加回組件</div>
      {#each addable as a (a.id)}
        <button role="menuitem" onclick={() => act(() => homeLayout.add(a.id))}>
          <Icon name={isCountdown(a.id) ? "hourglass" : "plus"} size={14} /><span class="clip">{a.label}</span>
        </button>
      {/each}
    {/if}
    <div class="sep"></div>
    <button role="menuitem" onclick={() => act(() => homeLayout.reset())}><Icon name="refresh" size={14} />還原預設版面</button>
  </div>
{/if}

<style>
  .wrap {
    height: 100%;
    container-type: inline-size;
  }
  .home {
    height: 100%;
    display: flex;
  }
  .home.resizing {
    cursor: col-resize;
    user-select: none;
  }
  .left {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 28px 24px 40px 32px;
  }
  /* 調整版面時浮在左半下方的提示列 */
  .edit-dock {
    position: sticky;
    bottom: 16px;
    margin-top: 20px;
    display: flex;
    justify-content: center;
    z-index: 6;
    pointer-events: none;
  }
  .edit-bar {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 6px 16px;
    border-radius: 999px;
    background: var(--raised);
    box-shadow: var(--pop-shadow);
    font-size: 12.5px;
    color: var(--sub);
    white-space: nowrap;
  }
  .done {
    height: 30px;
    padding: 0 16px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 12.5px;
    font-weight: 500;
  }

  .ctx {
    position: fixed;
    z-index: 50;
    width: 200px;
    padding: 5px;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--pop-shadow);
  }
  .ctx button {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 6px;
    font-size: 13px;
    text-align: left;
    color: var(--text);
  }
  .ctx button:hover,
  .ctx button:focus-visible {
    background: var(--hover);
    outline: none;
  }
  .ctx :global(svg) {
    flex: none;
    color: var(--sub);
  }
  .mhead {
    padding: 6px 10px 4px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 日期和一言的字是固定大小，不跟著組件縮放；放不下就截斷或捲動 */
  .when {
    height: 100%;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .year {
    font-size: 14px;
    font-weight: 500;
    color: var(--sub);
  }
  h1 {
    margin: 0;
    white-space: nowrap;
    font-size: 44px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: 0.01em;
  }
  .summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--sub);
  }
  .summary.warn {
    color: var(--warn);
  }

  /* 時鐘是圖，跟著組件的大小縮放 */
  .clock-box {
    height: 100%;
    display: grid;
    place-items: center;
  }
  .clock-box :global(.clock) {
    width: min(100cqw, calc(100cqh - 36px));
    height: auto;
  }
  .clock-box :global(.digital .hm) {
    font-size: clamp(24px, min(24cqw, 70cqh), 80px);
  }
  .quote {
    width: 100%;
    height: 100%;
    margin: 0;
    text-align: left;
    box-sizing: border-box;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--bg2);
  }
  .qcap {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: var(--faint);
  }
  .qcap :global(svg) {
    margin-left: auto;
    flex: none;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .quote:hover .qcap :global(svg),
  .quote:focus-visible .qcap :global(svg),
  .loading .qcap :global(svg) {
    opacity: 1;
  }
  .loading .qcap :global(svg) {
    animation: spin 0.8s linear infinite;
  }
  .qlabel {
    font-weight: 700;
    color: var(--sub);
    letter-spacing: 0.04em;
  }
  .qtext {
    font-size: 15px;
    font-weight: 500;
    line-height: 1.5;
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

  .resizer {
    flex: none;
    width: 10px;
    margin: 12px -3px;
    cursor: col-resize;
    position: relative;
    z-index: 2;
    outline: none;
  }
  .resizer::after {
    content: "";
    position: absolute;
    left: 4px;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 2px;
    background: transparent;
    transition: background 0.15s;
  }
  .resizer:hover::after,
  .resizer:focus-visible::after,
  .resizing .resizer::after {
    background: var(--accent);
  }

  .panel {
    flex: none;
    /* 左邊至少留 420px 給日期和矩陣 */
    width: min(var(--w), calc(100% - 420px));
    min-width: 280px;
    margin: 12px 12px 12px 0;
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    background: var(--raised);
    box-shadow: var(--card-shadow);
    overflow: hidden;
  }
  .panel header {
    padding: 14px 18px 10px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }

  /* 太窄：改成上下排，待辦清單放在下面 */
  @container (max-width: 720px) {
    .home {
      flex-direction: column;
      overflow-y: auto;
    }
    .left {
      flex: none;
      overflow: visible;
      padding: 20px 20px 8px;
    }
    .resizer {
      display: none;
    }
    .panel {
      width: auto;
      min-width: 0;
      margin: 8px 12px 16px;
      flex: none;
    }
  }
</style>
