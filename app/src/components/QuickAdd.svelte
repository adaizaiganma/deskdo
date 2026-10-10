<script lang="ts">
  import { relativeDue } from "../lib/dates";
  import { parseQuickAdd } from "../lib/quickadd";
  import { store } from "../lib/store.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    /** 沒有輸入 #標籤 時使用（例如目前篩選中的標籤） */
    defaultTag?: string | null;
    /** 沒有輸入 @期限 時使用（例如在「今天」頁面新增） */
    defaultDue?: string | null;
  }
  let { defaultTag = null, defaultDue = null }: Props = $props();

  let text = $state("");
  let input = $state<HTMLInputElement>();
  const parsed = $derived(parseQuickAdd(text, store.today));
  const tag = $derived(parsed?.tag ?? (text.trim() ? defaultTag : null));
  const due = $derived(parsed?.due ?? (text.trim() ? defaultDue : null));

  export function focus() {
    input?.focus();
  }

  function submit() {
    if (!parsed) return;
    store.add({
      ...parsed,
      ...(tag ? { tag } : {}),
      ...(due ? { due } : {}),
    });
    text = "";
  }

  function onKey(e: KeyboardEvent) {
    // 中文輸入法選字時按 Enter 不要送出
    if (e.isComposing) return;
    if (e.key === "Enter") submit();
    if (e.key === "Escape") text = "";
  }
</script>

<div class="quick">
  <label class="box">
    <span class="plus"><Icon name="plus" size={16} stroke={1.8} /></span>
    <input bind:this={input} bind:value={text} onkeydown={onKey} placeholder="新增待辦，按 Enter 送出" aria-label="新增待辦" />
  </label>
  <div class="meta">
    {#if !text.trim()}
      <span class="hint">試試 <b>交報告 #電路學 @週五 !</b></span>
    {:else}
      {#if due}<span class="chip"><Icon name="calendar" size={11} stroke={1.7} />{relativeDue(due, store.today)}</span>{/if}
      {#if tag}<span class="chip">#{tag}</span>{/if}
      {#if parsed?.priority === "high"}<span class="chip warn">高優先</span>{/if}
    {/if}
  </div>
</div>

<style>
  .box {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 12px;
    border-radius: 12px;
    background: var(--bg2);
    border: 1.5px solid transparent;
    transition: border-color 0.15s, background 0.15s;
    cursor: text;
  }
  .box:focus-within {
    border-color: var(--accent);
    background: var(--raised);
  }
  .plus {
    color: var(--accent);
    display: grid;
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: 14px;
    outline: none;
  }
  input::placeholder {
    color: var(--faint);
  }
  .meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    padding: 8px 2px 0;
    min-height: 30px;
    font-size: 11.5px;
  }
  .chip {
    height: 22px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent);
    display: inline-flex;
    gap: 4px;
    align-items: center;
    animation: chip-in 0.18s ease;
  }
  .chip.warn {
    background: var(--warn-soft);
    color: var(--warn);
  }
  @keyframes chip-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  .hint {
    color: var(--faint);
  }
  .hint b {
    font-weight: 500;
    color: var(--sub);
  }
</style>
