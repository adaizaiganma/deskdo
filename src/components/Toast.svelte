<script lang="ts">
  import { fly } from "svelte/transition";
  import { toast } from "@deskdo/core/toast.svelte";
</script>

<!-- Material 的 snackbar；放在浮動按鈕上面 -->
{#if toast.current}
  {#key toast.current.id}
    <div class="toast" class:error={toast.current.kind === "error"} role="status" transition:fly={{ y: 16, duration: 220 }}>
      <span class="msg">{toast.current.message}</span>
      {#if toast.current.undo}
        <button class="act" onclick={() => toast.runUndo()}>復原</button>
      {:else}
        <button class="act" onclick={() => toast.dismiss()} aria-label="關閉">✕</button>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: var(--toast-bottom, 16px);
    z-index: 60;
    min-height: 48px;
    padding: 6px 6px 6px 16px;
    border-radius: 4px;
    background: var(--inverse);
    color: var(--on-inverse);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    box-shadow: var(--pop-shadow);
  }
  .toast.error {
    background: #ba1a1a;
    color: #fff;
  }
  .msg {
    flex: 1;
    min-width: 0;
    line-height: 1.4;
  }
  .act {
    flex: none;
    height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    font-weight: 700;
    color: var(--inverse-accent);
  }
  .toast.error .act {
    color: #fff;
  }
</style>
