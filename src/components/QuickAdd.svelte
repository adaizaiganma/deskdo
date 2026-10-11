<script lang="ts">
  import { relativeDue } from "@deskdo/core/dates";
  import { parseSteps } from "@deskdo/core/quickadd";
  import { store } from "@deskdo/core/store.svelte";
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

  const steps = $derived(parseSteps(text, store.today));
  const parsed = $derived(steps?.[0] ?? null);
  const tag = $derived(parsed?.tag ?? (text.trim() ? defaultTag : null));
  const due = $derived(parsed?.due ?? (text.trim() ? defaultDue : null));

  export function focus() {
    input?.focus();
  }

  function submit() {
    if (!steps) return;
    // 雲端還不支援時保留輸入內容，提示先更新
    if (steps.some((s) => s.priority === "low") && !store.canUseLow()) return;
    if (steps.length > 1 && !store.canUseSteps()) return;
    // 預設的標籤和期限（目前篩選中的標籤、所在頁面的日期）只補在沒寫的步驟上
    const filled = steps.map((s) => ({
      ...s,
      ...(!s.tag && defaultTag ? { tag: defaultTag } : {}),
      ...(!s.due && defaultDue ? { due: defaultDue } : {}),
    }));
    if (filled.length > 1) store.addSteps(filled);
    else store.add(filled[0]);
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
    <input bind:this={input} bind:value={text} onkeydown={onKey} placeholder="新增待辦" aria-label="新增待辦" enterkeyhint="send" />
  </label>
  <div class="meta">
    <span class="hint" title="例如：交報告 #電路學 @週五 !">
      <span><b>#</b>標籤</span>
      <span title="@今天 @明天 @週五 @下週三 @10/15"><b>@</b>期限</span>
      <span><b>!</b>高優先</span>
      <span><b>~</b>低優先</span>
      <span title="例如：做預報 &gt; 印預報"><b>&gt;</b>下一步</span>
    </span>
    {#if due}<span class="chip"><Icon name="calendar" size={11} stroke={1.7} />{relativeDue(due, store.today)}</span>{/if}
    {#if tag}<span class="chip" title="#{tag}"><span class="clip">#{tag}</span></span>{/if}
    {#if parsed?.priority === "high"}<span class="chip warn">高優先</span>{/if}
    {#if parsed?.priority === "low"}<span class="chip low">低優先</span>{/if}
    {#if steps && steps.length > 1}<span class="chip"><span class="clip">{steps.length} 個步驟：{steps.map((s) => s.title).join(" → ")}</span></span>{/if}
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
    max-width: 100%;
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
  .chip.low {
    background: var(--bg2);
    color: var(--sub);
  }
  .hint {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    color: var(--faint);
  }
  .hint b {
    font-weight: 700;
    color: var(--accent);
    margin-right: 2px;
  }
</style>
