<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly, slide } from "svelte/transition";
  import { groupTodos } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo } from "@deskdo/core/types";
  import Icon from "./Icon.svelte";
  import TodoItem from "./TodoItem.svelte";

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
    /** 不顯示分組標題（例如日曆上的某一天） */
    flat?: boolean;
  }
  let { todos, done = null, today, showDone, ontoggledone, doneLimit = 50, emptyText = "沒有待辦事項", flat = false }: Props = $props();

  const groups = $derived(groupTodos(todos, today, null, store.now));
  const doneShown = $derived(done ? done.slice(0, doneLimit) : []);
  const doneOpen = $derived(showDone ?? true);
</script>

<div class="groups">
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
          <TodoItem todo={t} {today} />
        </div>
      {/each}
    </section>
  {/each}

  {#if groups.length === 0 && !(done && done.length && !ontoggledone)}
    <p class="empty">{emptyText}</p>
  {/if}

  {#if done && done.length}
    {#if ontoggledone}
      <button class="done-toggle" onclick={ontoggledone} aria-expanded={doneOpen}>
        <span class="chev" class:down={doneOpen}><Icon name="chevron" size={14} stroke={1.8} /></span>
        已完成 {done.length}
      </button>
    {/if}
    {#if doneOpen}
      <div transition:slide={{ duration: 200 }}>
        {#each doneShown as t (t.id)}
          <div animate:flip={{ duration: 220 }} in:fly={{ y: -8, duration: 260 }} out:slide={{ duration: 220 }}>
            <TodoItem todo={t} {today} />
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
  .ghead {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    padding: 16px 20px 2px;
    font-size: 14px;
    font-weight: 700;
  }
  .ghead .warn {
    color: var(--warn);
  }
  .ghead .accent {
    color: var(--accent);
  }
  .gsub {
    font-size: 12px;
    font-weight: 400;
    color: var(--sub);
  }
  .gcount {
    margin-left: auto;
    font-size: 12px;
    font-weight: 400;
    color: var(--sub);
  }
  .empty {
    margin: 0;
    padding: 48px 24px;
    text-align: center;
    color: var(--sub);
    font-size: 14px;
    line-height: 1.8;
    white-space: pre-line;
  }
  .done-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 20px;
    font-size: 14px;
    font-weight: 700;
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
    margin: 8px 20px;
    font-size: 13px;
    color: var(--sub);
  }
</style>
