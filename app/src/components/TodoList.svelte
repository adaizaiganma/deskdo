<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly, slide } from "svelte/transition";
  import { groupOf, groupTodos, type GroupKey } from "../lib/dates";
  import type { Todo } from "../lib/types";
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

<div class="list">
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
