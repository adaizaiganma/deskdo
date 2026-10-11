<script lang="ts">
  import type { Snippet } from "svelte";
  import { bottomOf, clampBox, compact, GAP, homeLayout, span, spec, STEP, type Box, type WidgetId } from "../lib/homeLayout.svelte";
  import Icon from "./Icon.svelte";

  /**
   * 主頁左半的組件格子。格子大小固定，寬度放得下幾欄就幾欄。
   * editing 時可以拖曳組件移動、拖右下角調整大小、拿掉組件；其他組件會自動讓開並往上靠攏。
   */
  interface Props {
    editing: boolean;
    content: Snippet<[WidgetId]>;
  }
  let { editing, content }: Props = $props();

  /** 外框的寬度（含左右各 8px 的 padding） */
  let width = $state(0);
  const cols = $derived(Math.max(1, Math.floor((width - 16 + GAP) / STEP)));
  $effect(() => {
    if (width) homeLayout.cols = cols;
  });

  /** 拖曳中：組件跟著指標走，其他組件照 layout 讓開，虛線框是放開後的位置 */
  let drag = $state<{ id: WidgetId; mode: "move" | "resize"; orig: Box; dx: number; dy: number; layout: Box[] } | null>(null);
  const shown = $derived(homeLayout.items);
  const items = $derived(drag ? drag.layout : shown);
  const height = $derived(Math.max(0, span(bottomOf(items))));
  /** 最小尺寸比視窗還寬的時候，讓格子可以橫向捲動 */
  const minWidth = $derived(Math.max(0, span(items.reduce((n, b) => Math.max(n, b.x + b.w), 0))));

  function rect(b: Box) {
    return { left: b.x * STEP, top: b.y * STEP, width: span(b.w), height: span(b.h) };
  }

  /** 拖曳中的組件畫在指標的位置（不對齊格子） */
  function floating(b: Box) {
    const r = rect(drag!.orig);
    if (drag!.mode === "move") return { ...r, left: r.left + drag!.dx, top: r.top + drag!.dy };
    const min = spec(b.id);
    return { ...r, width: Math.max(span(min.minW), r.width + drag!.dx), height: Math.max(span(min.minH), r.height + drag!.dy) };
  }

  /** 移動或調整大小後的位置，不超出右邊 */
  function moved(b: Box, mode: "move" | "resize", dx: number, dy: number): Box {
    if (mode === "resize") {
      const next = clampBox({ ...b, w: b.w + dx, h: b.h + dy });
      return { ...next, w: Math.max(spec(b.id).minW, Math.min(next.w, cols - b.x)) };
    }
    const next = clampBox({ ...b, x: b.x + dx, y: b.y + dy });
    return { ...next, x: Math.max(0, Math.min(next.x, cols - next.w)) };
  }

  function start(e: PointerEvent, b: Box, mode: "move" | "resize") {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const base = shown;
    drag = { id: b.id, mode, orig: b, dx: 0, dy: 0, layout: base };
    const move = (ev: PointerEvent) => {
      if (!drag) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const next = moved(b, mode, Math.round(dx / STEP), Math.round(dy / STEP));
      drag = { ...drag, dx, dy, layout: compact(base.map((x) => (x.id === b.id ? next : x)), b.id) };
    };
    const end = () => {
      if (drag) homeLayout.set(drag.layout);
      drag = null;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  /** 鍵盤：方向鍵移動，Shift + 方向鍵調整大小 */
  function key(e: KeyboardEvent, b: Box) {
    if (!editing) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = moved(b, e.shiftKey ? "resize" : "move", d[0], d[1]);
    homeLayout.set(compact(shown.map((x) => (x.id === b.id ? next : x)), b.id));
  }
</script>

<div class="scroller" bind:clientWidth={width}>
<div class="grid" class:editing class:dragging={!!drag} style:height="{height}px" style:min-width="{minWidth}px">
  {#each items as b (b.id)}
    {@const lifted = drag?.id === b.id}
    {@const r = lifted ? floating(b) : rect(b)}
    {#if lifted}
      {@const slot = rect(b)}
      <div class="slot" style:left="{slot.left}px" style:top="{slot.top}px" style:width="{slot.width}px" style:height="{slot.height}px"></div>
    {/if}
    <!-- 編輯時整個組件可以拖曳；鍵盤用方向鍵 -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
    <div
      class="cell"
      data-widget={b.id}
      class:lifted
      style:left="{r.left}px"
      style:top="{r.top}px"
      style:width="{r.width}px"
      style:height="{r.height}px"
      tabindex={editing ? 0 : undefined}
      role={editing ? "group" : undefined}
      aria-label={editing ? `${spec(b.id).label}：拖曳移動，方向鍵移動，Shift 加方向鍵調整大小` : undefined}
      onpointerdown={(e) => start(e, b, "move")}
      onkeydown={(e) => key(e, b)}
    >
      <div class="content">{@render content(b.id)}</div>
      {#if editing}
        <span class="name">{spec(b.id).label}</span>
        <button class="remove" onpointerdown={(e) => e.stopPropagation()} onclick={() => homeLayout.remove(b.id)} aria-label="拿掉「{spec(b.id).label}」" title="拿掉">
          <Icon name="close" size={12} stroke={2} />
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="resize" onpointerdown={(e) => start(e, b, "resize")} title="拖曳調整大小"></span>
      {/if}
    </div>
  {/each}
</div>
</div>

<style>
  .scroller {
    overflow-x: auto;
    /* 編輯時的名稱標籤和 × 按鈕會超出組件一點 */
    padding: 14px 8px 8px;
    margin: -14px -8px -8px;
  }
  .grid {
    position: relative;
    min-height: 120px;
  }
  .cell {
    position: absolute;
    box-sizing: border-box;
    container-type: size;
    border-radius: 12px;
    transition:
      left 0.18s ease,
      top 0.18s ease,
      width 0.18s ease,
      height 0.18s ease;
  }
  .content {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .editing .cell {
    cursor: grab;
    touch-action: none;
    outline: 1.5px dashed var(--ring);
    outline-offset: 4px;
  }
  .editing .cell:hover,
  .editing .cell:focus-visible {
    outline-color: var(--accent);
  }
  /* 編輯時組件裡的按鈕不能按，整塊都拿來拖曳 */
  .editing .content {
    pointer-events: none;
    user-select: none;
  }
  .cell.lifted {
    z-index: 5;
    transition: none;
    cursor: grabbing;
    outline-color: var(--accent);
    opacity: 0.9;
  }
  .slot {
    position: absolute;
    border-radius: 12px;
    background: var(--accent-soft);
    border: 1.5px dashed var(--accent);
    box-sizing: border-box;
    transition:
      left 0.12s ease,
      top 0.12s ease,
      width 0.12s ease,
      height 0.12s ease;
  }
  .name {
    position: absolute;
    left: 6px;
    top: -14px;
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--raised);
    box-shadow: 0 0 0 1px var(--line);
    font-size: 11px;
    color: var(--sub);
    pointer-events: none;
  }
  .remove {
    position: absolute;
    right: -8px;
    top: -8px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--raised);
    box-shadow: var(--card-shadow);
    color: var(--sub);
    cursor: pointer;
  }
  .remove:hover {
    color: var(--warn);
  }
  .resize {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
    touch-action: none;
  }
  .resize::after {
    content: "";
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--accent);
    border-bottom: 2px solid var(--accent);
    border-bottom-right-radius: 3px;
  }
</style>
