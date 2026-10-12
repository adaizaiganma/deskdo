<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { tick } from "svelte";
  import { scale } from "svelte/transition";
  import Icon from "../components/Icon.svelte";
  import TodoPanel from "../components/TodoPanel.svelte";
  import { longDate } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import { theme } from "../lib/theme.svelte";
  import SyncStatus from "./SyncStatus.svelte";

  let menuOpen = $state(false);
  let effects = $state(true);

  const opacity = $derived(store.prefs?.desktopOpacity ?? 0.92);

  function menu(action: () => unknown) {
    menuOpen = false;
    action();
  }

  // 毛玻璃的底色跟著深色、淺色（設定頁可以強制，見 theme.svelte.ts）
  let ready = false;
  $effect(() => {
    const dark = theme.dark;
    invoke<boolean>("set_widget_theme", { dark }).then((ok) => {
      effects = ok;
      if (!ready) {
        ready = true;
        tick().then(() => invoke("widget_ready"));
      }
    });
  });
</script>

<svelte:window
  onkeydown={(e) => e.key === "Escape" && (menuOpen = false)}
  onpointerdown={(e) => menuOpen && !(e.target as HTMLElement).closest(".menu-wrap") && (menuOpen = false)}
/>

<div class="widget" class:effects style:--opacity={opacity}>
  <header data-tauri-drag-region>
    <div class="heading" data-tauri-drag-region>
      <div class="title" data-tauri-drag-region>
        待辦事項{#if store.prefs?.beta}<span class="beta" data-tauri-drag-region>測試版</span>{/if}
      </div>
      <div class="sub" data-tauri-drag-region>
        {longDate(store.today)} · {store.open.length} 項待辦{#if store.overdueCount}<span class="warn"> · {store.overdueCount} 逾期</span>{/if}
      </div>
    </div>
    <SyncStatus compact />
    <div class="menu-wrap">
      <button class="icon-btn" onclick={() => (menuOpen = !menuOpen)} aria-label="更多選項" aria-expanded={menuOpen}>
        <Icon name="more" />
      </button>
      {#if menuOpen}
        <div class="menu" role="menu" transition:scale={{ start: 0.95, duration: 120 }}>
          <button role="menuitem" onclick={() => menu(() => invoke("open_main", { view: null }))}><Icon name="open" />開啟主視窗</button>
          <button role="menuitem" onclick={() => menu(() => store.refresh())}><Icon name="refresh" />立即同步</button>
          {#if store.appUpdate}
            <button role="menuitem" class="accent" onclick={() => menu(() => store.installUpdate())}>
              <Icon name="sparkle" />更新到 {store.appUpdate.version}
            </button>
          {/if}
          <button role="menuitem" onclick={() => menu(() => invoke("open_main", { view: "settings" }))}><Icon name="settings" />設定…</button>
          <hr />
          <button role="menuitem" onclick={() => menu(() => invoke("set_widget_visible", { visible: false }))}><Icon name="close" />隱藏桌面小工具</button>
        </div>
      {/if}
    </div>
  </header>

  <TodoPanel doneKey="widget.showDone" />
</div>

<style>
  .widget {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg) calc(var(--opacity) * 100%), transparent);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  /* 有毛玻璃時，背景色調、圓角和外框都由 Windows 處理（濃淡跟著不透明度設定） */
  .widget.effects {
    background: transparent;
    border: 0;
    border-radius: 0;
    /* 輸入框、標籤等原本是實心底色，改成半透明才看得到後面的毛玻璃 */
    --bg2: color-mix(in srgb, var(--text) 8%, transparent);
    --raised: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 14px 10px 10px 18px;
  }
  .heading {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .sub {
    font-size: 12px;
    color: var(--sub);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    color: var(--warn);
  }

  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 36px;
    z-index: 20;
    min-width: 172px;
    padding: 5px;
    border-radius: 10px;
    background: var(--raised);
    box-shadow: var(--pop-shadow);
    border: 1px solid var(--line);
    transform-origin: top right;
  }
  .menu button {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text);
  }
  .menu button:hover {
    background: var(--hover);
  }
  .menu button.accent {
    color: var(--accent);
    font-weight: 600;
  }
  .menu hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 6px;
  }

</style>
