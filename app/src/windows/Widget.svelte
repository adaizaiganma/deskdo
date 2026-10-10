<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, tick } from "svelte";
  import { fade, scale } from "svelte/transition";
  import Icon from "../components/Icon.svelte";
  import QuickAdd from "../components/QuickAdd.svelte";
  import Toast from "../components/Toast.svelte";
  import TodoList from "../components/TodoList.svelte";
  import { longDate } from "../lib/dates";
  import { store } from "../lib/store.svelte";
  import SyncStatus from "./SyncStatus.svelte";

  let filter = $state<string | null>(null);
  let showDone = $state(readFlag("widget.showDone"));
  let menuOpen = $state(false);
  let effects = $state(true);

  const opacity = $derived(store.prefs?.desktopOpacity ?? 0.92);
  const filters = $derived(
    store.tags
      .map((tag) => ({ tag, count: store.open.filter((t) => t.tag === tag).length }))
      .filter((f) => f.count > 0),
  );
  const todos = $derived(filter ? store.open.filter((t) => t.tag === filter) : store.open);
  // 小工具只看今天完成的（確認剛剛勾了什麼、順手復原），完整紀錄在主視窗
  const done = $derived(filter ? store.doneToday.filter((t) => t.tag === filter) : store.doneToday);

  // 篩選中的標籤沒有項目了就回到「全部」
  $effect(() => {
    if (filter && !filters.some((f) => f.tag === filter)) filter = null;
  });

  /** 標籤列放不下時，把滑鼠滾輪的上下捲動轉成左右捲動 */
  function wheelToHorizontal(node: HTMLElement) {
    const onWheel = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!delta) return;
      e.preventDefault();
      node.scrollLeft += delta * (e.deltaMode === 1 ? 16 : 1); // deltaMode 1 = 以「行」為單位
    };
    // 要呼叫 preventDefault，所以不能用 passive 監聽
    node.addEventListener("wheel", onWheel, { passive: false });
    return { destroy: () => node.removeEventListener("wheel", onWheel) };
  }

  function readFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function toggleDone() {
    showDone = !showDone;
    try {
      localStorage.setItem("widget.showDone", showDone ? "1" : "0");
    } catch {}
  }

  function menu(action: () => unknown) {
    menuOpen = false;
    action();
  }

  onMount(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = async () => {
      effects = await invoke<boolean>("set_widget_theme", { dark: media.matches });
    };
    media.addEventListener("change", applyTheme);
    applyTheme().then(tick).then(() => invoke("widget_ready"));
    return () => media.removeEventListener("change", applyTheme);
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
          <button role="menuitem" onclick={() => menu(() => invoke("open_main", { view: "settings" }))}><Icon name="settings" />設定…</button>
          <hr />
          <button role="menuitem" onclick={() => menu(() => invoke("set_widget_visible", { visible: false }))}><Icon name="close" />隱藏桌面小工具</button>
        </div>
      {/if}
    </div>
  </header>

  {#if filters.length}
    <nav class="chips" aria-label="依標籤篩選" use:wheelToHorizontal>
      <button class="chip" class:on={!filter} onclick={() => (filter = null)}>全部<span class="n">{store.open.length}</span></button>
      {#each filters as f (f.tag)}
        <button class="chip" class:on={filter === f.tag} onclick={() => (filter = filter === f.tag ? null : f.tag)}>
          #{f.tag}<span class="n">{f.count}</span>
        </button>
      {/each}
    </nav>
  {/if}

  <div class="scroll-wrap">
    <div class="scroll">
      {#if store.snap.todos.length === 0 && store.snap.status === "syncing"}
        <div class="loading" in:fade>載入中…</div>
      {:else}
        <TodoList
          {todos}
          {done}
          today={store.today}
          {showDone}
          ontoggledone={toggleDone}
          emptyText={store.prefs && !store.prefs.configured
            ? "還沒完成設定\n請在主視窗完成設定精靈"
            : filter
              ? "這個標籤沒有待辦"
              : "沒有待辦事項\n享受一下空白吧"}
        />
      {/if}
    </div>
    <Toast />
  </div>

  <footer>
    <QuickAdd defaultTag={filter} />
  </footer>
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
  .menu hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 6px;
  }

  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0 16px 8px;
    flex: none;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    height: 28px;
    padding: 0 11px;
    border-radius: 999px;
    font-size: 12.5px;
    color: var(--sub);
    background: var(--bg2);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.18s, color 0.18s;
  }
  .chip:hover {
    color: var(--text);
  }
  .chip .n {
    font-size: 11px;
    opacity: 0.75;
  }
  .chip.on {
    background: var(--text);
    color: var(--bg);
  }

  .scroll-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .scroll {
    height: 100%;
    overflow-y: auto;
    padding: 0 6px 0 8px;
  }
  .loading {
    padding: 56px 0;
    text-align: center;
    color: var(--faint);
    font-size: 13px;
  }
  footer {
    flex: none;
    padding: 10px 12px 8px;
    border-top: 1px solid var(--line);
  }
</style>
