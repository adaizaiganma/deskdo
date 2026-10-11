<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Icon, { type IconName } from "../components/Icon.svelte";
  import QuickAdd from "../components/QuickAdd.svelte";
  import Toast from "../components/Toast.svelte";
  import TodoList from "../components/TodoList.svelte";
  import { longDate } from "../lib/dates";
  import { store } from "../lib/store.svelte";
  import type { Todo } from "../lib/types";
  import Folders from "./Folders.svelte";
  import Settings from "./Settings.svelte";
  import Setup from "./Setup.svelte";
  import SyncStatus from "./SyncStatus.svelte";
  import TitleBar from "./TitleBar.svelte";

  type View = "all" | "today" | "upcoming" | "nodue" | "done" | "settings" | "folders" | `tag:${string}` | `folder:${string}`;

  let view = $state<View>("today");
  /**
   * 設定精靈：new = 第一次設定，update = 更新雲端。
   * 精靈部署到一半就會寫入設定（configured 變成 true），所以用自己的狀態決定何時關閉，
   * 而不是直接看 configured，否則看不到最後一頁的連接器網址。
   */
  let wizard = $state<"new" | "update" | null>(null);
  let query = $state("");
  let showDone = $state(false);
  let quickAdd = $state<ReturnType<typeof QuickAdd>>();
  let search = $state<HTMLInputElement>();

  const needsSetup = $derived(!!store.prefs && !store.prefs.configured);
  $effect(() => {
    if (needsSetup && !wizard) wizard = "new";
  });
  const today = $derived(store.today);
  const open = $derived(store.open);
  /** 頁面上列出的待辦：搜尋時也找得到還沒輪到的步驟 */
  const list = $derived(query.trim() ? store.allOpen : store.open);
  const doneDays = $derived(store.prefs?.doneSyncDays ?? 30);

  const nav: { id: View; label: string; icon: IconName; count: () => number }[] = [
    { id: "today", label: "今天", icon: "sun", count: () => open.filter((t) => t.due && t.due <= today).length },
    { id: "upcoming", label: "即將到來", icon: "upcoming", count: () => open.filter((t) => t.due && t.due > today).length },
    { id: "all", label: "全部", icon: "inbox", count: () => open.length },
    { id: "nodue", label: "沒有期限", icon: "tray", count: () => open.filter((t) => !t.due).length },
    { id: "done", label: "已完成", icon: "done", count: () => 0 },
  ];

  const countOf = (tag: string) => open.filter((t) => t.tag === tag).length;
  /** 側欄：資料夾（只列出目前有用到的標籤），接著是未分類的標籤 */
  const sideFolders = $derived(
    store.folders.map((f) => {
      const tags = f.tags.filter((t) => store.tags.includes(t)).map((tag) => ({ tag, count: countOf(tag) }));
      return { name: f.name, tags, count: tags.reduce((n, t) => n + t.count, 0) };
    }),
  );
  const looseCounts = $derived(store.looseTags.map((tag) => ({ tag, count: countOf(tag) })));

  /** 收合的資料夾（每台電腦各自記住） */
  let collapsed = $state<string[]>(readCollapsed());
  function readCollapsed(): string[] {
    try {
      return JSON.parse(localStorage.getItem("main.collapsedFolders") ?? "[]");
    } catch {
      return [];
    }
  }
  function toggleFolder(name: string) {
    collapsed = collapsed.includes(name) ? collapsed.filter((n) => n !== name) : [...collapsed, name];
    try {
      localStorage.setItem("main.collapsedFolders", JSON.stringify(collapsed));
    } catch {}
  }

  function matches(t: Todo): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [t.title, t.note, t.tag].some((s) => s?.toLowerCase().includes(q));
  }

  /** 每個頁面要顯示的內容 */
  const page = $derived.by(() => {
    if (view.startsWith("folder:")) {
      const name = view.slice(7);
      const tags = new Set(store.folders.find((f) => f.name === name)?.tags);
      const inFolder = (t: Todo) => !!t.tag && tags.has(t.tag);
      return {
        title: name,
        sub: `${open.filter(inFolder).length} 項待辦`,
        todos: list.filter(inFolder),
        done: store.done.filter(inFolder),
        defaultTag: null,
        defaultDue: null,
        empty: tags.size ? "這個資料夾沒有待辦" : "這個資料夾還沒有標籤\n到「整理標籤」把標籤放進來",
      };
    }
    if (view.startsWith("tag:")) {
      const tag = view.slice(4);
      return {
        title: `#${tag}`,
        sub: `${open.filter((t) => t.tag === tag).length} 項待辦`,
        todos: list.filter((t) => t.tag === tag),
        done: store.done.filter((t) => t.tag === tag),
        defaultTag: tag,
        defaultDue: null,
        empty: "這個標籤沒有待辦",
      };
    }
    switch (view) {
      case "today":
        return {
          title: "今天",
          sub: longDate(today),
          todos: list.filter((t) => t.due && t.due <= today),
          done: store.doneToday,
          defaultTag: null,
          defaultDue: today,
          empty: "今天沒有要做的事\n可以看看「即將到來」",
        };
      case "upcoming":
        return {
          title: "即將到來",
          sub: "依期限排序",
          todos: list.filter((t) => t.due && t.due > today),
          done: null,
          defaultTag: null,
          defaultDue: null,
          empty: "接下來沒有排定期限的待辦",
        };
      case "nodue":
        return { title: "沒有期限", sub: "", todos: list.filter((t) => !t.due), done: null, defaultTag: null, defaultDue: null, empty: "每件事都排好期限了" };
      case "done":
        return {
          title: "已完成",
          sub: `最近 ${doneDays} 天完成 ${store.done.length} 項・更早的紀錄保存在雲端`,
          todos: [],
          done: store.done,
          defaultTag: null,
          defaultDue: null,
          empty: `最近 ${doneDays} 天沒有完成的項目`,
        };
      default:
        return { title: "全部", sub: `${open.length} 項待辦`, todos: list, done: store.done, defaultTag: null, defaultDue: null, empty: "沒有待辦事項\n享受一下空白吧" };
    }
  });

  // 正在看的資料夾被改名或刪除了就回到「全部」
  $effect(() => {
    if (view.startsWith("folder:") && !store.folders.some((f) => `folder:${f.name}` === view)) go("all");
  });

  function go(v: View) {
    view = v;
    showDone = v === "done";
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (view === "settings" || view === "folders" || view === "done") go("today");
      queueMicrotask(() => quickAdd?.focus());
    } else if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      search?.focus();
    }
  }

  onMount(() => {
    invoke<boolean>("get_effects").then((ok) => document.documentElement.classList.toggle("no-effects", !ok));
    // 還沒設定時直接打開主視窗顯示設定精靈
    if (store.prefs && !store.prefs.configured) invoke("open_main", { view: null });
    const off = listen<View>("navigate", (e) => go(e.payload));
    return () => {
      off.then((f) => f());
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <TitleBar />
  {#if wizard}
    <div class="body solo">
      <Setup
        mode={wizard}
        onfinish={() => ((wizard = null), go("today"))}
        oncancel={wizard === "update" ? () => (wizard = null) : undefined}
      />
    </div>
  {:else}
  <div class="body">
    <aside>
      <label class="search">
        <Icon name="search" size={14} />
        <input bind:this={search} bind:value={query} placeholder="搜尋" onkeydown={(e) => e.key === "Escape" && (query = "")} />
      </label>

      <nav>
        {#each nav as n (n.id)}
          <button class="nav" class:on={view === n.id} onclick={() => go(n.id)}>
            <span class="nicon" class:today={n.id === "today"}><Icon name={n.icon} /></span>
            <span class="nlabel">{n.label}</span>
            {#if n.count()}<span class="ncount" class:warn={n.id === "today" && store.overdueCount}>{n.count()}</span>{/if}
          </button>
        {/each}
      </nav>

      {#if store.tags.length || store.folders.length}
        <div class="h4-row">
          <h4>標籤</h4>
          <button class="tidy" class:on={view === "folders"} onclick={() => go("folders")} title="用資料夾整理標籤">整理</button>
        </div>
        <nav class="tags">
          {#each sideFolders as f (f.name)}
            {@const shut = collapsed.includes(f.name)}
            <div class="folder-row">
              <button class="caret" class:shut onclick={() => toggleFolder(f.name)} aria-label={shut ? "展開" : "收合"} aria-expanded={!shut}>
                <Icon name="chevron" size={12} />
              </button>
              <button class="nav" class:on={view === `folder:${f.name}`} onclick={() => go(`folder:${f.name}`)}>
                <span class="nicon"><Icon name="folder" /></span>
                <span class="nlabel">{f.name}</span>
                {#if f.count}<span class="ncount">{f.count}</span>{/if}
              </button>
            </div>
            {#if !shut}
              {#each f.tags as t (t.tag)}
                <button class="nav inner" class:on={view === `tag:${t.tag}`} onclick={() => go(`tag:${t.tag}`)}>
                  <span class="nicon hash">#</span>
                  <span class="nlabel">{t.tag}</span>
                  {#if t.count}<span class="ncount">{t.count}</span>{/if}
                </button>
              {/each}
            {/if}
          {/each}
          {#each looseCounts as t (t.tag)}
            <button class="nav" class:on={view === `tag:${t.tag}`} onclick={() => go(`tag:${t.tag}`)}>
              <span class="nicon hash">#</span>
              <span class="nlabel">{t.tag}</span>
              {#if t.count}<span class="ncount">{t.count}</span>{/if}
            </button>
          {/each}
        </nav>
      {/if}

      <div class="side-foot">
        <SyncStatus />
        <button class="icon-btn" class:on={view === "settings"} onclick={() => go("settings")} aria-label="設定" title="設定">
          <Icon name="settings" />
        </button>
      </div>
    </aside>

    <main>
      {#if view === "settings"}
        <div class="scroll"><Settings onsetup={(mode) => (wizard = mode)} /></div>
      {:else if view === "folders"}
        <div class="scroll"><Folders onupdatecloud={() => (wizard = "update")} /></div>
      {:else}
        <div class="scroll">
          <div class="page">
            {#if store.appUpdate}
              <button class="banner" onclick={() => store.installUpdate()} title={store.appUpdate.notes ?? ""}>
                <Icon name="refresh" size={14} />Deskdo {store.appUpdate.version} 已經下載好，按這裡重新啟動並更新
              </button>
            {/if}
            {#if store.cloudOutdated}
              <button class="banner" onclick={() => (wizard = "update")}>
                <Icon name="sparkle" size={14} />雲端有新版本，按這裡更新（需要登入 Cloudflare）
              </button>
            {/if}
            <header>
              <h1>{page.title}</h1>
              {#if page.sub}<p>{page.sub}</p>{/if}
            </header>
            {#if view !== "done"}
              <QuickAdd bind:this={quickAdd} defaultTag={page.defaultTag} defaultDue={page.defaultDue} />
            {/if}
            {#key view}
              <TodoList
                todos={page.todos.filter(matches)}
                done={page.done ? page.done.filter(matches) : null}
                {today}
                showDone={view === "done" ? undefined : showDone || !!query.trim()}
                ontoggledone={view === "done" ? undefined : () => (showDone = !showDone)}
                doneLimit={view === "done" ? 300 : 50}
                emptyText={query.trim() ? `找不到「${query.trim()}」` : page.empty}
              />
            {/key}
          </div>
        </div>
      {/if}
      <Toast />
    </main>
  </div>
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  :global(html.no-effects) .app {
    background: var(--bg);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  aside {
    width: 232px;
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 4px 10px 10px;
    overflow-y: auto;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    margin: 0 2px 12px;
    border-radius: 8px;
    background: var(--hover);
    border: 1px solid var(--line);
    color: var(--faint);
    cursor: text;
  }
  .search:focus-within {
    border-color: var(--accent);
    background: var(--raised);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    font-size: 13px;
    color: var(--text);
  }
  .search input::placeholder {
    color: var(--faint);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .nav {
    height: 36px;
    padding: 0 10px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    text-align: left;
    position: relative;
    transition: background 0.12s;
  }
  .nav:hover {
    background: var(--hover);
  }
  .nav.on {
    background: var(--active);
    font-weight: 500;
  }
  .nav.on::before {
    content: "";
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 3px;
    background: var(--accent);
  }
  .nicon {
    width: 18px;
    display: grid;
    place-items: center;
    color: var(--sub);
  }
  .nicon.today {
    color: var(--accent);
  }
  .nicon.hash {
    font-size: 14px;
    color: var(--faint);
  }
  .nlabel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ncount {
    font-size: 12px;
    color: var(--faint);
  }
  .ncount.warn {
    color: var(--warn);
    font-weight: 500;
  }
  h4 {
    margin: 18px 10px 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--faint);
    letter-spacing: 0.04em;
  }
  .h4-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 18px 4px 6px 0;
  }
  .h4-row h4 {
    margin: 0 10px;
  }
  .tidy {
    font-size: 11.5px;
    color: var(--faint);
    padding: 2px 8px;
    border-radius: 6px;
  }
  .tidy:hover,
  .tidy.on {
    color: var(--accent);
    background: var(--hover);
  }
  .folder-row {
    position: relative;
  }
  .folder-row .nav {
    width: 100%;
  }
  /* 收合箭頭疊在資料夾圖示左邊的留白上 */
  .caret {
    position: absolute;
    left: -8px;
    top: 0;
    bottom: 0;
    width: 16px;
    z-index: 1;
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .caret:hover {
    color: var(--text);
  }
  .caret :global(svg) {
    transform: rotate(90deg);
    transition: transform 0.15s;
  }
  .caret.shut :global(svg) {
    transform: rotate(0deg);
  }
  .nav.inner {
    padding-left: 30px;
  }
  .side-foot {
    margin-top: auto;
    padding-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .icon-btn.on {
    background: var(--active);
    color: var(--text);
  }

  main {
    flex: 1;
    min-width: 0;
    position: relative;
    background: var(--layer);
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
    border-top-left-radius: 10px;
  }
  :global(html.no-effects) main {
    background: var(--raised);
  }
  .scroll {
    height: 100%;
    overflow-y: auto;
  }
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 28px 80px;
  }
  header {
    padding: 0 10px 14px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
  }
  header p {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--sub);
  }
  main :global(.toast) {
    left: 50%;
    right: auto;
    width: min(420px, calc(100% - 32px));
    transform: translateX(-50%);
    bottom: 20px;
  }
  .body.solo {
    display: block;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 0 0 14px;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 13px;
    text-align: left;
  }
</style>
