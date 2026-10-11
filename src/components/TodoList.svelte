<script lang="ts">
  import { untrack } from "svelte";
  import { flip } from "svelte/animate";
  import { fly, slide } from "svelte/transition";
  import { closeOnBack } from "../lib/back.svelte";
  import { groupOf, groupTodos, type GroupKey } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import Icon from "./Icon.svelte";
  import TodoRow from "./TodoRow.svelte";

  interface Props {
    /** 未完成的項目，依期限分組顯示 */
    todos: Todo[];
    /** 已完成的項目；null 表示不顯示這一區 */
    done?: Todo[] | null;
    today: string;
    /** 已完成區是否展開；不傳則固定展開、不顯示收合按鈕 */
    showDone?: boolean;
    ontoggledone?: () => void;
    doneLimit?: number;
    emptyText?: string;
    /** 只有一組時不顯示分組標題（例如「已完成」頁面） */
    flat?: boolean;
  }
  let {
    todos,
    done = null,
    today,
    showDone,
    ontoggledone,
    doneLimit = 30,
    emptyText = "沒有待辦事項",
    flat = false,
  }: Props = $props();

  let editingId = $state<string | null>(null);
  let pinned = $state<{ id: string; key: GroupKey } | null>(null);
  const groups = $derived(groupTodos(todos, today, pinned));

  function setEditing(id: string | null) {
    editingId = id;
    const t = id ? todos.find((x) => x.id === id) : undefined;
    pinned = t ? { id: t.id, key: groupOf(t.due, today) } : null;
  }
  closeOnBack("editor", () => !!editingId, () => setEditing(null));

  // 要展開的那一筆（從主畫面小工具或日曆點進來）：展開並捲到看得到的地方。剛打開 App 時資料可能還沒載入，等找到為止
  $effect(() => {
    const id = store.focus;
    if (!id) return;
    const t = store.find(id);
    if (!t) {
      if (store.snap.status !== "syncing") store.focus = null;
      return;
    }
    untrack(() => {
      store.focus = null;
      if (t.done) return;
      setEditing(id);
      // 等展開的動畫跑完再捲，位置才準
      setTimeout(() => document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 240);
    });
  });
  /**
   * 正在編輯、但不在清單上的步驟（還沒輪到，平常藏起來）：
   * 暫時顯示在它那一串目前可以做的那一步下方；那一步不在這個清單上時，顯示在最上面。
   */
  const peek = $derived(editingId && !todos.some((t) => t.id === editingId) ? store.find(editingId) : undefined);
  const peekHead = $derived(peek && !peek.done ? store.headOf(peek).id : null);
  const peekOnTop = $derived(!!peek && !peek.done && !todos.some((t) => t.id === peekHead));

  const doneShown = $derived(done ? done.slice(0, doneLimit) : []);
  const doneOpen = $derived(showDone ?? true);

  // 點到編輯中那一列以外的地方就收合
  function onPointerDown(e: PointerEvent) {
    if (!editingId) return;
    const target = e.target as HTMLElement;
    if (!target.closest(`[data-row="${CSS.escape(editingId)}"]`)) setEditing(null);
  }
</script>

<svelte:window onpointerdown={onPointerDown} />

{#snippet peekRow(t: Todo)}
  <!-- 換到同一串的另一步時重建，才會重新載入標題、備註的草稿 -->
  {#key t.id}
    <div class="peek" transition:slide={{ duration: 180 }}>
      <TodoRow todo={t} {today} editing onedit={setEditing} />
    </div>
  {/key}
{/snippet}

<div class="list">
  {#if peek && peekOnTop}{@render peekRow(peek)}{/if}
  {#each groups as g (g.key)}
    <section transition:slide={{ duration: 200 }}>
      {#if !flat}
        <h3 class="ghead">
          <span class={g.tone}>{g.label}</span>
          {#if g.sub}<span class="gsub">{g.sub}</span>{/if}
          <span class="gcount">{g.items.length}</span>
        </h3>
      {/if}
      {#each g.items as t (t.id)}
        <div animate:flip={{ duration: 220 }} in:fly={{ y: -8, duration: 260 }} out:slide={{ duration: 220 }}>
          <TodoRow todo={t} {today} editing={editingId === t.id} onedit={setEditing} />
          {#if peek && !peekOnTop && peekHead === t.id}{@render peekRow(peek)}{/if}
        </div>
      {/each}
    </section>
  {/each}

  {#if groups.length === 0 && !(done && done.length && !ontoggledone)}
    <div class="empty">{emptyText}</div>
  {/if}

  {#if done && done.length}
    {#if ontoggledone}
      <button class="done-toggle" onclick={ontoggledone} aria-expanded={doneOpen}>
        <span class="chev" class:down={doneOpen}><Icon name="chevron" size={12} stroke={1.8} /></span>
        已完成 {done.length}
      </button>
    {/if}
    {#if doneOpen}
      <div transition:slide={{ duration: 200 }}>
        {#each doneShown as t (t.id)}
          <div animate:flip={{ duration: 220 }} in:fly={{ y: -8, duration: 260 }} out:slide={{ duration: 220 }}>
            <TodoRow todo={t} {today} editing={false} onedit={() => {}} />
          </div>
        {/each}
        {#if done.length > doneShown.length}
          <p class="more">還有 {done.length - doneShown.length} 項較早完成的項目</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .list {
    padding-bottom: 16px;
  }
  section {
    margin-bottom: 2px;
  }
  /* 平常藏起來的步驟，編輯時暫時縮排顯示在前一步下方 */
  .peek {
    margin-left: 22px;
  }
  .ghead {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    padding: 14px 10px 4px;
    font-size: 12px;
    font-weight: 700;
    color: var(--sub);
    letter-spacing: 0.02em;
  }
  .ghead .warn {
    color: var(--warn);
  }
  .ghead .accent {
    color: var(--accent);
  }
  .gsub {
    font-weight: 400;
    color: var(--faint);
  }
  .gcount {
    margin-left: auto;
    font-weight: 400;
    color: var(--faint);
  }
  .empty {
    padding: 56px 0;
    text-align: center;
    color: var(--sub);
    font-size: 13px;
    line-height: 1.8;
    white-space: pre-line;
  }
  .done-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 14px 10px 4px;
    height: 28px;
    font-size: 12px;
    font-weight: 700;
    color: var(--faint);
  }
  .done-toggle:hover {
    color: var(--sub);
  }
  .chev {
    display: grid;
    transition: transform 0.2s;
  }
  .chev.down {
    transform: rotate(90deg);
  }
  .more {
    margin: 6px 10px;
    font-size: 12px;
    color: var(--faint);
  }
</style>
