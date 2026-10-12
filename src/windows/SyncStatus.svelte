<script lang="ts">
  import { store } from "@deskdo/core/store.svelte";

  /** 同步狀態的小標籤；點一下立即同步 */
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
</script>

<button class="sync {s.status}" title={s.message || undefined} aria-label="{label}，點一下立即同步" onclick={() => store.refresh()}>
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
