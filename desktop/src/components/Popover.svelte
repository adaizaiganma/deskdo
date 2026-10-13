<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  /** 浮在 (x, y) 的小設定視窗：點外面或按 Esc 關閉 */
  interface Props {
    x: number;
    y: number;
    title: string;
    onclose: () => void;
    children: Snippet;
  }
  let { x, y, title, onclose, children }: Props = $props();

  let node = $state<HTMLElement>();

  /** 別超出視窗；內容變多（例如選了背景圖片多一列）時再挪一次 */
  function place(el: HTMLElement) {
    const fit = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${Math.max(8, Math.min(x, innerWidth - 8 - w))}px`;
      el.style.top = `${Math.max(8, Math.min(y, innerHeight - 8 - h))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    el.querySelector<HTMLElement>("button, input")?.focus();
    return { destroy: () => ro.disconnect() };
  }

  function onDown(e: PointerEvent) {
    if (node && !node.contains(e.target as Node)) onclose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<!-- 不在視窗失焦時關閉：選背景圖片時會開系統的檔案視窗 -->
<svelte:window onpointerdown={onDown} onkeydown={onKey} />

<div class="pop" role="dialog" aria-label={title} bind:this={node} use:place>
  <header>
    <span class="title">{title}</span>
    <button class="x" onclick={onclose} aria-label={t("關閉", "Close")}><Icon name="close" size={12} /></button>
  </header>
  {@render children()}
</div>

<style>
  .pop {
    position: fixed;
    z-index: 60;
    width: 300px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 6px 14px 14px;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--pop-shadow);
    font-size: 13px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .title {
    font-size: 13px;
    font-weight: 700;
  }
  .x {
    width: 26px;
    height: 26px;
    margin-right: -6px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--sub);
  }
  .x:hover {
    background: var(--hover);
  }

  /* 設定的一列：上面是名稱，下面是選項 */
  .pop :global(.opt) {
    padding: 10px 0 0;
  }
  .pop :global(.opt + .opt) {
    margin-top: 10px;
    border-top: 1px solid var(--line);
  }
  .pop :global(.opt-name) {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12.5px;
    color: var(--sub);
  }
  .pop :global(.seg) {
    display: flex;
    padding: 2px;
    border-radius: 9px;
    background: var(--bg2);
  }
  .pop :global(.seg button) {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 4px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--sub);
    white-space: nowrap;
  }
  .pop :global(.seg button.on) {
    background: var(--raised);
    color: var(--text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .pop :global(.chips) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pop :global(.chip) {
    height: 28px;
    padding: 0 12px;
    border-radius: 14px;
    border: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--sub);
  }
  .pop :global(.chip:hover) {
    background: var(--hover);
  }
  .pop :global(.chip.on) {
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 500;
  }
  .pop :global(.link) {
    font-size: 12px;
    color: var(--accent);
  }
  .pop :global(.link:hover) {
    text-decoration: underline;
  }
  .pop :global(.hint) {
    margin-top: 6px;
    font-size: 11.5px;
    color: var(--faint);
  }
</style>
