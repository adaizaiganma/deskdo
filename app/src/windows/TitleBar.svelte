<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";

  const win = getCurrentWindow();
  let maximized = $state(false);

  onMount(() => {
    const sync = async () => (maximized = await win.isMaximized());
    sync();
    const off = win.onResized(sync);
    return () => {
      off.then((f) => f());
    };
  });
</script>

<div class="bar" data-tauri-drag-region>
  <div class="app-title" data-tauri-drag-region>
    <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="7" fill="#2563eb" />
      <path d="M9 16.6l5.1 5.1L23.7 11" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    待辦事項
  </div>
  <div class="controls">
    <button onclick={() => win.minimize()} aria-label="最小化"><Icon name="minimize" size={14} stroke={1.2} /></button>
    <button onclick={() => win.toggleMaximize()} aria-label={maximized ? "還原" : "最大化"}>
      <Icon name={maximized ? "restore" : "maximize"} size={13} stroke={1.2} />
    </button>
    <button class="close" onclick={() => win.close()} aria-label="關閉"><Icon name="close" size={14} stroke={1.2} /></button>
  </div>
</div>

<style>
  .bar {
    height: 40px;
    flex: none;
    display: flex;
    align-items: center;
    padding-left: 16px;
  }
  .app-title {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--sub);
  }
  .controls {
    display: flex;
    align-self: stretch;
  }
  .controls button {
    width: 46px;
    display: grid;
    place-items: center;
    color: var(--text);
    transition: background 0.1s;
  }
  .controls button:hover {
    background: var(--hover);
  }
  .controls .close:hover {
    background: #c42b1c;
    color: #fff;
  }
  .controls button:focus-visible {
    outline-offset: -2px;
  }
</style>
