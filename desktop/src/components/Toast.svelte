<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { fly } from "svelte/transition";
  import { toast } from "@deskdo/core/toast.svelte";
</script>

{#if toast.current}
  {#key toast.current.id}
    <div class="toast" class:error={toast.current.kind === "error"} role="status" transition:fly={{ y: 10, duration: 220 }}>
      <span class="msg" title={toast.current.message}>{toast.current.message}</span>
      {#if toast.current.undo}
        <button class="undo" onclick={() => toast.runUndo()}>{t("復原", "Undo")}</button>
      {:else}
        <button class="undo" onclick={() => toast.dismiss()} aria-label={t("關閉", "Close")}>✕</button>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 10;
    height: 42px;
    padding: 0 6px 0 14px;
    border-radius: 10px;
    background: var(--toast-bg);
    color: var(--toast-text);
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    box-shadow: var(--pop-shadow);
  }
  .toast.error {
    background: var(--warn);
    color: #fff;
  }
  .msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .undo {
    height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    font-weight: 700;
    color: var(--toast-accent);
  }
  .toast.error .undo {
    color: #fff;
  }
</style>
