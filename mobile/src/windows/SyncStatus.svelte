<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { store } from "@deskdo/core/store.svelte";

  /** 同步狀態的小標籤；點一下立即同步 */
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
</script>

<button class="sync {s.status}" title={s.message || undefined} aria-label={t(`${label}，點一下立即同步`, `${label}, tap to sync now`)} onclick={() => store.refresh()}>
  <span class="dot"></span>{label}
</button>

<style>
  .sync {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 16px;
    background: var(--c);
    font-size: 12px;
    font-weight: 500;
    color: var(--sub);
    white-space: nowrap;
  }
  .dot {
    width: 8px;
    height: 8px;
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
