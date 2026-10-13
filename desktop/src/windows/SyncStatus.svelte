<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { store } from "@deskdo/core/store.svelte";

  /** compact：同步正常時只顯示小圓點（桌面小工具空間有限） */
  let { compact = false }: { compact?: boolean } = $props();

  const s = $derived(store.snap);
  const label = $derived(
    s.status === "ok"
      ? s.lastSync
        ? t(`已同步 ${s.lastSync}`, `Synced ${s.lastSync}`)
        : t("已同步", "Synced")
      : s.status === "syncing"
        ? t("同步中…", "Syncing…")
        : s.status === "offline"
          ? t("離線", "Offline")
          : t("同步錯誤", "Sync error"),
  );
  const tip = $derived(s.message ? `${s.message}\n${t("點一下重新同步", "Click to retry")}` : `${label}\n${t("點一下立即同步", "Click to sync now")}`);
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
