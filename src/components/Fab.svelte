<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import Icon from "./Icon.svelte";

  /** 右下角的浮動按鈕；有 label 時是加寬的（圖示加文字） */
  let { label = "", aria = t("新增", "Add"), onclick }: { label?: string; aria?: string; onclick: () => void } = $props();
</script>

<button class="fab" class:wide={!!label} {onclick} aria-label={label ? undefined : aria}>
  <Icon name="plus" size={24} stroke={1.6} />
  {#if label}<span>{label}</span>{/if}
</button>

<style>
  .fab {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 5;
    height: 56px;
    min-width: 56px;
    border-radius: 16px;
    background: var(--accent-container);
    color: var(--on-accent-container);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.28);
    transition: filter 0.15s;
  }
  .fab.wide {
    padding: 0 20px 0 16px;
  }
  .fab:active {
    filter: brightness(1.1);
  }
  span {
    font-size: 15px;
    font-weight: 500;
  }
</style>
