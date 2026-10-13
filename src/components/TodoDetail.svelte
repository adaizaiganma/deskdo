<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { onDestroy, untrack } from "svelte";
  import { fly } from "svelte/transition";
  import { addDays, localDate, longDate, monthDay, nextMonday, relativeDue, rowDue } from "@deskdo/core/dates";
  import { parseQuickAdd } from "@deskdo/core/quickadd";
  import { store } from "@deskdo/core/store.svelte";
  import type { Todo, TodoPatch } from "@deskdo/core/types";
  import { closeOnBack } from "../lib/back.svelte";
  import { ui } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";

  /**
   * 一筆待辦的詳情（全螢幕）：標題、期限、標籤、優先、前後步驟、備註。
   * 改的內容先放在這裡，離開時（返回、切到別的步驟）才一起存，避免每按一下就送出一次。
   */
  let { id, today }: { id: string; today: string } = $props();

  const todo = $derived(store.find(id));
  const start = untrack(() => store.find(id));
  let title = $state(start?.title ?? "");
  let note = $state(start?.note ?? "");
  let due = $state<string | null>(start?.due ?? null);
  /** 期限的時間；null 是一整天 */
  let dueTime = $state<string | null>(start?.dueTime ?? null);
  let tags = $state<string[]>([...(start?.tags ?? [])]);
  let priority = $state<Todo["priority"]>(start?.priority ?? "normal");
  /** 刪掉了就不用再存 */
  let removed = false;

  closeOnBack("detail", () => true, () => close());

  // 這一筆不見了（在別台裝置刪掉、同步時拿掉）就關掉
  $effect(() => {
    if (!todo) untrack(close);
  });

  function close() {
    if (ui.detail === id) ui.detail = null;
  }

  function commit() {
    const t = store.find(id);
    if (!t || removed) return;
    const p: TodoPatch = {};
    const tt = title.trim();
    if (tt && tt !== t.title) p.title = tt;
    const n = note.trim() || null;
    if (n !== (t.note ?? null)) p.note = n;
    if (due !== t.due) p.due = due;
    // 沒有期限就沒有時間（雲端也會清掉）
    const time = due ? dueTime : null;
    if (time !== t.dueTime) p.dueTime = time;
    if (tags.join("\n") !== t.tags.join("\n")) p.tags = [...tags];
    if (priority !== t.priority) p.priority = priority;
    if (Object.keys(p).length) store.update(id, p);
  }
  onDestroy(commit);

  /** 切到同一串的另一步（詳情頁換成那一筆，這一筆先存） */
  function openOther(other: Todo) {
    ui.openTodo(other.id);
  }

  function toggleDone() {
    if (!todo) return;
    if (todo.done) {
      store.reopen(todo);
      return;
    }
    commit();
    store.complete(todo);
    close();
  }

  function remove() {
    if (!todo) return;
    removed = true;
    store.remove(todo);
    close();
  }

  // ---- 期限 ----
  let duePanel = $state(false);
  const dueInfo = $derived(due ? rowDue(due, today, dueTime, store.now) : null);
  const dueChips = $derived([
    { label: t("今天", "Today"), value: today },
    { label: t("明天", "Tomorrow"), value: addDays(today, 1) },
    { label: t("下週一", "Next Mon"), value: nextMonday(today) },
    { label: t("無期限", "No date"), value: null },
  ]);
  let dateInput = $state<HTMLInputElement>();
  function pickDate() {
    try {
      dateInput?.showPicker();
    } catch {
      dateInput?.focus();
    }
  }

  // ---- 時間 ----
  let timeInput = $state<HTMLInputElement>();
  function pickTime() {
    if (!store.canUseV6("time")) return;
    try {
      timeInput?.showPicker();
    } catch {
      timeInput?.focus();
    }
  }

  // ---- 標籤 ----
  let tagSheet = $state(false);
  let tagQuery = $state("");
  const tq = $derived(tagQuery.trim().replace(/^[#＃]/, "").trim());
  const tagOptions = $derived(store.orderedTags.filter((t) => !tq || t.toLowerCase().includes(tq.toLowerCase())));
  const canCreateTag = $derived(!!tq && !store.orderedTags.some((t) => t.toLowerCase() === tq.toLowerCase()));
  /** 點一下加上，已經有的再點一下拿掉；面板保持打開，可以連續選好幾個 */
  function pickTag(t: string) {
    if (tags.includes(t)) tags = tags.filter((x) => x !== t);
    else {
      if (tags.length && !store.canUseV6("tags")) return;
      tags = [...tags, t];
    }
    tagQuery = "";
  }
  function tagKey(e: KeyboardEvent) {
    if (e.isComposing || e.key !== "Enter") return;
    // Enter 只加不拿掉
    const exact = store.orderedTags.find((t) => t.toLowerCase() === tq.toLowerCase());
    const t = exact ?? (canCreateTag ? tq : tagOptions.length === 1 ? tagOptions[0] : null);
    if (t && !tags.includes(t)) pickTag(t);
    else tagQuery = "";
  }

  // ---- 優先 ----
  const priorities: { id: Todo["priority"]; label: string }[] = [
    { id: "low", get label() { return t("低", "Low"); } },
    { id: "normal", get label() { return t("一般", "Normal"); } },
    { id: "high", get label() { return t("高", "High"); } },
  ];
  function setPriority(p: Todo["priority"]) {
    if (p === "low" && !store.canUseLow()) return;
    priority = p;
  }

  // ---- 前後步驟 ----
  const next = $derived(todo && !todo.done ? store.nextOf.get(todo.id) : undefined);
  /** 前一步還沒完成，這一筆要等它 */
  const waitingFor = $derived(todo && store.waiting.has(todo.id) ? store.prevOf(todo) : undefined);
  let stepInput = $state(false);
  let stepText = $state("");
  let stepBox = $state<HTMLInputElement>();
  let linkSheet = $state(false);
  let linkQuery = $state("");

  /** 可以接在這一筆後面的待辦：排除自己、目前的下一步，以及它前面的步驟（會繞成圈） */
  const candidates = $derived.by(() => {
    if (!linkSheet || !todo) return [];
    const ancestors = new Set<string>();
    for (let p: Todo | undefined = todo; p; p = store.prevOf(p)) {
      if (ancestors.has(p.id)) break;
      ancestors.add(p.id);
    }
    const q = linkQuery.trim().toLowerCase();
    return store.allOpen
      .filter((t) => !ancestors.has(t.id) && t.id !== next?.id && !t.id.startsWith("tmp-"))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.tags.some((g) => g.toLowerCase().includes(q)))
      .slice(0, 30);
  });

  function startStep() {
    if (!store.canUseSteps()) return;
    stepInput = true;
    queueMicrotask(() => stepBox?.focus());
  }

  /** 新增下一步；可以用快速新增的語法（@期限、#標籤、!），沒寫標籤就沿用這一筆的 */
  function addStep() {
    const step = parseQuickAdd(stepText, today);
    if (!step) return;
    if (step.priority === "low" && !store.canUseLow()) return;
    if (step.dueTime && !store.canUseV6("time")) return;
    if ((step.tags?.length ?? 0) > 1 && !store.canUseV6("tags")) return;
    store.add({ ...(tags.length ? { tags } : {}), ...step, afterId: id });
    stepText = "";
    stepInput = false;
  }

  function stepKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === "Enter") addStep();
    if (e.key === "Escape") stepInput = false;
  }

  function openLink() {
    if (!store.canUseSteps()) return;
    linkQuery = "";
    linkSheet = true;
  }

  function link(t: Todo) {
    store.update(t.id, { afterId: id });
    linkSheet = false;
  }

  const source = $derived(todo ? (({ email: t("來自 Gmail", "From Gmail"), claude: t("由 AI 助理新增", "Added by AI assistant"), manual: t("手動新增", "Added manually") } as Record<string, string>)[todo.source] ?? "") : "");
  const created = $derived(todo ? localDate(todo.createdAt) : null);

  function titleKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  }
</script>

<div class="detail" role="dialog" aria-modal="true" aria-label={t("待辦詳情", "To-do details")} transition:fly={{ y: 28, duration: 220 }}>
  <header class="top">
    <button class="icon-btn" onclick={close} aria-label={t("返回", "Back")}><Icon name="back" size={24} /></button>
    <span class="grow"></span>
    <button class="icon-btn" onclick={remove} aria-label={t("刪除", "Delete")}><Icon name="trash" size={22} /></button>
  </header>

  {#if todo}
    <div class="scroll">
      <div class="head">
        <button class="chk" onclick={toggleDone} aria-label={todo.done ? t("標記為未完成", "Mark as not done") : t("標記完成", "Mark as done")}>
          <span class="ring" class:hi={priority === "high" && !todo.done} class:on={todo.done}>
            {#if todo.done}<Icon name="check" size={16} stroke={2.2} />{/if}
          </span>
        </button>
        <label class="title-wrap">
          <span class="sr">{t("標題", "Title")}</span>
          <textarea class="title" class:struck={todo.done} rows="1" bind:value={title} onkeydown={titleKey} onblur={commit}></textarea>
        </label>
      </div>

      <div class="rows">
        <!-- 期限 -->
        <button class="row" onclick={() => (duePanel = !duePanel)} aria-expanded={duePanel}>
          <span class="ricon"><Icon name="calendar" size={22} /></span>
          <span class="rtext">
            <span class="rmain">{due ? longDate(due) + (dueTime ? ` ${dueTime}` : "") : t("沒有期限", "No due date")}</span>
            {#if dueInfo && !todo.done}<span class="rsub {dueInfo.tone}">{dueInfo.count}</span>{/if}
          </span>
          <span class="rlabel">{t("期限", "Due")}</span>
        </button>
        {#if duePanel}
          <div class="panel">
            {#each dueChips as c (c.label)}
              <button class="pill" class:on={due === c.value} onclick={() => ((due = c.value), (duePanel = false))}>{c.label}</button>
            {/each}
            <span class="date-wrap">
              <button class="pill" class:on={!!due && !dueChips.some((c) => c.value === due)} onclick={pickDate}>
                {due && !dueChips.some((c) => c.value === due) ? relativeDue(due, today) : t("選擇日期", "Pick a date")}
              </button>
              <input
                bind:this={dateInput}
                type="date"
                class="date-input"
                value={due ?? ""}
                onchange={(e) => ((due = e.currentTarget.value || null), (duePanel = false))}
                tabindex="-1"
                aria-hidden="true"
              />
            </span>
          </div>
        {/if}

        <!-- 時間：有期限才能設，沒設就是一整天 -->
        {#if due}
          <div class="row static">
            <span class="ricon"><Icon name="clock" size={22} /></span>
            <span class="rtext pills">
              <span class="date-wrap">
                <button class="pill" class:on={!dueTime} onclick={() => (dueTime = null)}>{t("整天", "All day")}</button>
              </span>
              <span class="date-wrap">
                <button class="pill" class:on={!!dueTime} onclick={pickTime}>{dueTime ?? t("指定時間", "Set time")}</button>
                <input
                  bind:this={timeInput}
                  type="time"
                  class="date-input"
                  value={dueTime ?? ""}
                  onchange={(e) => (dueTime = e.currentTarget.value || null)}
                  tabindex="-1"
                  aria-hidden="true"
                />
              </span>
            </span>
            <span class="rlabel">{t("時間", "Time")}</span>
          </div>
        {/if}

        <!-- 標籤 -->
        <button class="row" onclick={() => ((tagQuery = ""), (tagSheet = true))}>
          <span class="ricon"><Icon name="hash" size={22} /></span>
          <span class="rtext">
            <span class="rmain clip" class:muted={!tags.length}>{tags.length ? tags.map((g) => `#${g}`).join(" ") : t("沒有標籤", "No tags")}</span>
          </span>
          <span class="rlabel clip">{tags.length === 1 && store.folderOf.get(tags[0]) ? `${t("標籤", "Tags")} · ${store.folderOf.get(tags[0])}` : t("標籤", "Tags")}</span>
        </button>

        <!-- 優先 -->
        <div class="row static">
          <span class="ricon"><Icon name="flag" size={22} /></span>
          <div class="seg" role="radiogroup" aria-label={t("優先", "Priority")}>
            {#each priorities as p (p.id)}
              <button role="radio" aria-checked={priority === p.id} class:on={priority === p.id} class:hi={p.id === "high"} onclick={() => setPriority(p.id)}>
                {#if priority === p.id}<Icon name="check" size={14} stroke={2} />{/if}{p.label}
              </button>
            {/each}
          </div>
        </div>

        <!-- 前後步驟 -->
        <div class="row static top-align">
          <span class="ricon"><Icon name="next" size={22} /></span>
          <div class="steps">
            {#if waitingFor}
              <div class="step">
                <button class="step-link clip" onclick={() => openOther(waitingFor)}>{t("前一步：", "Previous: ")}{waitingFor.title}</button>
                <button class="text-btn" onclick={() => store.update(id, { afterId: null })}>{t("取消連接", "Unlink")}</button>
              </div>
            {/if}
            {#if next}
              <div class="step">
                <button class="step-link clip" onclick={() => openOther(next)}>
                  {t("接著：", "Next: ")}{next.title}{next.due ? ` · ${relativeDue(next.due, today, next.dueTime)}` : ""}
                </button>
                <button class="text-btn" onclick={() => store.update(next.id, { afterId: null })}>{t("取消連接", "Unlink")}</button>
              </div>
            {/if}
            {#if stepInput}
              <input
                class="step-input"
                bind:this={stepBox}
                bind:value={stepText}
                onkeydown={stepKey}
                onblur={() => !stepText.trim() && (stepInput = false)}
                placeholder={t("下一步要做什麼？例如：印預報 @週四", "What comes next? e.g. Print report @thu")}
                enterkeyhint="done"
              />
            {:else if !todo.done}
              <div class="step-actions">
                <button class="pill" onclick={startStep}><Icon name="plus" size={14} stroke={1.8} />{next ? t("插入下一步", "Insert next step") : t("新增下一步", "Add next step")}</button>
                <button class="pill" onclick={openLink}><Icon name="link" size={14} />{t("連接已有待辦", "Link existing to-do")}</button>
              </div>
            {/if}
            {#if !waitingFor && !next && !stepInput}
              <span class="hint">{t("前一項完成後，下一步才會出現在清單上", "The next step shows up in your list once this one is done")}</span>
            {/if}
          </div>
        </div>

        <!-- 備註 -->
        <label class="row static top-align">
          <span class="ricon"><Icon name="note" size={22} /></span>
          <span class="sr">{t("備註", "Note")}</span>
          <textarea class="note" placeholder={t("加上備註", "Add a note")} bind:value={note} onblur={commit}></textarea>
        </label>
      </div>

      <p class="meta">{source}{created ? ` · ${t(`${monthDay(created, today)} 建立`, `Created ${monthDay(created, today)}`)}` : ""}{todo.done && todo.doneAt ? ` · ${t(`${monthDay(localDate(todo.doneAt) ?? today, today)} 完成`, `Done ${monthDay(localDate(todo.doneAt) ?? today, today)}`)}` : ""}</p>
    </div>

    <div class="bottom">
      <!-- 存好改的內容再關掉；完成／未完成用標題左邊的圓圈 -->
      <button class="done-btn" onclick={close}>
        <Icon name="check" size={20} stroke={2} />{t("修改完成", "Done editing")}
      </button>
    </div>
  {/if}
</div>

{#if tagSheet}
  <Sheet label={t("選擇標籤", "Choose tags")} onclose={() => (tagSheet = false)}>
    <h2>{t("標籤", "Tags")}</h2>
    <p class="none">{t("可以選好幾個，再點一次拿掉", "Pick as many as you like; tap again to remove")}</p>
    <input class="search" bind:value={tagQuery} onkeydown={tagKey} placeholder={t("搜尋或新增標籤", "Search or create a tag")} enterkeyhint="done" />
    <div class="options">
      {#if canCreateTag}
        <button class="option" onclick={() => pickTag(tq)}><Icon name="plus" size={18} />{t(`新增標籤「${tq}」`, `Create tag "${tq}"`)}</button>
      {/if}
      {#if tags.length}
        <button class="option muted" onclick={() => (tags = [])}><Icon name="close" size={18} />{t("移除全部標籤", "Remove all tags")}</button>
      {/if}
      {#each tagOptions as t (t)}
        <button class="option" class:cur={tags.includes(t)} onclick={() => pickTag(t)}>
          <span class="hash">#</span><span class="clip grow">{t}</span>
          {#if store.folderOf.get(t)}<span class="folder">{store.folderOf.get(t)}</span>{/if}
          {#if tags.includes(t)}<Icon name="check" size={18} stroke={2} />{/if}
        </button>
      {:else}
        {#if !canCreateTag}<p class="none">{t("還沒有標籤，輸入名稱就能新增", "No tags yet, type a name to create one")}</p>{/if}
      {/each}
    </div>
  </Sheet>
{/if}

{#if linkSheet}
  <Sheet label={t("連接已有待辦", "Link existing to-do")} onclose={() => (linkSheet = false)}>
    <h2>{t("接在這一項後面", "Follow this one with")}</h2>
    <input class="search" bind:value={linkQuery} placeholder={t("搜尋待辦", "Search to-dos")} enterkeyhint="search" />
    <div class="options">
      {#each candidates as c (c.id)}
        <button class="option" onclick={() => link(c)}>
          <span class="clip grow">{c.title}</span>
          {#if c.tags.length}<span class="folder">{c.tags.map((t) => `#${t}`).join(" ")}</span>{/if}
          {#if c.due}<span class="folder">{relativeDue(c.due, today, c.dueTime)}</span>{/if}
        </button>
      {:else}
        <p class="none">{t("沒有符合的待辦", "No matching to-dos")}</p>
      {/each}
    </div>
  </Sheet>
{/if}

<style>
  .detail {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    padding-bottom: var(--nav-inset);
  }
  .top {
    flex: none;
    display: flex;
    align-items: center;
    height: 64px;
    padding: 0 4px;
  }
  .top .icon-btn {
    color: var(--text);
  }
  .grow {
    flex: 1;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 24px;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 4px 20px 12px 8px;
  }
  .chk {
    flex: none;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
  }
  .ring {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--ring);
    display: grid;
    place-items: center;
    color: var(--bg);
  }
  .ring.hi {
    border-color: var(--warn);
  }
  .ring.on {
    background: var(--faint);
    border-color: var(--faint);
  }
  .title-wrap {
    flex: 1;
    min-width: 0;
    padding-top: 6px;
  }
  .title {
    width: 100%;
    border: 0;
    outline: 0;
    background: none;
    padding: 0;
    resize: none;
    field-sizing: content;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.35;
  }
  .title.struck {
    color: var(--faint);
    text-decoration: line-through;
  }
  .rows {
    display: flex;
    flex-direction: column;
    padding: 0 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 60px;
    padding: 8px 12px;
    border-radius: 16px;
    text-align: left;
  }
  button.row:active {
    background: var(--hover);
  }
  .row.top-align {
    align-items: flex-start;
  }
  .row.top-align .ricon {
    padding-top: 9px;
  }
  .ricon {
    flex: none;
    display: grid;
    color: var(--sub);
  }
  .rtext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rmain {
    font-size: 16px;
  }
  .rmain.muted {
    color: var(--sub);
  }
  .rsub {
    font-size: 13px;
    color: var(--sub);
  }
  .rsub.warn {
    color: var(--warn);
  }
  .rsub.soon {
    color: var(--accent);
  }
  .rlabel {
    flex: none;
    max-width: 40%;
    font-size: 13px;
    color: var(--sub);
  }
  .panel {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 12px 10px 50px;
  }
  /* 時間：整天／指定時間並排 */
  .rtext.pills {
    flex-direction: row;
    gap: 8px;
  }
  .date-wrap {
    position: relative;
    display: inline-flex;
  }
  .date-input {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    pointer-events: none;
  }
  .seg {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    height: 40px;
    border: 1px solid var(--faint);
    border-radius: 20px;
    overflow: hidden;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 14px;
    font-weight: 500;
  }
  .seg button + button {
    border-left: 1px solid var(--faint);
  }
  .seg button.on {
    background: var(--sel);
    color: var(--on-sel);
  }
  .seg button.on.hi {
    background: var(--warn-container);
    color: var(--on-warn-container);
  }
  .steps {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 4px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .step-link {
    flex: 1;
    min-height: 40px;
    text-align: left;
    font-size: 15px;
    color: var(--accent);
  }
  .step-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0;
  }
  .step-input,
  .search {
    height: 48px;
    padding: 0 16px;
    border: 0;
    border-radius: 12px;
    background: var(--c-high);
    font-size: 15px;
    outline: none;
  }
  .step-input:focus,
  .search:focus {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .hint {
    font-size: 13px;
    color: var(--sub);
  }
  .note {
    flex: 1;
    min-width: 0;
    min-height: 104px;
    resize: none;
    field-sizing: content;
    border: 0;
    outline: 0;
    border-radius: 16px;
    background: var(--c);
    padding: 12px 14px;
    font-size: 15px;
    line-height: 1.55;
  }
  .note::placeholder,
  .step-input::placeholder,
  .search::placeholder {
    color: var(--faint);
  }
  .meta {
    margin: 8px 0 0;
    padding: 0 24px 0 70px;
    font-size: 12px;
    color: var(--sub);
  }
  .bottom {
    flex: none;
    padding: 12px 16px 16px;
  }
  .done-btn {
    width: 100%;
    height: 56px;
    border-radius: 28px;
    background: var(--accent-container);
    color: var(--on-accent-container);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 500;
  }
  .search {
    width: 100%;
    margin-bottom: 8px;
  }
  .options {
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 0 12px;
    border-radius: 12px;
    text-align: left;
    font-size: 16px;
  }
  .option:active {
    background: var(--hover);
  }
  .option.cur {
    color: var(--accent);
    font-weight: 500;
  }
  .option.muted {
    color: var(--sub);
  }
  .hash {
    color: var(--faint);
  }
  .folder {
    flex: none;
    font-size: 13px;
    color: var(--sub);
  }
  .none {
    margin: 0;
    padding: 16px 12px;
    font-size: 14px;
    color: var(--sub);
  }
</style>
