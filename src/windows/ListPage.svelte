<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Todo } from "@deskdo/core/types";
  import Fab from "../components/Fab.svelte";
  import TodoGroups from "../components/TodoGroups.svelte";
  import TopBar from "../components/TopBar.svelte";

  /** 依期限分組的待辦清單頁：「全部」、標籤、資料夾、搜尋結果 */
  interface Props {
    title?: string;
    lead: "menu" | "back";
    onlead: () => void;
    /** 取代標題的內容（搜尋框） */
    head?: Snippet;
    actions?: Snippet;
    /** 篩選（全部頁的未完成／沒有期限／已完成） */
    chips?: { id: string; label: string; count?: number }[];
    chip?: string;
    onchip?: (id: string) => void;
    sub?: string;
    /** 換篩選時重建清單（不要播移動的動畫） */
    listKey?: string;
    todos: Todo[];
    done?: Todo[] | null;
    showDone?: boolean;
    ontoggledone?: () => void;
    doneLimit?: number;
    emptyText: string;
    today: string;
    fab?: { label?: string; onclick: () => void } | null;
  }
  let {
    title = "",
    lead,
    onlead,
    head,
    actions,
    chips,
    chip,
    onchip,
    sub,
    listKey = "",
    todos,
    done = null,
    showDone,
    ontoggledone,
    doneLimit,
    emptyText,
    today,
    fab = null,
  }: Props = $props();
</script>

<div class="page">
  <TopBar {title} {lead} {onlead} children={head} {actions} />
  {#if chips}
    <div class="chips" role="tablist" aria-label="篩選">
      {#each chips as c (c.id)}
        <button class="pill" class:on={chip === c.id} role="tab" aria-selected={chip === c.id} onclick={() => onchip?.(c.id)}>
          {c.label}{#if c.count !== undefined}<span class="n">{c.count}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
  <div class="scroll">
    {#if sub}<p class="sub">{sub}</p>{/if}
    {#key listKey}
      <TodoGroups {todos} {done} {today} {showDone} {ontoggledone} {doneLimit} {emptyText} />
    {/key}
  </div>
  {#if fab}<Fab label={fab.label} aria="新增待辦" onclick={fab.onclick} />{/if}
</div>

<style>
  .page {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .chips {
    flex: none;
    display: flex;
    gap: 8px;
    padding: 4px 16px 8px;
    overflow-x: auto;
  }
  .n {
    font-weight: 400;
    opacity: 0.85;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 96px;
  }
  .sub {
    margin: 0;
    padding: 4px 20px 0;
    font-size: 13px;
    color: var(--sub);
  }
</style>
