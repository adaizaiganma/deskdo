<script lang="ts">
  import type { Snippet } from "svelte";
  import { bottomOf, clampBox, COLS, compact, GAP, homeLayout, ROW_HEIGHT, WIDGETS, type Box, type WidgetId } from "../lib/homeLayout.svelte";
  import Icon from "./Icon.svelte";

  /**
   * 主頁左半的組件格子。editing 時可以拖曳組件移動、拖右下角調整大小、拿掉組件；
   * 其他組件會自動讓開並往上靠攏。
   */
  interface Props {
    editing: boolean;
    content: Snippet<[WidgetId]>;
  }
  let { editing, content }: Props = $props();

  let width = $state(0);
  const colW = $derived(Math.max(0, (width - GAP * (COLS - 1)) / COLS));

  /** 拖曳中：組件跟著指標走，其他組件照 layout 讓開，虛線框是放開後的位置 */
  let drag = $state<{ id: WidgetId; mode: "move" | "resize"; orig: Box; dx: number; dy: number; layout: Box[] } | null>(null);
  const items = $derived(drag ? drag.layout : homeLayout.items);
  const height = $derived(Math.max(0, bottomOf(items) * (ROW_HEIGHT + GAP) - GAP));

  function rect(b: Box) {
    return {
      left: b.x * (colW + GAP),
      top: b.y * (ROW_HEIGHT + GAP),
      width: b.w * colW + (b.w - 1) * GAP,
      height: b.h * ROW_HEIGHT + (b.h - 1) * GAP,
    };
  }

  /** 拖曳中的組件畫在指標的位置（不對齊格子） */
  function floating(b: Box) {
    const r = rect(drag!.orig);
    if (drag!.mode === "move") return { ...r, left: r.left + drag!.dx, top: r.top + drag!.dy };
    const min = WIDGETS[b.id];
    return {
      ...r,
      width: Math.max(min.minW * colW + (min.minW - 1) * GAP, r.width + drag!.dx),
      height: Math.max(min.minH * ROW_HEIGHT + (min.minH - 1) * GAP, r.height + drag!.dy),
    };
  }

  function start(e: PointerEvent, b: Box, mode: "move" | "resize") {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    drag = { id: b.id, mode, orig: b, dx: 0, dy: 0, layout: homeLayout.items };
    const stepX = colW + GAP;
    const stepY = ROW_HEIGHT + GAP;
    const move = (ev: PointerEvent) => {
      if (!drag) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const next =
        mode === "move"
          ? clampBox({ ...b, x: b.x + Math.round(dx / stepX), y: b.y + Math.round(dy / stepY) })
          : clampBox({ ...b, w: b.w + Math.round(dx / stepX), h: b.h + Math.round(dy / stepY) });
      // 調整大小時不能超出右邊
      if (mode === "resize") next.w = Math.min(next.w, COLS - b.x);
      drag = { ...drag, dx, dy, layout: compact(homeLayout.items.map((x) => (x.id === b.id ? next : x)), b.id) };
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
    const next = e.shiftKey ? clampBox({ ...b, w: Math.min(b.w + d[0], COLS - b.x), h: b.h + d[1] }) : clampBox({ ...b, x: b.x + d[0], y: b.y + d[1] });
    homeLayout.set(compact(homeLayout.items.map((x) => (x.id === b.id ? next : x)), b.id));
  }
</script>

<div class="grid" class:editing class:dragging={!!drag} bind:clientWidth={width} style:height="{height}px">
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
      class="cell w-{b.id}"
      class:lifted
      style:left="{r.left}px"
      style:top="{r.top}px"
      style:width="{r.width}px"
      style:height="{r.height}px"
      tabindex={editing ? 0 : undefined}
      role={editing ? "group" : undefined}
      aria-label={editing ? `${WIDGETS[b.id].label}：拖曳移動，方向鍵移動，Shift 加方向鍵調整大小` : undefined}
      onpointerdown={(e) => start(e, b, "move")}
      onkeydown={(e) => key(e, b)}
    >
      <div class="content">{@render content(b.id)}</div>
      {#if editing}
        <span class="name">{WIDGETS[b.id].label}</span>
        <button class="remove" onpointerdown={(e) => e.stopPropagation()} onclick={() => homeLayout.remove(b.id)} aria-label="拿掉「{WIDGETS[b.id].label}」" title="拿掉">
          <Icon name="close" size={12} stroke={2} />
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="resize" onpointerdown={(e) => start(e, b, "resize")} title="拖曳調整大小"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
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
