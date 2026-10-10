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
  import Settings from "./Settings.svelte";
  import Setup from "./Setup.svelte";
  import SyncStatus from "./SyncStatus.svelte";
  import TitleBar from "./TitleBar.svelte";

  type View = "all" | "today" | "upcoming" | "nodue" | "done" | "settings" | `tag:${string}`;

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
  const doneDays = $derived(store.prefs?.doneSyncDays ?? 30);

  const nav: { id: View; label: string; icon: IconName; count: () => number }[] = [
    { id: "today", label: "今天", icon: "sun", count: () => open.filter((t) => t.due && t.due <= today).length },
    { id: "upcoming", label: "即將到來", icon: "upcoming", count: () => open.filter((t) => t.due && t.due > today).length },
    { id: "all", label: "全部", icon: "inbox", count: () => open.length },
    { id: "nodue", label: "沒有期限", icon: "tray", count: () => open.filter((t) => !t.due).length },
    { id: "done", label: "已完成", icon: "done", count: () => 0 },
  ];

  const tagCounts = $derived(
    store.tags.map((tag) => ({ tag, count: open.filter((t) => t.tag === tag).length })),
  );

  function matches(t: Todo): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [t.title, t.note, t.tag].some((s) => s?.toLowerCase().includes(q));
  }

  /** 每個頁面要顯示的內容 */
  const page = $derived.by(() => {
    if (view.startsWith("tag:")) {
      const tag = view.slice(4);
      return {
        title: `#${tag}`,
        sub: `${open.filter((t) => t.tag === tag).length} 項待辦`,
        todos: open.filter((t) => t.tag === tag),
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
          todos: open.filter((t) => t.due && t.due <= today),
          done: store.doneToday,
          defaultTag: null,
          defaultDue: today,
          empty: "今天沒有要做的事\n可以看看「即將到來」",
        };
      case "upcoming":
        return {
          title: "即將到來",
          sub: "依期限排序",
          todos: open.filter((t) => t.due && t.due > today),
          done: null,
          defaultTag: null,
          defaultDue: null,
          empty: "接下來沒有排定期限的待辦",
        };
      case "nodue":
        return { title: "沒有期限", sub: "", todos: open.filter((t) => !t.due), done: null, defaultTag: null, defaultDue: null, empty: "每件事都排好期限了" };
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
        return { title: "全部", sub: `${open.length} 項待辦`, todos: open, done: store.done, defaultTag: null, defaultDue: null, empty: "沒有待辦事項\n享受一下空白吧" };
    }
  });

  function go(v: View) {
    view = v;
    showDone = v === "done";
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (view === "settings" || view === "done") go("today");
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

      {#if tagCounts.length}
        <h4>標籤</h4>
        <nav class="tags">
          {#each tagCounts as t (t.tag)}
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
