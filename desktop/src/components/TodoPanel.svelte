<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { untrack } from "svelte";
  import { fade, slide } from "svelte/transition";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import Icon from "./Icon.svelte";
  import QuickAdd from "./QuickAdd.svelte";
  import Toast from "./Toast.svelte";
  import TodoList from "./TodoList.svelte";

  /**
   * 桌面小工具的內容：資料夾／標籤篩選、待辦清單、快速新增。
   * 桌面小工具和主頁右半邊共用。
   */
  interface Props {
    /** 「已完成」展開狀態存在 localStorage 的哪個 key */
    doneKey: string;
    /** 搜尋：只顯示符合的待辦 */
    matches?: (t: Todo) => boolean;
  }
  let { doneKey, matches = () => true }: Props = $props();

  /** 選中的資料夾；tag 是選中的標籤（可能在資料夾裡，也可能是未分類的） */
  let folder = $state<string | null>(null);
  let filter = $state<string | null>(null);
  let showDone = $state(untrack(() => readFlag(doneKey)));
  let quickAdd = $state<ReturnType<typeof QuickAdd>>();

  export function focus() {
    quickAdd?.focus();
  }

  // 依標籤、資料夾篩選時，也列出還沒輪到的步驟（淡色顯示）：它的前一步可能是別的標籤，不列出來就找不到了
  const countOf = (tag: string) => store.allOpen.filter((t) => t.tags.includes(tag)).length;
  const withCounts = (tags: string[]) => tags.map((tag) => ({ tag, count: countOf(tag) }));
  /** 第一排：有標籤的資料夾（裡面的標籤還沒有待辦也列出），接著是不在資料夾裡的標籤 */
  const groups = $derived(
    store.folders
      .filter((f) => f.tags.length)
      .map((f) => {
        const tags = withCounts(f.tags);
        const all = new Set(f.tags);
        // 有好幾個標籤在同一個資料夾的待辦只算一次
        return { name: f.name, all, tags, count: store.allOpen.filter((t) => t.tags.some((g) => all.has(g))).length };
      }),
  );
  const loose = $derived(withCounts(store.looseTags).filter((f) => f.count > 0));
  const current = $derived(groups.find((g) => g.name === folder));

  const match = (t: Todo) => (filter ? t.tags.includes(filter) : current ? t.tags.some((g) => current.all.has(g)) : true);
  const todos = $derived((filter || current ? store.allOpen.filter(match) : store.open).filter(matches));
  // 只看今天完成的（確認剛剛勾了什麼、順手復原），完整紀錄在「全部」
  const done = $derived(store.doneToday.filter(match).filter(matches));

  // 篩選中的資料夾或標籤沒有項目了就往上一層退
  $effect(() => {
    if (folder && !current) folder = null;
    const pool = current ? current.tags : loose;
    if (filter && !pool.some((f) => f.tag === filter)) filter = null;
  });

  // 從別的地方要展開某一筆（例如主頁的矩陣），但它不在目前的篩選裡：取消篩選
  $effect(() => {
    const id = store.focus;
    if (!id) return;
    untrack(() => {
      const t = store.find(id);
      if (t && (filter || folder) && !match(t)) {
        folder = null;
        filter = null;
      }
    });
  });

  function pickFolder(name: string) {
    const again = folder === name && !filter;
    folder = again ? null : name;
    filter = null;
  }

  function pickTag(tag: string) {
    filter = filter === tag ? null : tag;
  }

  function pickLoose(tag: string) {
    folder = null;
    pickTag(tag);
  }

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
      localStorage.setItem(doneKey, showDone ? "1" : "0");
    } catch {}
  }
</script>

{#if groups.length || loose.length}
  <nav class="chips" aria-label={t("依資料夾或標籤篩選", "Filter by folder or tag")} use:wheelToHorizontal>
    <button class="chip" class:on={!folder && !filter} onclick={() => ((folder = null), (filter = null))}>
      {t("全部", "All")}<span class="n">{store.open.length}</span>
    </button>
    {#each groups as g (g.name)}
      <button class="chip" class:on={folder === g.name && !filter} class:open={folder === g.name} onclick={() => pickFolder(g.name)}>
        <Icon name="folder" size={13} /><span class="clip" title={g.name}>{g.name}</span><span class="n">{g.count}</span>
      </button>
    {/each}
    {#each loose as f (f.tag)}
      <button class="chip" class:on={!folder && filter === f.tag} onclick={() => pickLoose(f.tag)}>
        <span class="clip" title="#{f.tag}">#{f.tag}</span><span class="n">{f.count}</span>
      </button>
    {/each}
  </nav>
  {#if current}
    <nav class="chips sub-chips" aria-label={t(`「${current.name}」裡的標籤`, `Tags in "${current.name}"`)} use:wheelToHorizontal transition:slide={{ duration: 140 }}>
      {#each current.tags as f (f.tag)}
        <button class="chip" class:idle={!f.count} class:on={filter === f.tag} onclick={() => pickTag(f.tag)}>
          <span class="clip" title="#{f.tag}">#{f.tag}</span><span class="n">{f.count}</span>
        </button>
      {/each}
    </nav>
  {/if}
{/if}

<div class="scroll-wrap">
  <div class="scroll">
    {#if store.snap.todos.length === 0 && store.snap.status === "syncing"}
      <div class="loading" in:fade>{t("載入中…", "Loading…")}</div>
    {:else}
      <TodoList
        {todos}
        {done}
        today={store.today}
        {showDone}
        ontoggledone={toggleDone}
        emptyText={store.prefs && !store.prefs.configured
          ? t("還沒完成設定\n請在主視窗完成設定精靈", "Not set up yet\nFinish the setup wizard in the main window")
          : filter
            ? t("這個標籤沒有待辦", "No to-dos with this tag")
            : folder
              ? t("這個資料夾沒有待辦", "No to-dos in this folder")
              : t("沒有待辦事項\n享受一下空白吧", "No to-dos\nEnjoy the empty space")}
      />
    {/if}
  </div>
  <Toast />
</div>

<footer>
  <QuickAdd bind:this={quickAdd} defaultTag={filter} />
</footer>

<style>
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
  /* 名稱太長時截斷，整排還是可以左右捲動 */
  .chip .clip {
    max-width: 11em;
  }
  .chip .n {
    font-size: 11px;
    opacity: 0.75;
  }
  .chip.on {
    background: var(--text);
    color: var(--bg);
  }
  /* 資料夾展開、但選的是裡面的某個標籤 */
  .chip.open:not(.on) {
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--text);
  }
  .sub-chips {
    gap: 5px;
    margin-top: -2px;
  }
  .sub-chips .chip {
    height: 24px;
    padding: 0 9px;
    font-size: 12px;
  }
  /* 資料夾裡還沒有待辦的標籤 */
  .chip.idle:not(.on) {
    color: var(--faint);
  }

  .scroll-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  /* 捲軸的寬度一直留著（右邊的 padding 由它代替），展開待辦、出現捲軸時字才不會跳 */
  .scroll {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
    padding: 0 0 0 8px;
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
