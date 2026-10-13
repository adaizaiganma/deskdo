<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { toast } from "@deskdo/core/toast.svelte";
  import { BG_OPTIONS, FIT_OPTIONS, FONT_SCALES, homeStyle } from "../lib/homeStyle.svelte";
  import Popover from "./Popover.svelte";

  /** 自訂主頁：背景圖片、所有組件的背景和字體大小（主頁右鍵選單打開） */
  let { x, y, area, onclose }: { x: number; y: number; area: { w: number; h: number }; onclose: () => void } = $props();

  let picker = $state<HTMLInputElement>();
  let busy = $state(false);

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    busy = true;
    try {
      await homeStyle.setImage(file);
    } catch (err) {
      console.warn(err);
      toast.error(t("這個檔案沒辦法當背景圖片", "This file can't be used as a background image"));
    } finally {
      busy = false;
    }
  }

  // ---- 預覽：跟主頁同比例，拖曳可以移動背景圖片 ----
  let tw = $state(0);
  let th = $state(0);

  /** 圖片在預覽裡畫出來的大小（px） */
  const drawn = $derived.by(() => {
    const s = homeStyle.imageSize;
    if (!s || !tw || !th || !area.w) return null;
    const f = {
      cover: Math.max(tw / s.w, th / s.h),
      contain: Math.min(tw / s.w, th / s.h),
      fill: 0,
      center: tw / area.w,
      tile: tw / area.w,
    }[homeStyle.fit];
    return f ? { w: s.w * f, h: s.h * f } : { w: tw, h: th };
  });

  /** 圖片和預覽框差多少；差不到 1px 那個方向就沒得移 */
  const room = $derived(drawn ? { x: tw - drawn.w, y: th - drawn.h } : { x: 0, y: 0 });
  const movable = $derived(homeStyle.fit !== "fill" && (Math.abs(room.x) >= 1 || Math.abs(room.y) >= 1));

  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

  /** 圖片移動 dx, dy（預覽裡的 px）。background-position 是 p% 時圖片在 p% × (框 − 圖) 的位置 */
  function move(from: { x: number; y: number }, dx: number, dy: number) {
    homeStyle.set({
      x: Math.abs(room.x) >= 1 ? clamp(from.x + (dx / room.x) * 100) : from.x,
      y: Math.abs(room.y) >= 1 ? clamp(from.y + (dy / room.y) * 100) : from.y,
    });
  }

  let drag: { px: number; py: number; x: number; y: number } | null = null;

  function down(e: PointerEvent) {
    if (!movable || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { px: e.clientX, py: e.clientY, x: homeStyle.x, y: homeStyle.y };
  }
  function dragMove(e: PointerEvent) {
    if (drag) move(drag, e.clientX - drag.px, e.clientY - drag.py);
  }

  function key(e: KeyboardEvent) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !movable) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 5;
    homeStyle.set({
      x: clamp(homeStyle.x + d[0] * step * Math.sign(room.x)),
      y: clamp(homeStyle.y + d[1] * step * Math.sign(room.y)),
    });
  }
</script>

<Popover {x} {y} title={t("自訂主頁", "Customize home")} {onclose}>
  <div class="opt">
    <div class="opt-name">{t("背景圖片", "Background image")}</div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="thumb"
      class:movable
      class:has-image={!!homeStyle.image}
      role={movable ? "slider" : undefined}
      aria-label={movable ? t("背景圖片位置", "Background image position") : undefined}
      aria-valuetext={movable ? t(`水平 ${Math.round(homeStyle.x)}%，垂直 ${Math.round(homeStyle.y)}%`, `Horizontal ${Math.round(homeStyle.x)}%, vertical ${Math.round(homeStyle.y)}%`) : undefined}
      tabindex={movable ? 0 : undefined}
      bind:clientWidth={tw}
      bind:clientHeight={th}
      style:aspect-ratio={area.w && area.h ? `${area.w} / ${area.h}` : null}
      style:--dim={homeStyle.dim}
      style:background-image={homeStyle.image ? `url("${homeStyle.image}")` : null}
      style:background-size={drawn ? `${drawn.w}px ${drawn.h}px` : homeStyle.css.size}
      style:background-repeat={homeStyle.css.repeat}
      style:background-position={homeStyle.css.position}
      onpointerdown={down}
      onpointermove={dragMove}
      onpointerup={() => (drag = null)}
      onpointercancel={() => (drag = null)}
      onkeydown={key}
    >
      {#if !homeStyle.image}<span>{t("沒有", "None")}</span>{/if}
    </div>
    <div class="bg-row">
      <div class="bg-btns">
        <button class="btn" onclick={() => picker?.click()} disabled={busy}>{busy ? t("處理中…", "Working…") : homeStyle.image ? t("換一張…", "Change…") : t("選擇圖片…", "Choose image…")}</button>
        {#if homeStyle.image}
          <button class="btn" onclick={() => homeStyle.clearImage()}>{t("移除", "Remove")}</button>
        {/if}
      </div>
      <input bind:this={picker} type="file" accept="image/*" hidden onchange={pick} />
    </div>
    {#if homeStyle.image}
      <div class="seg fit" role="radiogroup" aria-label={t("背景圖片擺放", "Image fit")}>
        {#each FIT_OPTIONS as o (o.id)}
          <button role="radio" aria-checked={homeStyle.fit === o.id} class:on={homeStyle.fit === o.id} onclick={() => homeStyle.set({ fit: o.id })}>{o.label}</button>
        {/each}
      </div>
      <label class="dim">
        <span>{t("淡化", "Fade")}</span>
        <input type="range" min="0" max="80" value={Math.round(homeStyle.dim * 100)} oninput={(e) => homeStyle.set({ dim: Number(e.currentTarget.value) / 100 })} />
        <span class="pct">{Math.round(homeStyle.dim * 100)}%</span>
      </label>
      {#if movable}
        <div class="hint">
          {t("拖曳預覽圖調整位置", "Drag the preview to reposition")}{#if homeStyle.x !== 50 || homeStyle.y !== 50}・<button class="link" onclick={() => homeStyle.set({ x: 50, y: 50 })}>{t("回到正中間", "Re-center")}</button>{/if}
        </div>
      {/if}
    {/if}
  </div>

  <div class="opt">
    <div class="opt-name">{t("組件背景", "Widget background")}</div>
    <div class="seg" role="radiogroup" aria-label={t("組件背景", "Widget background")}>
      {#each BG_OPTIONS as o (o.id)}
        <button role="radio" aria-checked={homeStyle.bg === o.id} class:on={homeStyle.bg === o.id} onclick={() => homeStyle.set({ bg: o.id })}>{o.label}</button>
      {/each}
    </div>
  </div>

  <div class="opt">
    <div class="opt-name">{t("待辦清單背景", "To-do list background")}</div>
    <div class="seg" role="radiogroup" aria-label={t("待辦清單背景", "To-do list background")}>
      {#each BG_OPTIONS as o (o.id)}
        <button role="radio" aria-checked={homeStyle.panel === o.id} class:on={homeStyle.panel === o.id} onclick={() => homeStyle.set({ panel: o.id })}>{o.label}</button>
      {/each}
    </div>
  </div>

  <div class="opt">
    <div class="opt-name">{t("組件字體大小", "Widget font size")}</div>
    <div class="seg" role="radiogroup" aria-label={t("組件字體大小", "Widget font size")}>
      {#each FONT_SCALES as o (o.id)}
        <button role="radio" aria-checked={homeStyle.fs === o.id} class:on={homeStyle.fs === o.id} onclick={() => homeStyle.set({ fs: o.id })}>{o.label}</button>
      {/each}
    </div>
    {#if homeStyle.customized}
      <div class="hint">
        {t(`有 ${homeStyle.customized} 個組件用自己的設定・`, `${homeStyle.customized} widgets use their own settings · `)}<button class="link" onclick={() => homeStyle.resetWidgets()}>{t("全部改回跟著主頁", "Reset all to home")}</button>
      </div>
    {:else}
      <div class="hint">{t("在組件上按右鍵 →「組件設定」可以個別調整", "Right-click a widget → Widget settings to adjust it on its own")}</div>
    {/if}
  </div>
</Popover>

<style>
  .bg-row {
    margin-top: 8px;
  }
  .thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    max-height: 180px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 8px;
    background-color: var(--bg);
    box-shadow: 0 0 0 1px var(--line);
    font-size: 12px;
    color: var(--faint);
    touch-action: none;
  }
  /* 跟主頁一樣蓋一層淡化 */
  .thumb.has-image::before {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--bg);
    opacity: var(--dim);
    pointer-events: none;
  }
  .thumb.movable {
    cursor: grab;
  }
  .thumb.movable:active {
    cursor: grabbing;
  }
  .thumb:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .bg-btns {
    display: flex;
    gap: 6px;
  }
  .fit {
    margin-top: 10px;
  }
  .btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 7px;
    background: var(--bg2);
    font-size: 12.5px;
  }
  .btn:hover:not(:disabled) {
    background: var(--active);
  }
  .dim {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    font-size: 12.5px;
    color: var(--sub);
  }
  .dim input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .pct {
    width: 32px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
