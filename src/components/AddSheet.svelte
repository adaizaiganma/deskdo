<script lang="ts">
  import { onMount } from "svelte";
  import { relativeDue } from "@deskdo/core/dates";
  import { parseSteps } from "@deskdo/core/quickadd";
  import { store } from "@deskdo/core/store.svelte";
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";

  /** 新增待辦的底部面板：輸入時用快速新增的語法（#標籤 @期限 ! ~ >），下面即時顯示解析的結果 */
  interface Props {
    /** 沒有輸入 #標籤 時使用（例如目前所在的標籤頁） */
    defaultTag?: string | null;
    /** 沒有輸入 @期限 時使用（例如日曆上選的那一天） */
    defaultDue?: string | null;
    onclose: () => void;
  }
  let { defaultTag = null, defaultDue = null, onclose }: Props = $props();

  let text = $state("");
  let input = $state<HTMLInputElement>();

  // 只寫時間沒寫日期時，放在預設的那天（沒有的話是今天）
  const steps = $derived(parseSteps(text, store.today, defaultDue ?? store.today));
  const parsed = $derived(steps?.[0] ?? null);
  const tags = $derived(parsed?.tags ?? (defaultTag ? [defaultTag] : []));
  const due = $derived(parsed?.due ?? defaultDue);

  /** 正在輸入的 #標籤 或 @期限，下面列出可以點的建議 */
  const partial = $derived(text.match(/(?:^|\s)([#＃@＠])(\S*)$/));
  const suggestions = $derived.by(() => {
    if (!partial) return [];
    const [, sym, q] = partial;
    if (sym === "#" || sym === "＃")
      return store.orderedTags
        .filter((t) => t !== q && t.toLowerCase().startsWith(q.toLowerCase()))
        .slice(0, 8)
        .map((t) => `#${t}`);
    return ["今天", "明天", "後天", "週五", "下週一"].filter((w) => w !== q && w.startsWith(q)).map((w) => `@${w}`);
  });

  const tokens = [
    { sym: "#", label: "標籤", insert: "#" },
    { sym: "@", label: "期限", insert: "@" },
    { sym: "!", label: "高優先", insert: "! " },
    { sym: "~", label: "低優先", insert: "~ " },
    { sym: ">", label: "下一步", insert: "> " },
  ];

  onMount(() => input?.focus());

  function insert(tok: string) {
    text = (text && !/\s$/.test(text) ? `${text} ` : text) + tok;
    input?.focus();
  }

  function complete(value: string) {
    if (!partial) return;
    text = text.slice(0, text.length - partial[1].length - partial[2].length) + value + " ";
    input?.focus();
  }

  /** 點建議、語法按鈕時不要讓輸入框失去焦點（鍵盤會收起來又跳出來） */
  function keep(e: PointerEvent) {
    e.preventDefault();
  }

  function submit() {
    if (!steps) return;
    // 雲端還不支援時保留輸入內容，提示先更新
    if (steps.some((s) => s.priority === "low") && !store.canUseLow()) return;
    if (steps.length > 1 && !store.canUseSteps()) return;
    if (steps.some((s) => s.dueTime) && !store.canUseV6("time")) return;
    if (steps.some((s) => (s.tags?.length ?? 0) > 1) && !store.canUseV6("tags")) return;
    // 預設的標籤和期限只補在沒寫的步驟上
    const filled = steps.map((s) => ({
      ...s,
      ...(!s.tags && defaultTag ? { tags: [defaultTag] } : {}),
      ...(!s.due && defaultDue ? { due: defaultDue } : {}),
    }));
    if (filled.length > 1) store.addSteps(filled);
    else store.add(filled[0]);
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    // 中文輸入法選字時按 Enter 不要送出
    if (e.isComposing) return;
    if (e.key === "Enter") submit();
  }
</script>

<Sheet label="新增待辦" {onclose}>
  <h2>新增待辦</h2>
  <label class="field">
    <span class="flabel">待辦內容</span>
    <input
      bind:this={input}
      bind:value={text}
      onkeydown={onKey}
      placeholder="例如：期中考 #電子學 @10/22 10:10 !"
      enterkeyhint="send"
      autocomplete="off"
    />
  </label>

  <div class="chips" aria-live="polite">
    {#if steps && steps.length > 1}
      <span class="chip strong clip">{steps.length} 個步驟：{steps.map((s) => s.title).join(" → ")}</span>
    {:else if parsed}
      <span class="chip strong clip">{parsed.title}</span>
    {/if}
    {#if due}<span class="chip accent"><Icon name="calendar" size={16} />{relativeDue(due, store.today, parsed?.dueTime ?? null)}</span>{/if}
    {#each tags as tag (tag)}<span class="chip clip">#{tag}</span>{/each}
    {#if parsed?.priority === "high"}<span class="chip warn"><Icon name="flag" size={14} stroke={1.8} />高優先</span>{/if}
    {#if parsed?.priority === "low"}<span class="chip">低優先</span>{/if}
  </div>

  {#if suggestions.length}
    <div class="row">
      {#each suggestions as s (s)}
        <button class="pill" onpointerdown={keep} onclick={() => complete(s)}>{s}</button>
      {/each}
    </div>
  {/if}

  <div class="row">
    {#each tokens as t (t.sym)}
      <button class="pill" onpointerdown={keep} onclick={() => insert(t.insert)}><b class:warn={t.sym === "!"}>{t.sym}</b>{t.label}</button>
    {/each}
  </div>

  <div class="actions">
    <button class="text-btn" onclick={onclose}>取消</button>
    <button class="primary" onclick={submit} disabled={!steps}>新增</button>
  </div>
</Sheet>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 16px 10px;
    border-radius: 12px 12px 0 0;
    background: var(--c-highest);
    border-bottom: 2px solid var(--accent);
  }
  .flabel {
    font-size: 12px;
    color: var(--accent);
  }
  input {
    border: 0;
    outline: 0;
    background: none;
    padding: 0;
    font-size: 17px;
    width: 100%;
  }
  input::placeholder {
    color: var(--faint);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 32px;
    margin: 14px 0 6px;
  }
  .chip {
    height: 32px;
    max-width: 100%;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    animation: chip-in 0.18s ease;
  }
  .chip.strong {
    border-color: transparent;
    background: var(--sel);
    color: var(--on-sel);
    font-weight: 500;
  }
  .chip.accent {
    color: var(--accent);
  }
  .chip.warn {
    color: var(--warn);
  }
  @keyframes chip-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .row .pill {
    height: 36px;
    color: var(--text);
  }
  b {
    color: var(--accent);
  }
  b.warn {
    color: var(--warn);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }
</style>
