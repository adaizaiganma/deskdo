<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  /** 頁面上方的列：左邊是選單（打開抽屜）或返回，接著是標題，右邊放動作按鈕 */
  interface Props {
    title?: string;
    lead?: "menu" | "back" | null;
    onlead?: () => void;
    /** 取代標題的內容（例如搜尋框） */
    children?: Snippet;
    actions?: Snippet;
  }
  let { title = "", lead = "menu", onlead, children, actions }: Props = $props();
</script>

<header class="top">
  {#if lead}
    <button class="icon-btn lead" onclick={onlead} aria-label={lead === "menu" ? "打開選單" : "返回"}>
      <Icon name={lead === "menu" ? "menu" : "back"} size={24} />
    </button>
  {:else}
    <span class="pad"></span>
  {/if}
  {#if children}
    <div class="slot">{@render children()}</div>
  {:else}
    <h1 class="clip">{title}</h1>
  {/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 64px;
    padding: 0 4px;
  }
  .lead {
    color: var(--text);
  }
  .pad {
    width: 12px;
  }
  h1,
  .slot {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 500;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 4px;
  }
  .actions :global(.icon-btn) {
    color: var(--text);
  }
</style>
