<script lang="ts">
  import type { Snippet } from "svelte";
  import Clock from "../components/Clock.svelte";
  import CountdownCard from "../components/CountdownCard.svelte";
  import DashGrid from "../components/DashGrid.svelte";
  import HomeSettings from "../components/HomeSettings.svelte";
  import Icon from "../components/Icon.svelte";
  import Matrix from "../components/Matrix.svelte";
  import TodoPanel from "../components/TodoPanel.svelte";
  import WidgetSettings from "../components/WidgetSettings.svelte";
  import { weekday } from "@deskdo/core/dates";
  import { countdowns } from "@deskdo/core/countdowns.svelte";
  import { BASE, countdownId, homeLayout, isCountdown, spec, type WidgetId } from "../lib/homeLayout.svelte";
  import { homePrefs } from "@deskdo/core/homePrefs.svelte";
  import { homeStyle } from "../lib/homeStyle.svelte";
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

  // ---- 左半的右鍵選單：組件設定、自訂主頁、調整版面、拿掉這個組件、加回組件、還原預設 ----
  let menu = $state<{ x: number; y: number; id: WidgetId | null } | null>(null);
  /** 從右鍵選單打開的設定小視窗：id 是組件的設定，null 是整個主頁的 */
  let popup = $state<{ x: number; y: number; id: WidgetId | null } | null>(null);
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
  /** 主頁的大小，自訂主頁的預覽照這個比例 */
  let areaW = $state(0);
  let areaH = $state(0);
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
<div class="wrap" class:has-image={!!homeStyle.image} style:--image={homeStyle.image ? `url("${homeStyle.image}")` : null} style:--dim={homeStyle.dim} style:--size={homeStyle.css.size} style:--repeat={homeStyle.css.repeat} style:--pos={homeStyle.css.position} bind:clientWidth={areaW} bind:clientHeight={areaH}>
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

  <section class="panel bg-{homeStyle.panel}" bind:this={panelEl} style:--w="{width}px">
    <!-- 標題按右鍵也可以打開主頁的選單（自訂主頁裡有待辦清單的背景） -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header oncontextmenu={openMenu}>
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
      {@const id = m.id}
      <div class="mhead">{spec(id).label}</div>
      <button role="menuitem" onclick={() => act(() => (popup = { x: m.x, y: m.y, id }))}>
        <Icon name="settings" size={14} />組件設定…
      </button>
    {/if}
    <button role="menuitem" onclick={() => act(() => (popup = { x: m.x, y: m.y, id: null }))}>
      <Icon name="image" size={14} />自訂主頁…
    </button>
    <div class="sep"></div>
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

{#if popup?.id}
  <WidgetSettings id={popup.id} x={popup.x} y={popup.y} onclose={() => (popup = null)} />
{:else if popup}
  <HomeSettings x={popup.x} y={popup.y} area={{ w: areaW, h: areaH }} onclose={() => (popup = null)} />
{/if}

<style>
  .wrap {
    height: 100%;
    position: relative;
    container-type: inline-size;
  }
  /* 背景圖片：上面蓋一層底色淡化（--dim），字比較看得清楚 */
  .wrap.has-image {
    overflow: hidden;
    border-top-left-radius: 9px;
    background: var(--image) var(--pos) / var(--size) var(--repeat);
  }
  .wrap.has-image::before {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--bg);
    opacity: var(--dim);
    pointer-events: none;
  }
  .home {
    position: relative;
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
    /* 捲軸的寬度（10px）一直留著，右邊的 padding 少 10px */
    scrollbar-gutter: stable;
    padding: 28px 14px 40px 32px;
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

  /* 日期和一言的字是固定大小（乘上組件的字體倍數 --fs），不跟著組件縮放；放不下就截斷或捲動 */
  .when {
    height: 100%;
    min-width: 0;
    overflow: hidden;
    padding: 8px 18px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .year {
    font-size: calc(14px * var(--fs, 1));
    font-weight: 500;
    color: var(--sub);
  }
  h1 {
    margin: 0;
    white-space: nowrap;
    /* 組件太窄時縮小到放得下（「10月12日」大約 4.8 個字寬，左右各留 18px） */
    font-size: min(calc(44px * var(--fs, 1)), calc((100cqw - 36px) / 4.8));
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: 0.01em;
  }
  .summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: calc(13px * var(--fs, 1));
    color: var(--sub);
  }
  .summary.warn {
    color: var(--warn);
  }

  /* 時鐘是圖，跟著組件的大小縮放 */
  .clock-box {
    height: 100%;
    padding: 8px;
    display: grid;
    place-items: center;
  }
  .clock-box :global(.clock) {
    width: min(100cqw - 16px, calc(100cqh - 52px));
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
    padding: 10px 18px;
    border-radius: 12px;
  }
  .qcap {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: calc(11.5px * var(--fs, 1));
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
    font-size: calc(15px * var(--fs, 1));
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
    overflow: hidden;
    transition:
      background 0.15s,
      box-shadow 0.15s;
  }
  .panel.bg-solid {
    background: var(--raised);
    box-shadow: var(--card-shadow);
  }
  .panel.bg-glass {
    background: var(--glass);
    box-shadow:
      inset 0 0 0 1px var(--glass-line),
      var(--card-shadow);
    backdrop-filter: blur(18px) saturate(1.4);
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
      scrollbar-gutter: stable;
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
