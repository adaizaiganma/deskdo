<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import Calendar from "../components/Calendar.svelte";

  import Icon, { type IconName } from "../components/Icon.svelte";
  import QuickAdd from "../components/QuickAdd.svelte";
  import Toast from "../components/Toast.svelte";
  import TodoList from "../components/TodoList.svelte";
  import { closeOnBack } from "../lib/back.svelte";
  import { longDate } from "../lib/dates";
  import { mobile } from "../lib/platform";
  import { store } from "../lib/store.svelte";
  import type { Todo } from "../lib/types";
  import Countdowns from "./Countdowns.svelte";
  import Home from "./Home.svelte";
  import Folders from "./Folders.svelte";
  import Settings from "./Settings.svelte";
  import Setup from "./Setup.svelte";
  import SyncStatus from "./SyncStatus.svelte";
  import TitleBar from "./TitleBar.svelte";

  type View = "home" | "all" | "calendar" | "countdown" | "settings" | "folders" | `tag:${string}` | `folder:${string}`;
  /** 「全部」頁的篩選：未完成、沒有期限、已完成 */
  type AllFilter = "open" | "nodue" | "done";

  let view = $state<View>("home");
  let allFilter = $state<AllFilter>("open");
  /**
   * 設定精靈：new = 第一次設定，update = 更新雲端。
   * 精靈部署到一半就會寫入設定（configured 變成 true），所以用自己的狀態決定何時關閉，
   * 而不是直接看 configured，否則看不到最後一頁的連接器網址。
   */
  let wizard = $state<"new" | "update" | null>(null);
  let query = $state("");
  let showDone = $state(false);
  /** 目前頁面的快速新增（日曆頁的在日曆裡），Ctrl+N 用 */
  let quickAdd = $state<{ focus(): void }>();
  let search = $state<HTMLInputElement>();
  /** 手機版：側邊欄改成從左邊滑出的抽屜 */
  let drawer = $state(false);
  closeOnBack("drawer", () => drawer, () => (drawer = false));

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
    // 主頁的數字：今天到期和逾期的
    { id: "home", label: "主頁", icon: "home", count: () => open.filter((t) => t.due && t.due <= today).length },
    { id: "all", label: "全部", icon: "inbox", count: () => open.length },
    { id: "calendar", label: "日曆", icon: "calendar", count: () => 0 },
    { id: "countdown", label: "倒數日", icon: "hourglass", count: () => 0 },
  ];
  const allFilters = $derived<{ id: AllFilter; label: string; count: number }[]>([
    { id: "open", label: "未完成", count: open.length },
    { id: "nodue", label: "沒有期限", count: open.filter((t) => !t.due).length },
    { id: "done", label: "已完成", count: store.done.length },
  ]);
  /** 「全部」頁只看已完成的 */
  const doneOnly = $derived(view === "all" && allFilter === "done");

  // 標籤、資料夾頁也列出還沒輪到的步驟（淡色顯示）：它的前一步可能是別的標籤，不列出來就找不到了
  const countOf = (tag: string) => store.allOpen.filter((t) => t.tag === tag).length;
  /** 側欄：資料夾（含還沒有待辦的標籤），接著是未分類的標籤 */
  const sideFolders = $derived(
    store.folders.map((f) => {
      const tags = f.tags.map((tag) => ({ tag, count: countOf(tag) }));
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
        sub: `${store.allOpen.filter(inFolder).length} 項待辦`,
        todos: store.allOpen.filter(inFolder),
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
        sub: `${store.allOpen.filter((t) => t.tag === tag).length} 項待辦`,
        todos: store.allOpen.filter((t) => t.tag === tag),
        done: store.done.filter((t) => t.tag === tag),
        defaultTag: tag,
        defaultDue: null,
        empty: "這個標籤沒有待辦",
      };
    }
    switch (view) {
      case "home":
        // 主頁的內容在 Home.svelte，這裡只用標題（手機上方的列）
        return { title: "主頁", sub: "", todos: [], done: null, defaultTag: null, defaultDue: null, empty: "" };
      case "calendar":
        return { title: "日曆", sub: "", todos: [], done: null, defaultTag: null, defaultDue: null, empty: "" };
      default:
        if (allFilter === "nodue")
          return { title: "全部", sub: "沒有期限的待辦", todos: list.filter((t) => !t.due), done: null, defaultTag: null, defaultDue: null, empty: "每件事都排好期限了" };
        if (allFilter === "done")
          return {
            title: "全部",
            sub: `最近 ${doneDays} 天完成 ${store.done.length} 項・更早的紀錄保存在雲端`,
            todos: [],
            done: store.done,
            defaultTag: null,
            defaultDue: null,
            empty: `最近 ${doneDays} 天沒有完成的項目`,
          };
        // 已完成的改用上面的篩選看
        return { title: "全部", sub: `${open.length} 項待辦`, todos: list, done: null, defaultTag: null, defaultDue: null, empty: "沒有待辦事項\n享受一下空白吧" };
    }
  });

  // 正在看的資料夾被改名或刪除了就回到主頁
  $effect(() => {
    if (view.startsWith("folder:") && !store.folders.some((f) => `folder:${f.name}` === view)) go("home");
  });

  function go(v: View) {
    // 從別頁回到「全部」時從未完成開始看
    if (v !== view) allFilter = "open";
    view = v;
    showDone = false;
    drawer = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (view === "settings" || view === "folders" || view === "countdown") go("home");
      else if (doneOnly) allFilter = "open";
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
    // 手機：從主畫面小工具點了某一筆打開 App 時，切到「全部」並展開它
    const openFromWidget = async () => {
      const id = await invoke<string | null>("take_widget_todo");
      if (!id || wizard) return;
      query = "";
      go("all");
      allFilter = "open";
      store.focus = id;
    };
    // App 剛啟動時自己拿；原本就在背景時，MainActivity.onResume 會發 deskdo-open
    if (mobile) openFromWidget();
    addEventListener("deskdo-open", openFromWidget);
    return () => {
      off.then((f) => f());
      removeEventListener("deskdo-open", openFromWidget);
    };
  });
</script>

<svelte:window onkeydown={onKey} />

{#snippet banners()}
  {#if store.appUpdate}
    <button class="banner" onclick={() => store.installUpdate()} title={store.appUpdate.notes ?? ""}>
      <Icon name="refresh" size={14} />{#if mobile}Deskdo {store.appUpdate.version} 推出了，按這裡下載並安裝{:else}Deskdo {store.appUpdate.version} 已經下載好，按這裡重新啟動並更新{/if}
    </button>
  {/if}
  {#if store.cloudOutdated}
    <button class="banner" onclick={() => (wizard = "update")}>
      <Icon name="sparkle" size={14} />雲端有新版本，按這裡更新（需要登入 Cloudflare）
    </button>
  {/if}
{/snippet}

<div class="app">
  {#if !mobile}<TitleBar />{/if}
  {#if wizard}
    <div class="body solo">
      <Setup
        mode={wizard}
        onfinish={() => ((wizard = null), go("home"))}
        oncancel={wizard === "update" ? () => (wizard = null) : undefined}
      />
    </div>
  {:else}
  <div class="body">
    {#if drawer}<button class="scrim" onclick={() => (drawer = false)} aria-label="關閉選單"></button>{/if}
    <aside class:open={drawer}>
      <label class="search">
        <Icon name="search" size={14} />
        <input bind:this={search} bind:value={query} placeholder="搜尋" onkeydown={(e) => e.key === "Escape" && (query = "")} />
      </label>

      <nav>
        {#each nav as n (n.id)}
          <button class="nav" class:on={view === n.id} onclick={() => go(n.id)}>
            <span class="nicon" class:accent={n.id === "home"}><Icon name={n.icon} /></span>
            <span class="nlabel">{n.label}</span>
            {#if n.count()}<span class="ncount" class:warn={n.id === "home" && store.overdueCount}>{n.count()}</span>{/if}
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
                <button class="nav inner" class:idle={!t.count} class:on={view === `tag:${t.tag}`} onclick={() => go(`tag:${t.tag}`)}>
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
      {#if mobile}
        <div class="mbar">
          <button class="icon-btn" onclick={() => (drawer = true)} aria-label="選單"><Icon name="menu" size={20} /></button>
          <span class="mtitle">{view === "settings" ? "設定" : view === "folders" ? "整理標籤" : view === "countdown" ? "倒數日" : page.title}</span>
          {#if query.trim()}<button class="mquery" onclick={() => (query = "")}>「{query.trim()}」<Icon name="close" size={12} /></button>{/if}
        </div>
      {/if}
      {#if view === "settings"}
        <div class="scroll"><Settings onsetup={(mode) => (wizard = mode)} /></div>
      {:else if view === "home"}
        <Home bind:this={quickAdd} {today} {matches} top={banners} oncountdowns={() => go("countdown")} />
      {:else if view === "countdown"}
        <div class="scroll"><Countdowns {today} /></div>
      {:else if view === "folders"}
        <Folders onupdatecloud={() => (wizard = "update")} />
      {:else}
        <div class="scroll">
          <div class="page">
            {@render banners()}
            <header class:cal={view === "calendar"}>
              <h1>{page.title}</h1>
              {#if page.sub}<p>{page.sub}</p>{/if}
            </header>
            {#if view === "all"}
              <div class="filters" role="tablist" aria-label="篩選">
                {#each allFilters as f (f.id)}
                  <button role="tab" aria-selected={allFilter === f.id} class:on={allFilter === f.id} onclick={() => ((allFilter = f.id), (showDone = false))}>
                    {f.label}<span>{f.count}</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if view === "calendar"}
              <Calendar bind:this={quickAdd} {today} {matches} searching={!!query.trim()} />
            {:else}
            {#if !doneOnly}
              <QuickAdd bind:this={quickAdd} defaultTag={page.defaultTag} defaultDue={page.defaultDue} />
            {/if}
            {#key `${view}:${allFilter}`}
              <TodoList
                todos={page.todos.filter(matches)}
                done={page.done ? page.done.filter(matches) : null}
                {today}
                showDone={doneOnly ? undefined : showDone || !!query.trim()}
                ontoggledone={doneOnly ? undefined : () => (showDone = !showDone)}
                doneLimit={doneOnly ? 300 : 50}
                emptyText={query.trim() ? `找不到「${query.trim()}」` : page.empty}
              />
            {/key}
            {/if}
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
    /* 手機跳出鍵盤、側邊欄變矮時不要被壓扁 */
    flex: none;
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
  .nicon.accent {
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
    padding-right: 30px;
  }
  /* 收合箭頭放在資料夾那一列的右端（數字的右邊），整個右端都可以點 */
  .caret {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 30px;
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
  /* 資料夾裡還沒有待辦的標籤 */
  .nav.idle:not(.on) {
    color: var(--faint);
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
  /* 「全部」頁的篩選 */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 2px 14px;
  }
  .filters button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--bg2);
    font-size: 13px;
    color: var(--sub);
    transition: background 0.12s, color 0.12s;
  }
  .filters button:hover {
    color: var(--text);
  }
  .filters button span {
    font-size: 12px;
    color: var(--faint);
  }
  .filters button.on {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 500;
  }
  .filters button.on span {
    color: var(--accent);
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

  /* ---- 手機版 ---- */
  .mbar,
  .scrim {
    display: none;
  }
  :global(html.mobile) .mbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 52px;
    padding: 0 8px;
    flex: none;
  }
  :global(html.mobile) .mbar .icon-btn {
    width: 40px;
    height: 40px;
  }
  .mtitle {
    font-size: 17px;
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mquery {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--bg2);
    font-size: 12.5px;
    color: var(--sub);
    max-width: 45%;
    overflow: hidden;
    white-space: nowrap;
  }
  :global(html.mobile) main {
    display: flex;
    flex-direction: column;
    border: none;
    border-radius: 0;
    /* 和狀態列、導覽列後面的底色（Android 的 app_bg）一樣 */
    background: var(--bg);
  }
  :global(html.mobile) main > .scroll,
  :global(html.mobile) main > :global(.page) {
    flex: 1;
    min-height: 0;
  }
  :global(html.mobile) .page {
    padding: 4px 16px 80px;
  }
  /* 標題已經在上方的列裡 */
  :global(html.mobile) .page header h1 {
    display: none;
  }
  :global(html.mobile) .page header {
    padding-bottom: 10px;
  }
  /* 日曆的月份列已經在最上面 */
  :global(html.mobile) .page header.cal {
    display: none;
  }
  :global(html.mobile) aside {
    position: fixed;
    z-index: 30;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(300px, 84vw);
    padding-top: 14px;
    background: var(--raised);
    box-shadow: var(--pop-shadow);
    transform: translateX(calc(-100% - 40px));
    transition: transform 0.22s ease;
  }
  :global(html.mobile) aside.open {
    transform: none;
  }
  :global(html.mobile) .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 29;
    background: rgba(0, 0, 0, 0.35);
  }
  /* 手指點的地方大一點 */
  :global(html.mobile) .nav {
    min-height: 42px;
    font-size: 15px;
  }
  :global(html.mobile) .search {
    height: 40px;
  }
  /* 手機：手指點的範圍再寬一點 */
  :global(html.mobile) .caret {
    width: 44px;
  }
  :global(html.mobile) .folder-row .nav {
    padding-right: 44px;
  }
  :global(html.mobile) .search input {
    font-size: 15px;
  }
</style>
