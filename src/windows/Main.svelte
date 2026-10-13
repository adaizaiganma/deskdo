<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import AddSheet from "../components/AddSheet.svelte";
  import BottomNav, { type Tab } from "../components/BottomNav.svelte";
  import Drawer from "../components/Drawer.svelte";
  import Icon from "../components/Icon.svelte";
  import Toast from "../components/Toast.svelte";
  import TodoDetail from "../components/TodoDetail.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { closeOnBack } from "../lib/back.svelte";
  import { ui } from "../lib/ui.svelte";
  import CalendarView from "./CalendarView.svelte";
  import Countdowns from "./Countdowns.svelte";
  import Folders from "./Folders.svelte";
  import Home from "./Home.svelte";
  import ListPage from "./ListPage.svelte";
  import Settings from "./Settings.svelte";
  import Setup from "./Setup.svelte";

  /** 子頁面（蓋在分頁上，左上角是返回）：設定、整理標籤、某個標籤或資料夾、搜尋 */
  type Page = "settings" | "folders" | "search" | `tag:${string}` | `folder:${string}`;
  /** 「全部」頁的篩選：未完成、沒有期限、已完成 */
  type AllFilter = "open" | "nodue" | "done";

  let tab = $state<Tab>("home");
  let page = $state<Page | null>(null);
  let drawer = $state(false);
  let allFilter = $state<AllFilter>("open");
  let showDone = $state(false);
  let query = $state("");
  let searchBox = $state<HTMLInputElement>();
  /**
   * 設定精靈：new = 第一次設定，update = 更新雲端。
   * 精靈部署到一半就會寫入設定（configured 變成 true），所以用自己的狀態決定何時關閉。
   */
  let wizard = $state<"new" | "update" | null>(null);

  const needsSetup = $derived(!!store.prefs && !store.prefs.configured);
  $effect(() => {
    if (needsSetup && !wizard) wizard = "new";
  });
  const today = $derived(store.today);
  const doneDays = $derived(store.prefs?.doneSyncDays ?? 30);

  // 按返回：先關子頁面，再從其他分頁回到主頁，最後才離開 App
  closeOnBack("page", () => !!page, () => (page = null));
  closeOnBack("tab", () => tab !== "home", () => (tab = "home"));

  function goTab(t: Tab) {
    // 從別頁回到「全部」時從未完成開始看
    if (t !== tab) allFilter = "open";
    tab = t;
    page = null;
    showDone = false;
  }

  function goPage(p: string) {
    page = p as Page;
    drawer = false;
    showDone = false;
    if (p === "search") {
      query = "";
      queueMicrotask(() => searchBox?.focus());
    }
  }

  // 正在看的資料夾被改名或刪除了就關掉
  $effect(() => {
    if (page?.startsWith("folder:") && !store.folders.some((f) => `folder:${f.name}` === page)) page = null;
  });

  function matches(t: Todo): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return [t.title, t.note, ...t.tags].some((s) => s?.toLowerCase().includes(q));
  }

  const allChips = $derived([
    { id: "open", label: t("未完成", "Open"), count: store.open.length },
    { id: "nodue", label: t("沒有期限", "No due date"), count: store.open.filter((t) => !t.due).length },
    { id: "done", label: t("已完成", "Done"), count: store.done.length },
  ]);

  /** 標籤、資料夾頁的內容；標籤頁也列出還沒輪到的步驟（它的前一步可能是別的標籤） */
  const sub = $derived.by(() => {
    if (page?.startsWith("tag:")) {
      const tag = page.slice(4);
      const has = (t: Todo) => t.tags.includes(tag);
      return { title: `#${tag}`, todos: store.allOpen.filter(has), done: store.done.filter(has), tag, empty: t("這個標籤沒有待辦", "No to-dos with this tag") };
    }
    if (page?.startsWith("folder:")) {
      const name = page.slice(7);
      const tags = new Set(store.folders.find((f) => f.name === name)?.tags);
      const has = (t: Todo) => t.tags.some((g) => tags.has(g));
      return {
        title: name,
        todos: store.allOpen.filter(has),
        done: store.done.filter(has),
        tag: null,
        empty: tags.size ? t("這個資料夾沒有待辦", "No to-dos in this folder") : t("這個資料夾還沒有標籤\n到「整理標籤」把標籤放進來", "This folder has no tags yet\nAdd some in Organize tags"),
      };
    }
    return null;
  });

  onMount(() => {
    const off = listen<string>("navigate", (e) => {
      const v = e.payload;
      if (v === "home" || v === "all" || v === "calendar" || v === "countdown") goTab(v);
      else goPage(v);
    });
    // 從主畫面小工具點了某一筆打開 App 時，打開那一筆的詳情。剛啟動時資料可能還沒載入，等找到為止
    const openFromWidget = async () => {
      const id = await invoke<string | null>("take_widget_todo");
      if (id && !wizard) store.focus = id;
    };
    openFromWidget();
    addEventListener("deskdo-open", openFromWidget);
    return () => {
      off.then((f) => f());
      removeEventListener("deskdo-open", openFromWidget);
    };
  });

  $effect(() => {
    const id = store.focus;
    if (!id) return;
    const t = store.find(id);
    if (!t) {
      if (store.snap.status !== "syncing") store.focus = null;
      return;
    }
    store.focus = null;
    ui.openTodo(id);
  });
</script>

{#snippet banners()}
  {#if store.appUpdate}
    <button class="banner" onclick={() => store.installUpdate()}>
      <Icon name="refresh" size={20} /><span>{t(`Deskdo ${store.appUpdate.version} 推出了，按這裡下載並安裝`, `Deskdo ${store.appUpdate.version} is out. Tap to download and install`)}</span>
    </button>
  {/if}
  {#if store.cloudOutdated}
    <button class="banner" onclick={() => (wizard = "update")}>
      <Icon name="sparkle" size={20} /><span>{t("雲端有新版本，按這裡更新（需要登入 Cloudflare）", "A cloud update is available. Tap to update (needs a Cloudflare sign-in)")}</span>
    </button>
  {/if}
{/snippet}

<div class="app" style:--toast-bottom={page === "settings" || page === "folders" ? "16px" : "88px"}>
  {#if wizard}
    <div class="solo">
      <Setup
        mode={wizard}
        onfinish={() => ((wizard = null), goTab("home"))}
        oncancel={wizard === "update" ? () => (wizard = null) : undefined}
      />
    </div>
  {:else}
    <main class="stage" class:inset={!!page}>
      {#if page === "settings"}
        <div class="sub-page">
          <TopBar title={t("設定", "Settings")} lead="back" onlead={() => (page = null)} />
          <div class="scroll"><Settings onsetup={(mode) => (wizard = mode)} /></div>
        </div>
      {:else if page === "folders"}
        <div class="sub-page">
          <TopBar title={t("整理標籤", "Organize tags")} lead="back" onlead={() => (page = null)} />
          <div class="fill"><Folders onupdatecloud={() => (wizard = "update")} /></div>
        </div>
      {:else if page === "search"}
        {@const q = query.trim()}
        <ListPage
          lead="back"
          onlead={() => (page = null)}
          listKey="search"
          todos={q ? store.allOpen.filter(matches) : []}
          done={q ? store.done.filter(matches) : null}
          emptyText={q ? t(`找不到「${q}」`, `Nothing matches "${q}"`) : t("輸入標題、標籤或備註裡的字", "Search titles, tags and notes")}
          {today}
        >
          {#snippet head()}
            <input class="search" bind:this={searchBox} bind:value={query} placeholder={t("搜尋待辦", "Search to-dos")} enterkeyhint="search" aria-label={t("搜尋待辦", "Search to-dos")} />
          {/snippet}
          {#snippet actions()}
            {#if query}<button class="icon-btn" onclick={() => ((query = ""), searchBox?.focus())} aria-label={t("清除", "Clear")}><Icon name="close" size={22} /></button>{/if}
          {/snippet}
        </ListPage>
      {:else if sub}
        <ListPage
          title={sub.title}
          lead="back"
          onlead={() => (page = null)}
          sub={t(`${sub.todos.length} 項待辦`, `${sub.todos.length} to-dos`)}
          listKey={page ?? ""}
          todos={sub.todos}
          done={sub.done}
          {showDone}
          ontoggledone={() => (showDone = !showDone)}
          emptyText={sub.empty}
          {today}
          fab={{ onclick: () => ui.add({ tag: sub.tag }) }}
        />
      {:else if tab === "home"}
        <Home {today} top={banners} onmenu={() => (drawer = true)} onsearch={() => goPage("search")} onall={() => goTab("all")} oncountdowns={() => goTab("countdown")} />
      {:else if tab === "all"}
        <ListPage
          title={t("全部", "All")}
          lead="menu"
          onlead={() => (drawer = true)}
          chips={allChips}
          chip={allFilter}
          onchip={(id) => ((allFilter = id as AllFilter), (showDone = false))}
          sub={allFilter === "done" ? t(`最近 ${doneDays} 天完成 ${store.done.length} 項 · 更早的紀錄保存在雲端`, `${store.done.length} done in the last ${doneDays} days · older ones are kept in the cloud`) : undefined}
          listKey={allFilter}
          todos={allFilter === "done" ? [] : allFilter === "nodue" ? store.open.filter((t) => !t.due) : store.open}
          done={allFilter === "done" ? store.done : null}
          doneLimit={allFilter === "done" ? 300 : 50}
          emptyText={allFilter === "done" ? t(`最近 ${doneDays} 天沒有完成的項目`, `Nothing completed in the last ${doneDays} days`) : allFilter === "nodue" ? t("每件事都排好期限了", "Everything has a due date") : t("沒有待辦事項\n享受一下空白吧", "No to-dos\nEnjoy the empty space")}
          {today}
          fab={allFilter === "done" ? null : { label: t("新增待辦", "Add a to-do"), onclick: () => ui.add() }}
        >
          {#snippet actions()}
            <button class="icon-btn" onclick={() => goPage("search")} aria-label={t("搜尋", "Search")}><Icon name="search" size={24} /></button>
          {/snippet}
        </ListPage>
      {:else if tab === "calendar"}
        <CalendarView {today} onmenu={() => (drawer = true)} />
      {:else}
        <Countdowns {today} onmenu={() => (drawer = true)} />
      {/if}
      <Toast />
    </main>
    {#if !page}<BottomNav current={tab} ongo={goTab} />{/if}

    <Drawer open={drawer} current={page} onclose={() => (drawer = false)} ongo={goPage} />
    {#if ui.adding}
      <AddSheet defaultTag={ui.adding.tag} defaultDue={ui.adding.due} onclose={() => (ui.adding = null)} />
    {/if}
    {#if ui.detail}
      {#key ui.detail}
        <TodoDetail id={ui.detail} {today} />
      {/key}
    {/if}
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .solo {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--nav-inset);
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  /* 子頁面沒有底部導覽列，自己讓開系統導覽列 */
  .stage.inset {
    padding-bottom: var(--nav-inset);
  }
  .sub-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .fill {
    flex: 1;
    min-height: 0;
  }
  .search {
    width: 100%;
    height: 48px;
    padding: 0 16px;
    border: 0;
    border-radius: 24px;
    background: var(--c-high);
    font-size: 16px;
    outline: none;
  }
  .search::placeholder {
    color: var(--faint);
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    width: calc(100% - 32px);
    margin: 12px 16px 0;
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--accent-container);
    color: var(--on-accent-container);
    font-size: 14px;
    font-weight: 500;
    text-align: left;
  }
</style>
