<script lang="ts">
  import { untrack } from "svelte";
  import { slide } from "svelte/transition";
  import { addDays, localDate, monthDay, nextMonday, relativeDue, rowDue } from "../lib/dates";
  import { parseQuickAdd } from "../lib/quickadd";
  import { store } from "../lib/store.svelte";
  import type { Todo, TodoPatch } from "../lib/types";
  import Icon from "./Icon.svelte";

  interface Props {
    todo: Todo;
    today: string;
    editing: boolean;
    onedit: (id: string | null) => void;
  }
  let { todo, today, editing, onedit }: Props = $props();

  /** 勾選後先播完打勾動畫，再真的標記完成 */
  let checking = $state(false);
  let draftTitle = $state("");
  let draftNote = $state("");
  let titleInput = $state<HTMLInputElement>();
  /** 展開的選單：tag = 選標籤，new = 新增下一步，link = 從現有的待辦挑一筆接在後面 */
  let panel = $state<"tag" | "new" | "link" | null>(null);
  let query = $state("");
  let panelInput = $state<HTMLInputElement>();

  const sending = $derived(todo.id.startsWith("tmp-"));
  const high = $derived(todo.priority === "high");
  const low = $derived(todo.priority === "low");
  const due = $derived(!todo.done && todo.due ? rowDue(todo.due, today) : null);
  const checked = $derived(todo.done || checking);
  const source = $derived({ email: "來自 Gmail", claude: "由 AI 助理新增", manual: "手動新增" }[todo.source] ?? "");
  const created = $derived(localDate(todo.createdAt));
  const next = $derived(todo.done ? undefined : store.nextOf.get(todo.id));
  /** 前一步還沒完成（平常不會顯示，搜尋時才看得到） */
  const waitingFor = $derived(store.waiting.has(todo.id) ? store.prevOf(todo) : undefined);

  /** 可以接在這一筆後面的待辦：排除自己、目前的下一步，以及它前面的步驟（會繞成圈） */
  const candidates = $derived.by(() => {
    if (panel !== "link") return [];
    const ancestors = new Set<string>();
    for (let p: Todo | undefined = todo; p; p = store.prevOf(p)) {
      if (ancestors.has(p.id)) break;
      ancestors.add(p.id);
    }
    const q = query.trim().toLowerCase();
    return store.allOpen
      .filter((t) => !ancestors.has(t.id) && t.id !== next?.id && !t.id.startsWith("tmp-"))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.tag?.toLowerCase().includes(q))
      .slice(0, 8);
  });

  const dueChips = $derived([
    { label: "今天", value: today },
    { label: "明天", value: addDays(today, 1) },
    { label: "下週一", value: nextMonday(today) },
    { label: "無期限", value: null },
  ]);

  // 打開編輯時載入草稿；收合時把標題和備註存回去
  let wasEditing = false;
  /** 草稿是從哪一筆載入的。這一列換成顯示別筆時（例如在步驟之間切換），不能把草稿存到別筆上 */
  let draftId: string | null = null;
  $effect(() => {
    const now = editing;
    untrack(() => {
      if (now && !wasEditing) {
        draftId = todo.id;
        draftTitle = todo.title;
        draftNote = todo.note ?? "";
        panel = null;
        queueMicrotask(() => titleInput?.focus());
      } else if (!now && wasEditing) {
        commit();
      }
      wasEditing = now;
    });
  });

  function patch(p: TodoPatch) {
    store.update(todo.id, p);
  }

  function commit() {
    if (draftId !== todo.id) return;
    const p: TodoPatch = {};
    const title = draftTitle.trim();
    if (title && title !== todo.title) p.title = title;
    const note = draftNote.trim() || null;
    if (note !== (todo.note ?? null)) p.note = note;
    if (Object.keys(p).length) patch(p);
  }

  function toggle() {
    if (sending || checking) return;
    if (todo.done) {
      store.reopen(todo);
      return;
    }
    checking = true;
    if (editing) onedit(null);
    setTimeout(() => store.complete(todo), 380);
    // 送出失敗、項目被復原時，把打勾狀態還原
    setTimeout(() => (checking = false), 2000);
  }

  function openEditor() {
    if (!sending && !todo.done) onedit(todo.id);
  }

  /** 標籤清單：依資料夾排序，可以搜尋；搜尋的字不是現有標籤時，第一項是「新增」 */
  const tagQuery = $derived(panel === "tag" ? query.trim().replace(/^[#＃]/, "").trim() : "");
  const tagOptions = $derived.by(() => {
    if (panel !== "tag") return [];
    const q = tagQuery.toLowerCase();
    return store.orderedTags.filter((t) => !q || t.toLowerCase().includes(q));
  });
  const canCreateTag = $derived(!!tagQuery && !store.orderedTags.some((t) => t.toLowerCase() === tagQuery.toLowerCase()));

  function openTags() {
    panel = panel === "tag" ? null : "tag";
    query = "";
    queueMicrotask(() => panelInput?.focus());
  }

  function pickTag(tag: string | null) {
    if (tag !== todo.tag) patch({ tag });
    panel = null;
  }

  function tagKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === "Escape") panel = null;
    if (e.key === "Enter") {
      const exact = store.orderedTags.find((t) => t.toLowerCase() === tagQuery.toLowerCase());
      if (exact) pickTag(exact);
      else if (canCreateTag) pickTag(tagQuery);
      else if (tagOptions.length === 1) pickTag(tagOptions[0]);
    }
  }

  function setPriority(p: Todo["priority"]) {
    if (p === "low" && !store.canUseLow()) return;
    patch({ priority: p });
  }

  function startStep(mode: "new" | "link") {
    if (!store.canUseSteps()) return;
    panel = panel === mode ? null : mode;
    query = "";
    queueMicrotask(() => panelInput?.focus());
  }

  /** 新增下一步；可以用快速新增的語法（@期限、#標籤、!），沒寫標籤就沿用這一筆的 */
  function addStep() {
    const step = parseQuickAdd(query, today);
    if (!step) return;
    if (step.priority === "low" && !store.canUseLow()) return;
    store.add({ ...(todo.tag ? { tag: todo.tag } : {}), ...step, afterId: todo.id });
    query = "";
    panel = null;
  }

  function link(t: Todo) {
    store.update(t.id, { afterId: todo.id });
    panel = null;
  }

  function stepKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === "Escape") panel = null;
    if (e.key === "Enter") {
      if (panel === "new") addStep();
      else if (candidates.length === 1) link(candidates[0]);
    }
  }

  /**
   * 編輯中點到這一列的空白處（不是輸入框或按鈕）就收合；點到列外面由 TodoList 處理。
   * 按下時也要在空白處：在備註框拖曳選字、放開時剛好停在空白處，不算點擊。
   */
  let downOnBlank = false;
  const isBlank = (t: EventTarget | null) => !(t as HTMLElement | null)?.closest("input, textarea, button, select, label, a");

  function onRowClick(e: MouseEvent) {
    if (editing && downOnBlank && isBlank(e.target)) onedit(null);
  }

  function titleKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === "Enter") onedit(null);
    if (e.key === "Escape") {
      draftTitle = todo.title;
      onedit(null);
    }
  }
</script>

<!-- 鍵盤使用者用 Enter／Esc（標題輸入框）收合，所以點擊收合不需要對應的按鍵處理 -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="row" class:editing class:done={todo.done} class:sending class:low class:waiting={!!waitingFor} data-row={todo.id} onpointerdown={(e) => (downOnBlank = isBlank(e.target))} onclick={onRowClick}>
  <div class="line">
    <button
      class="chk"
      class:hi={high && !checked}
      class:on={checked}
      onclick={toggle}
      disabled={sending}
      aria-label={todo.done ? `標記「${todo.title}」為未完成` : `完成「${todo.title}」`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path class="ck" d="M2.5 6.3l2.3 2.3L9.6 3.6" />
      </svg>
    </button>

    {#if editing}
      <input
        class="title-input"
        bind:this={titleInput}
        bind:value={draftTitle}
        onkeydown={titleKey}
        onblur={commit}
        aria-label="標題"
      />
    {:else}
      <!-- 左鍵、右鍵都會展開編輯 -->
      <button
        class="body"
        onclick={openEditor}
        oncontextmenu={(e) => {
          e.preventDefault();
          openEditor();
        }}
        disabled={sending}
      >
        <span class="title" class:struck={checked}>{todo.title}</span>
        {#if high || low || todo.tag || todo.source === "email" || todo.note || todo.done || waitingFor}
          <span class="meta">
            {#if waitingFor}
              <span class="mi faint"><Icon name="link" size={12} stroke={1.5} />等「{waitingFor.title}」完成</span>
            {/if}
            {#if todo.done && todo.doneAt}
              <span>{monthDay(localDate(todo.doneAt) ?? today, today)} 完成</span>
            {/if}
            {#if high && !todo.done}
              <span class="mi warn"><Icon name="flag" size={11} stroke={1.8} />高優先</span>
            {/if}
            {#if low && !todo.done}
              <span class="mi faint">低優先</span>
            {/if}
            {#if todo.tag}<span class="mi tagname" title="#{todo.tag}"><span class="clip">#{todo.tag}</span></span>{/if}
            {#if todo.source === "email"}<span class="mi"><Icon name="mail" size={12} stroke={1.5} />Gmail</span>{/if}
            {#if todo.note && !todo.done}<span class="mi" title={todo.note}><Icon name="note" size={12} stroke={1.5} />備註</span>{/if}
          </span>
        {/if}
      </button>
      {#if due}
        <span class="due {due.tone}" title={todo.due}>
          <span class="count">{due.count}</span>
          {#if due.date}<span class="date">{due.date}</span>{/if}
        </span>
      {/if}
    {/if}
  </div>
  {#if next && !editing}
    <button class="next" onclick={() => onedit(next.id)} title="編輯下一步">
      ↳ 接著：{next.title}{next.due ? ` · ${relativeDue(next.due, today)}` : ""}
    </button>
  {/if}

  {#if editing}
    <div class="editor" transition:slide={{ duration: 200 }}>
      <div class="field">
        <span class="ficon"><Icon name="calendar" size={14} stroke={1.5} /></span>
        {#each dueChips as c (c.label)}
          <button class="pill" class:on={todo.due === c.value} onclick={() => patch({ due: c.value })}>{c.label}</button>
        {/each}
        <input
          type="date"
          class="pill date"
          value={todo.due ?? ""}
          onchange={(e) => patch({ due: e.currentTarget.value || null })}
          aria-label="選擇日期"
        />
      </div>
      <div class="field">
        <span class="ficon"><Icon name="hash" size={14} stroke={1.5} /></span>
        {#if todo.tag}
          <span class="pill on tag-on" title="#{todo.tag}">
            <span class="clip">#{todo.tag}</span>
            <button onclick={() => pickTag(null)} aria-label="移除標籤"><Icon name="close" size={10} stroke={2} /></button>
          </span>
        {/if}
        <button class="pill" class:on={panel === "tag"} onclick={openTags}>{todo.tag ? "更換標籤" : "選擇標籤"}</button>
      </div>
      {#if panel === "tag"}
        <div class="step-box" transition:slide={{ duration: 150 }}>
          <input
            class="step-input"
            bind:this={panelInput}
            bind:value={query}
            onkeydown={tagKey}
            placeholder="搜尋或新增標籤"
            aria-label="搜尋或新增標籤"
          />
          <div class="cands">
            {#if canCreateTag}
              <button class="cand" onclick={() => pickTag(tagQuery)}>
                <span class="ctitle"><Icon name="plus" size={11} stroke={1.8} /> 新增標籤「{tagQuery}」</span>
              </button>
            {/if}
            {#each tagOptions as tag (tag)}
              <button class="cand" class:cur={todo.tag === tag} onclick={() => pickTag(tag)}>
                <span class="ctitle" title="#{tag}">#{tag}</span>
                {#if store.folderOf.get(tag)}<span class="ctag">{store.folderOf.get(tag)}</span>{/if}
                {#if todo.tag === tag}<span class="ctag check">✓</span>{/if}
              </button>
            {:else}
              {#if !canCreateTag}<span class="none">還沒有標籤，輸入名稱就能新增</span>{/if}
            {/each}
          </div>
        </div>
      {/if}
      <div class="field">
        <span class="ficon"><Icon name="flag" size={14} stroke={1.5} /></span>
        <button class="pill" class:warn-on={high} onclick={() => setPriority(high ? "normal" : "high")}>! 高優先</button>
        <button class="pill" class:on={low} onclick={() => setPriority(low ? "normal" : "low")}>~ 低優先</button>
      </div>
      <div class="field steps">
        <span class="ficon"><Icon name="link" size={14} stroke={1.5} /></span>
        {#if waitingFor}
          <button class="step-info" onclick={() => onedit(waitingFor.id)} title="編輯前一步">前一步：{waitingFor.title}</button>
          <button class="tbtn" onclick={() => patch({ afterId: null })}>取消連接</button>
        {/if}
        {#if next}
          <button class="step-info" onclick={() => onedit(next.id)} title="編輯下一步">接著：{next.title}{next.due ? ` · ${relativeDue(next.due, today)}` : ""}</button>
          <button class="tbtn" onclick={() => store.update(next.id, { afterId: null })}>取消連接</button>
        {/if}
        <button class="pill" class:on={panel === "new"} onclick={() => startStep("new")}>
          <Icon name="plus" size={12} stroke={1.8} />{next ? "插入下一步" : "新增下一步"}
        </button>
        <button class="pill" class:on={panel === "link"} onclick={() => startStep("link")}>
          <Icon name="link" size={12} stroke={1.6} />連接已有待辦
        </button>
      </div>
      {#if panel === "new" || panel === "link"}
        <div class="step-box" transition:slide={{ duration: 150 }}>
          <input
            class="step-input"
            bind:this={panelInput}
            bind:value={query}
            onkeydown={stepKey}
            placeholder={panel === "new" ? "下一步要做什麼？例如：印預報 @週四" : "搜尋要接在後面的待辦"}
            aria-label={panel === "new" ? "下一步" : "搜尋待辦"}
          />
          {#if panel === "link"}
            <div class="cands">
              {#each candidates as c (c.id)}
                <button class="cand" onclick={() => link(c)}>
                  <span class="ctitle">{c.title}</span>
                  {#if c.tag}<span class="ctag">#{c.tag}</span>{/if}
                  {#if c.due}<span class="ctag">{relativeDue(c.due, today)}</span>{/if}
                </button>
              {:else}
                <span class="none">沒有符合的待辦</span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <textarea class="note" placeholder="備註…" bind:value={draftNote} onblur={commit} aria-label="備註"></textarea>
      <div class="foot">
        <span>{source}{created ? ` · ${monthDay(created, today)} 建立` : ""}</span>
        <span class="grow"></span>
        <button class="tbtn danger" onclick={() => store.remove(todo)}><Icon name="trash" size={13} stroke={1.5} />刪除</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .row {
    border-radius: 10px;
    transition: background 0.15s, box-shadow 0.2s, margin 0.2s;
  }
  .row:not(.editing):hover {
    background: var(--hover);
  }
  .row.editing {
    background: var(--raised);
    box-shadow: var(--card-shadow);
    margin: 6px 0 8px;
  }
  .row.sending {
    opacity: 0.55;
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 10px;
  }

  .chk {
    flex: none;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    border: 1.6px solid var(--ring);
    display: grid;
    place-items: center;
    transition: background 0.18s, border-color 0.18s;
  }
  .chk.hi {
    border-color: var(--warn);
  }
  .chk .ck {
    stroke: transparent;
    stroke-dasharray: 14;
    stroke-dashoffset: 14;
    transition: stroke-dashoffset 0.25s ease, stroke 0.15s;
  }
  .chk:not(:disabled):hover {
    border-color: var(--accent);
  }
  .chk:not(:disabled):hover .ck {
    stroke: var(--accent);
    stroke-dashoffset: 0;
    opacity: 0.6;
  }
  .chk.on {
    background: var(--accent);
    border-color: var(--accent);
    animation: pop 0.3s ease;
  }
  .row.done .chk.on {
    background: var(--ring);
    border-color: var(--ring);
    animation: none;
  }
  .chk.on .ck,
  .chk.on:hover .ck {
    stroke: var(--bg);
    stroke-dashoffset: 0;
    opacity: 1;
  }
  @keyframes pop {
    50% {
      transform: scale(1.18);
    }
  }

  .body {
    flex: 1;
    min-width: 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 3px;
    cursor: pointer;
  }
  .row.done .body {
    cursor: default;
  }
  .title {
    font-size: 14px;
    line-height: 1.45;
    word-break: break-word;
    transition: color 0.2s;
  }
  .title.struck {
    color: var(--faint);
    text-decoration: line-through;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    align-items: center;
    font-size: 11.5px;
    color: var(--sub);
  }
  .mi {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .mi.warn {
    color: var(--warn);
  }
  .mi.faint {
    color: var(--faint);
  }
  .due {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    margin-top: 1px;
    white-space: nowrap;
  }
  .due .count {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sub);
    font-variant-numeric: tabular-nums;
  }
  .due .date {
    font-size: 11px;
    color: var(--faint);
  }
  .due.soon .count {
    color: var(--accent);
  }
  .due.warn .count {
    color: var(--warn);
  }

  /* 寬度跟著內容，右邊留白可以點擊收合 */
  .title-input {
    flex: 0 1 auto;
    field-sizing: content;
    min-width: 7em;
    max-width: 100%;
    margin: -3px 0 -3px -6px;
    padding: 2px 6px;
    font-size: 14px;
    line-height: 1.45;
    border: 0;
    border-radius: 6px;
    background: var(--bg2);
    outline: none;
  }
  .title-input:focus {
    box-shadow: 0 0 0 1.5px var(--accent);
  }
  .row.editing {
    cursor: default;
  }
  /* 還沒輪到的步驟（標籤頁、搜尋時才看得到） */
  .row.waiting .title {
    color: var(--faint);
  }
  .row.waiting .chk {
    border-style: dashed;
  }
  .row.low:not(.done) .title {
    color: var(--sub);
  }

  .editor {
    padding: 0 12px 12px 40px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ficon {
    color: var(--faint);
    width: 22px;
    margin-left: -28px;
    display: grid;
    place-items: center;
  }
  .date {
    border: 0;
    outline: none;
    cursor: pointer;
  }
  /* 對齊標題（勾選框 20px + 間距 10px + 列的左邊距 10px） */
  .next {
    display: block;
    max-width: calc(100% - 50px);
    margin: -7px 0 0 40px;
    padding: 0 0 8px;
    font-size: 11.5px;
    color: var(--faint);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .next:hover {
    color: var(--accent);
  }
  .step-info:hover {
    text-decoration: underline;
  }
  .step-info {
    font-size: 12px;
    color: var(--accent);
    text-align: left;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: -3px;
  }
  .step-input {
    height: 30px;
    padding: 0 10px;
    font-size: 12.5px;
    border: 0;
    border-radius: 8px;
    background: var(--bg2);
    outline: none;
  }
  .step-input:focus {
    box-shadow: 0 0 0 1.5px var(--accent);
  }
  .cands {
    display: flex;
    flex-direction: column;
    max-height: 180px;
    overflow-y: auto;
  }
  .cand {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 4px 10px;
    border-radius: 6px;
    text-align: left;
    font-size: 12.5px;
  }
  .cand:hover {
    background: var(--hover);
  }
  .ctitle {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-on {
    max-width: 100%;
    padding-right: 4px;
  }
  .tag-on button {
    flex: none;
  }
  .tagname {
    max-width: 100%;
    min-width: 0;
  }
  .tag-on button {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
  }
  .tag-on button:hover {
    background: var(--hover);
  }
  .cand.cur .ctitle {
    color: var(--accent);
    font-weight: 500;
  }
  .ctag.check {
    color: var(--accent);
  }
  .ctag {
    flex: none;
    font-size: 11px;
    color: var(--faint);
  }
  .none {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--faint);
  }
  .note {
    font-size: 12.5px;
    line-height: 1.5;
    background: var(--bg2);
    border: 0;
    border-radius: 8px;
    padding: 8px 10px;
    resize: vertical;
    min-height: 54px;
    outline: none;
  }
  .note::placeholder {
    color: var(--faint);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    color: var(--faint);
  }
  .grow {
    flex: 1;
  }
  .tbtn {
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--sub);
  }
  .tbtn:hover {
    background: var(--hover);
    color: var(--text);
  }
  .tbtn.danger {
    color: var(--warn);
  }
</style>
