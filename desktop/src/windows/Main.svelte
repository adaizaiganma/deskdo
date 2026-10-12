<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, tick } from "svelte";
  import Calendar from "../components/Calendar.svelte";

  import Icon, { type IconName } from "../components/Icon.svelte";
  import QuickAdd from "../components/QuickAdd.svelte";
  import Toast from "../components/Toast.svelte";
  import TodoList from "../components/TodoList.svelte";
  import { longDate } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import Countdowns from "./Countdowns.svelte";
  import Home from "./Home.svelte";
  import Folders from "./Folders.svelte";
  import Settings from "./Settings.svelte";
  import Setup from "./Setup.svelte";
  import SyncStatus from "./SyncStatus.svelte";
  import TitleBar from "./TitleBar.svelte";

  type View = "home" | "all" | "calendar" | "countdown" | "settings" | "folders";
  /** 「全部」頁的篩選：未完成、沒有期限、已完成 */
  type AllFilter = "open" | "nodue" | "done";

  let view = $state<View>("home");
  let allFilter = $state<AllFilter>("open");
  /** 「全部」頁依資料夾、標籤篩選；scopeTag 可能在資料夾裡，也可能是未分類的 */
  let scopeFolder = $state<string | null>(null);
  let scopeTag = $state<string | null>(null);
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
  /** 電腦版：側邊欄收合成只剩圖示（每台電腦各自記住） */
  let narrow = $state(readFlag("main.sidebarCollapsed"));
  /** 電腦版的搜尋框平常收起來，按 Ctrl+F 才打開 */
  let searchOpen = $state(false);
  const showSearch = $derived(searchOpen || !!query);

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
  // 依標籤、資料夾篩選時也列出還沒輪到的步驟（淡色顯示）：它的前一步可能是別的標籤，不列出來就找不到了
  const countOf = (tag: string) => store.allOpen.filter((t) => t.tag === tag).length;
  /** 「全部」頁的標籤列：資料夾（含還沒有待辦的標籤），接著是未分類的標籤 */
  const groups = $derived(
    store.folders.map((f) => {
      const tags = f.tags.map((tag) => ({ tag, count: countOf(tag) }));
      return { name: f.name, all: new Set(f.tags), tags, count: tags.reduce((n, t) => n + t.count, 0) };
    }),
  );
  const looseCounts = $derived(store.looseTags.map((tag) => ({ tag, count: countOf(tag) })));
  const current = $derived(groups.find((g) => g.name === scopeFolder));
  const scoped = $derived(!!scopeTag || !!current);
  const inScope = (t: Todo) => (scopeTag ? t.tag === scopeTag : current ? !!t.tag && current.all.has(t.tag) : true);
  const scopeOpen = $derived(scoped ? store.allOpen.filter(inScope) : open);
  const scopeDone = $derived(scoped ? store.done.filter(inScope) : store.done);

  const allFilters = $derived<{ id: AllFilter; label: string; count: number }[]>([
    { id: "open", label: "未完成", count: scopeOpen.length },
    { id: "nodue", label: "沒有期限", count: scopeOpen.filter((t) => !t.due).length },
    { id: "done", label: "已完成", count: scopeDone.length },
  ]);
  /** 「全部」頁只看已完成的 */
  const doneOnly = $derived(view === "all" && allFilter === "done");

  function readFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function toggleSidebar() {
    narrow = !narrow;
    try {
      localStorage.setItem("main.sidebarCollapsed", narrow ? "1" : "0");
    } catch {}
  }

  async function openSearch() {
    if (narrow) toggleSidebar();
    searchOpen = true;
    await tick();
    search?.focus();
  }

  /** 再按一次已選的資料夾就取消 */
  function pickFolder(name: string) {
    scopeFolder = scopeFolder === name && !scopeTag ? null : name;
    scopeTag = null;
    showDone = false;
  }

  function pickTag(tag: string) {
    scopeTag = scopeTag === tag ? null : tag;
    showDone = false;
  }

  function pickLoose(tag: string) {
    scopeFolder = null;
    pickTag(tag);
  }

  function clearScope() {
    scopeFolder = null;
    scopeTag = null;
    showDone = false;
  }

  function matches(t: Todo): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [t.title, t.note, t.tag].some((s) => s?.toLowerCase().includes(q));
  }

  /** 每個頁面要顯示的內容 */
  const page = $derived.by(() => {
    switch (view) {
      case "home":
        // 主頁的內容在 Home.svelte，這裡只用標題
        return { title: "主頁", sub: "", todos: [], done: null, defaultTag: null, defaultDue: null, empty: "" };
      case "calendar":
        return { title: "日曆", sub: "", todos: [], done: null, defaultTag: null, defaultDue: null, empty: "" };
    }
    const where = scopeTag ? `#${scopeTag}・` : current ? `${current.name}・` : "";
    const todos = scoped ? scopeOpen : list;
    if (allFilter === "nodue")
      return { title: "全部", sub: `${where}沒有期限的待辦`, todos: todos.filter((t) => !t.due), done: null, defaultTag: scopeTag, defaultDue: null, empty: "每件事都排好期限了" };
    if (allFilter === "done")
      return {
        title: "全部",
        sub: `${where}最近 ${doneDays} 天完成 ${scopeDone.length} 項・更早的紀錄保存在雲端`,
        todos: [],
        done: scopeDone,
        defaultTag: null,
        defaultDue: null,
        empty: `最近 ${doneDays} 天沒有完成的項目`,
      };
    // 已完成的改用上面的篩選看
    return {
      title: "全部",
      sub: `${where}${scopeOpen.length} 項待辦`,
      todos,
      done: null,
      defaultTag: scopeTag,
      defaultDue: null,
      empty: scopeTag
        ? "這個標籤沒有待辦"
        : current
          ? current.tags.length
            ? "這個資料夾沒有待辦"
            : "這個資料夾還沒有標籤\n按「整理」把標籤放進來"
          : "沒有待辦事項\n享受一下空白吧",
    };
  });

  // 篩選中的資料夾被改名或刪除、標籤沒有了就取消篩選
  $effect(() => {
    if (scopeFolder && !current) scopeFolder = null;
    const pool = current ? current.tags.map((t) => t.tag) : store.looseTags;
    if (scopeTag && !pool.includes(scopeTag)) scopeTag = null;
  });

  function go(v: View) {
    // 從別頁回到「全部」時從未完成開始看
    if (v !== view) allFilter = "open";
    view = v;
    showDone = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (view === "settings" || view === "folders" || view === "countdown") go("home");
      else if (doneOnly) allFilter = "open";
      queueMicrotask(() => quickAdd?.focus());
    } else if (e.ctrlKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openSearch();
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

{#snippet banners()}
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
{/snippet}

<div class="app">
  <TitleBar />
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
    <aside class:narrow>
      <div class="side-top">
        <button class="icon-btn" onclick={toggleSidebar} aria-label={narrow ? "展開側欄" : "收合側欄"} title={narrow ? "展開側欄" : "收合側欄（Ctrl+F 搜尋）"} aria-expanded={!narrow}>
          <Icon name="menu" size={18} />
        </button>
      </div>
      {#if showSearch && !narrow}
        <label class="search">
          <Icon name="search" size={14} />
          <input
            bind:this={search}
            bind:value={query}
            placeholder="搜尋"
            onkeydown={(e) => e.key === "Escape" && ((query = ""), (searchOpen = false))}
            onblur={() => !query && (searchOpen = false)}
          />
        </label>
      {/if}

      <nav>
        {#each nav as n (n.id)}
          <button class="nav" class:on={view === n.id || (n.id === "all" && view === "folders")} onclick={() => go(n.id)} title={narrow ? n.label : undefined}>
            <span class="nicon" class:accent={n.id === "home"}><Icon name={n.icon} /></span>
            <span class="nlabel">{n.label}</span>
            {#if n.count()}<span class="ncount" class:warn={n.id === "home" && store.overdueCount}>{n.count()}</span>{/if}
          </button>
        {/each}
      </nav>

      <div class="side-foot">
        <SyncStatus compact={narrow} />
        <button class="icon-btn" class:on={view === "settings"} onclick={() => go("settings")} aria-label="設定" title="設定">
          <Icon name="settings" />
        </button>
      </div>
    </aside>

    <main>
      {#if view === "settings"}
        <div class="scroll"><Settings onsetup={(mode) => (wizard = mode)} /></div>
      {:else if view === "home"}
        <Home bind:this={quickAdd} {today} {matches} top={banners} oncountdowns={() => go("countdown")} />
      {:else if view === "countdown"}
        <div class="scroll"><Countdowns {today} /></div>
      {:else if view === "folders"}
        <Folders onupdatecloud={() => (wizard = "update")} onback={() => go("all")} />
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
              {#if store.tags.length || store.folders.length}
                <nav class="chips" aria-label="依資料夾或標籤篩選">
                  <button class="chip" class:on={!scoped} onclick={clearScope}>所有標籤</button>
                  {#each groups as g (g.name)}
                    <button class="chip" class:on={scopeFolder === g.name && !scopeTag} class:open={scopeFolder === g.name} onclick={() => pickFolder(g.name)}>
                      <Icon name="folder" size={13} /><span class="clip" title={g.name}>{g.name}</span>{#if g.count}<span class="n">{g.count}</span>{/if}
                    </button>
                  {/each}
                  {#each looseCounts as t (t.tag)}
                    <button class="chip" class:idle={!t.count} class:on={!scopeFolder && scopeTag === t.tag} onclick={() => pickLoose(t.tag)}>
                      <span class="clip" title="#{t.tag}">#{t.tag}</span>{#if t.count}<span class="n">{t.count}</span>{/if}
                    </button>
                  {/each}
                  <button class="tidy" onclick={() => go("folders")} title="用資料夾整理標籤">整理</button>
                </nav>
                {#if current?.tags.length}
                  <nav class="chips sub" aria-label="「{current.name}」裡的標籤">
                    {#each current.tags as t (t.tag)}
                      <button class="chip" class:idle={!t.count} class:on={scopeTag === t.tag} onclick={() => pickTag(t.tag)}>
                        <span class="clip" title="#{t.tag}">#{t.tag}</span>{#if t.count}<span class="n">{t.count}</span>{/if}
                      </button>
                    {/each}
                  </nav>
                {/if}
              {/if}
            {/if}
            {#if view === "calendar"}
              <Calendar bind:this={quickAdd} {today} {matches} searching={!!query.trim()} />
            {:else}
            {#if !doneOnly}
              <QuickAdd bind:this={quickAdd} defaultTag={page.defaultTag} defaultDue={page.defaultDue} />
            {/if}
            {#key `${view}:${allFilter}:${scopeFolder}:${scopeTag}`}
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
    transition: width 0.18s ease;
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 4px 0 10px 10px;
    overflow-y: auto;
    /* 捲軸的寬度（10px）一直留著，代替右邊的 padding；展開資料夾、出現捲軸時才不會跳 */
    scrollbar-gutter: stable;
  }
  .side-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 2px 10px;
  }
  .side-top .icon-btn {
    width: 36px;
    height: 34px;
  }
  /* 收合的側欄：只剩圖示 */
  aside.narrow {
    width: 60px;
    padding-left: 8px;
    padding-right: 8px;
  }
  aside.narrow .nav {
    justify-content: center;
    padding: 0;
  }
  aside.narrow .nlabel,
  aside.narrow .ncount {
    display: none;
  }
  /* 收合時逾期的數字改成一個小點 */
  aside.narrow .ncount.warn {
    display: block;
    position: absolute;
    top: 7px;
    right: 9px;
    width: 7px;
    height: 7px;
    padding: 0;
    border-radius: 50%;
    background: var(--warn);
    font-size: 0;
  }
  aside.narrow .side-foot {
    flex-direction: column;
    gap: 6px;
  }
  .search {
    /* 側邊欄變矮時不要被壓扁 */
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
    scrollbar-gutter: stable;
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
  /* 「全部」頁的資料夾、標籤 */
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 0 2px 14px;
  }
  .chips.sub {
    gap: 5px;
    margin-top: -6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12.5px;
    color: var(--sub);
    box-shadow: inset 0 0 0 1px var(--line);
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }
  .chips.sub .chip {
    height: 24px;
    padding: 0 9px;
    font-size: 12px;
  }
  .chip:hover {
    color: var(--text);
    background: var(--hover);
  }
  /* 名稱太長時截斷 */
  .chip .clip {
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip .n {
    font-size: 11px;
    opacity: 0.75;
  }
  .chip.on {
    background: var(--text);
    color: var(--bg);
    box-shadow: none;
  }
  /* 資料夾展開、但選的是裡面的某個標籤 */
  .chip.open:not(.on) {
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--text);
  }
  /* 還沒有待辦的標籤 */
  .chip.idle:not(.on) {
    color: var(--faint);
  }
  .tidy {
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 12.5px;
    color: var(--faint);
  }
  .tidy:hover {
    color: var(--accent);
    background: var(--hover);
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
