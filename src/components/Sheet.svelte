<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { closeOnBack } from "../lib/back.svelte";

  /** 從底部滑上來的面板（modal bottom sheet）；點外面或按返回關閉 */
  let { label, onclose, children }: { label: string; onclose: () => void; children: Snippet } = $props();

  closeOnBack("sheet", () => true, () => onclose());
</script>

<div class="layer">
  <button class="scrim" onclick={onclose} aria-label="關閉" transition:fade={{ duration: 200 }}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={label} transition:fly={{ y: 360, duration: 260, opacity: 1 }}>
    <div class="handle" aria-hidden="true"><span></span></div>
    {@render children()}
  </div>
</div>

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim);
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 88%;
    overflow-y: auto;
    padding: 0 16px calc(20px + var(--nav-inset));
    border-radius: 28px 28px 0 0;
    background: var(--c-low);
  }
  .handle {
    display: flex;
    justify-content: center;
    padding: 14px 0 10px;
  }
  .handle span {
    width: 32px;
    height: 4px;
    border-radius: 2px;
    background: var(--faint);
  }
  .sheet :global(h2) {
    margin: 0 4px 14px;
    font-size: 22px;
    font-weight: 500;
  }
</style>
