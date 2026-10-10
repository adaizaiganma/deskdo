<script lang="ts">
  import { store } from "../lib/store.svelte";

  /** compact：同步正常時只顯示小圓點（桌面小工具空間有限） */
  let { compact = false }: { compact?: boolean } = $props();

  const s = $derived(store.snap);
  const label = $derived(
    s.status === "ok"
      ? s.lastSync
        ? `已同步 ${s.lastSync}`
        : "已同步"
      : s.status === "syncing"
        ? "同步中…"
        : s.status === "offline"
          ? "離線"
          : "同步錯誤",
  );
  const tip = $derived(s.message ? `${s.message}\n點一下重新同步` : `${label}\n點一下立即同步`);
  const hideLabel = $derived(compact && s.status === "ok");
</script>

<button class="sync {s.status}" class:compact={hideLabel} title={tip} aria-label={label} onclick={() => store.refresh()}>
  <span class="dot"></span>{#if !hideLabel}{label}{/if}
</button>

<style>
  .sync {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 11.5px;
    color: var(--faint);
    white-space: nowrap;
  }
  .sync.compact {
    width: 28px;
    padding: 0;
    justify-content: center;
  }
  .sync:hover {
    background: var(--hover);
    color: var(--sub);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
  }
  .syncing .dot {
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  .offline,
  .error {
    color: var(--warn);
  }
  .offline .dot,
  .error .dot {
    background: var(--warn);
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
