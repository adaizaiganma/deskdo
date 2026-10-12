<script lang="ts">
  import { toast } from "@deskdo/core/toast.svelte";
  import { BG_OPTIONS, FONT_SCALES, homeStyle } from "../lib/homeStyle.svelte";
  import Popover from "./Popover.svelte";

  /** 自訂主頁：背景圖片、所有組件的背景和字體大小（主頁右鍵選單打開） */
  let { x, y, onclose }: { x: number; y: number; onclose: () => void } = $props();

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
      toast.error("這個檔案沒辦法當背景圖片");
    } finally {
      busy = false;
    }
  }
</script>

<Popover {x} {y} title="自訂主頁" {onclose}>
  <div class="opt">
    <div class="opt-name">背景圖片</div>
    <div class="bg-row">
      <div class="thumb" style:background-image={homeStyle.image ? `url("${homeStyle.image}")` : null}>
        {#if !homeStyle.image}<span>沒有</span>{/if}
      </div>
      <div class="bg-btns">
        <button class="btn" onclick={() => picker?.click()} disabled={busy}>{busy ? "處理中…" : homeStyle.image ? "換一張…" : "選擇圖片…"}</button>
        {#if homeStyle.image}
          <button class="btn" onclick={() => homeStyle.clearImage()}>移除</button>
        {/if}
      </div>
      <input bind:this={picker} type="file" accept="image/*" hidden onchange={pick} />
    </div>
    {#if homeStyle.image}
      <label class="dim">
        <span>淡化</span>
        <input type="range" min="0" max="80" value={Math.round(homeStyle.dim * 100)} oninput={(e) => homeStyle.set({ dim: Number(e.currentTarget.value) / 100 })} />
        <span class="pct">{Math.round(homeStyle.dim * 100)}%</span>
      </label>
    {/if}
  </div>

  <div class="opt">
    <div class="opt-name">組件背景</div>
    <div class="seg" role="radiogroup" aria-label="組件背景">
      {#each BG_OPTIONS as o (o.id)}
        <button role="radio" aria-checked={homeStyle.bg === o.id} class:on={homeStyle.bg === o.id} onclick={() => homeStyle.set({ bg: o.id })}>{o.label}</button>
      {/each}
    </div>
  </div>

  <div class="opt">
    <div class="opt-name">待辦清單背景</div>
    <div class="seg" role="radiogroup" aria-label="待辦清單背景">
      {#each BG_OPTIONS as o (o.id)}
        <button role="radio" aria-checked={homeStyle.panel === o.id} class:on={homeStyle.panel === o.id} onclick={() => homeStyle.set({ panel: o.id })}>{o.label}</button>
      {/each}
    </div>
  </div>

  <div class="opt">
    <div class="opt-name">組件字體大小</div>
    <div class="seg" role="radiogroup" aria-label="組件字體大小">
      {#each FONT_SCALES as o (o.id)}
        <button role="radio" aria-checked={homeStyle.fs === o.id} class:on={homeStyle.fs === o.id} onclick={() => homeStyle.set({ fs: o.id })}>{o.label}</button>
      {/each}
    </div>
    {#if homeStyle.customized}
      <div class="hint">
        有 {homeStyle.customized} 個組件用自己的設定・<button class="link" onclick={() => homeStyle.resetWidgets()}>全部改回跟著主頁</button>
      </div>
    {:else}
      <div class="hint">在組件上按右鍵 →「組件設定」可以個別調整</div>
    {/if}
  </div>
</Popover>

<style>
  .bg-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .thumb {
    flex: none;
    width: 96px;
    height: 60px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--bg2) center / cover no-repeat;
    box-shadow: 0 0 0 1px var(--line);
    font-size: 12px;
    color: var(--faint);
  }
  .bg-btns {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
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
