<script lang="ts">
  import type { Snippet } from "svelte";
  import Clock from "../components/Clock.svelte";
  import CountdownStrip from "../components/CountdownStrip.svelte";
  import Matrix from "../components/Matrix.svelte";
  import TodoPanel from "../components/TodoPanel.svelte";
  import { weekday } from "../lib/dates";
  import { homePrefs } from "../lib/homePrefs.svelte";
  import { quoteOf } from "../lib/quotes";
  import { store } from "../lib/store.svelte";
  import type { Todo } from "../lib/types";

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

  const quote = $derived(quoteOf(today));
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

<!-- 外層是 container，下面才能依自己的寬度切換排版 -->
<div class="wrap">
<div class="home" class:resizing>
  <div class="left">
    {@render top?.()}
    <div class="hero">
      <div class="when">
        <span class="year">{Number(today.slice(0, 4))}年・{weekday(today)}</span>
        <h1>{Number(today.slice(5, 7))}月{Number(today.slice(8))}日</h1>
        <span class="summary" class:warn={late > 0}>{summary}</span>
      </div>
      <Clock size={120} mode={homePrefs.clock} />
    </div>
    <figure class="quote">
      <span class="qlabel">每日一言</span>
      <blockquote>{quote.text}</blockquote>
      <figcaption>— {quote.source}</figcaption>
    </figure>
    <Matrix {today} {matches} onpick={(t) => (store.focus = t.id)} />
    <CountdownStrip {today} onopen={oncountdowns} />
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

<style>
  .wrap {
    height: 100%;
    container-type: inline-size;
  }
  /* 手機：主畫面上方有標題列，填滿剩下的高度 */
  :global(html.mobile) .wrap {
    flex: 1;
    min-height: 0;
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
  .hero {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 18px;
  }
  .when {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .year {
    font-size: 14px;
    font-weight: 500;
    color: var(--sub);
  }
  h1 {
    margin: 0;
    white-space: nowrap;
    font-size: 46px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: 0.01em;
  }
  .summary {
    font-size: 13px;
    color: var(--sub);
  }
  .summary.warn {
    color: var(--warn);
  }

  .quote {
    margin: 0 0 20px;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--bg2);
  }
  .qlabel {
    display: block;
    margin-bottom: 4px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--sub);
    letter-spacing: 0.04em;
  }
  blockquote {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    line-height: 1.6;
  }
  figcaption {
    margin-top: 4px;
    font-size: 12px;
    color: var(--faint);
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

  /* 太窄（或手機）：改成上下排，待辦清單放在下面 */
  /* 左邊比較窄時，日期和時鐘縮小一點 */
  @container (max-width: 980px) {
    h1 {
      font-size: 38px;
    }
    .hero :global(.clock) {
      width: 104px;
      height: 104px;
    }
    .hero :global(.digital .hm) {
      font-size: 44px;
    }
  }
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
  :global(html.mobile) .left {
    padding: 4px 16px 8px;
  }
  :global(html.mobile) h1 {
    font-size: 38px;
  }
</style>
