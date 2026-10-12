<script lang="ts">
  import { countdowns, resolve, type Countdown } from "@deskdo/core/countdowns.svelte";
  import { addDays, dayDistance, diffDays, fullDate, spanText } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import { toast } from "@deskdo/core/toast.svelte";
  import Fab from "../components/Fab.svelte";
  import Icon from "../components/Icon.svelte";
  import Sheet from "../components/Sheet.svelte";
  import TopBar from "../components/TopBar.svelte";

  /** 倒數日（只存在這台裝置）和日期計算 */
  let { today, onmenu }: { today: string; onmenu: () => void } = $props();

  const items = $derived(
    countdowns.list
      .map((c) => resolve(c, today))
      // 還沒到的（越近越前面），接著是已經過了的（越近越前面）
      .sort((a, b) => ((a.n >= 0) !== (b.n >= 0) ? (a.n >= 0 ? -1 : 1) : Math.abs(a.n) - Math.abs(b.n))),
  );
  const nearest = $derived(items.find((c) => c.n >= 0));

  // ---- 新增、編輯（底部面板） ----
  /** id 為 null 是新增 */
  let form = $state<{ id: string | null; title: string; date: string; yearly: boolean; pinned: boolean } | null>(null);

  function openNew(date = addDays(store.today, 30)) {
    form = { id: null, title: "", date, yearly: false, pinned: true };
  }

  function openEdit(c: Countdown) {
    form = { id: c.id, title: c.title, date: c.date, yearly: c.yearly, pinned: c.pinned !== false };
  }

  function save() {
    if (!form) return;
    const title = form.title.trim();
    if (!title || !form.date) return;
    if (form.id) {
      countdowns.update(form.id, { title, date: form.date, yearly: form.yearly });
      countdowns.setPinned(form.id, form.pinned);
    } else {
      countdowns.add({ title, date: form.date, yearly: form.yearly, pinned: form.pinned });
    }
    form = null;
  }

  function remove() {
    if (!form?.id) return;
    const index = countdowns.list.findIndex((x) => x.id === form!.id);
    const old = countdowns.list[index];
    form = null;
    if (!old) return;
    countdowns.remove(old.id);
    toast.show(`已刪除「${old.title}」`, { undo: () => countdowns.restore(old, index) });
  }

  function formKey(e: KeyboardEvent) {
    if (!e.isComposing && e.key === "Enter") save();
  }

  // ---- 日期計算 ----
  let mode = $state<"diff" | "add">("diff");
  let from = $state(store.today);
  let to = $state(addDays(store.today, 100));
  let base = $state(store.today);
  let sign = $state<1 | -1>(1);
  let amount = $state(100);

  const diff = $derived(from && to ? diffDays(from, to) : null);
  const added = $derived(base && Number.isFinite(amount) ? addDays(base, sign * Math.trunc(amount)) : null);

  function weeks(n: number): string {
    const a = Math.abs(n);
    return a >= 7 ? `${Math.floor(a / 7)} 週${a % 7 ? ` ${a % 7} 天` : ""}` : "";
  }
</script>

<div class="page">
  <TopBar title="倒數日" lead="menu" onlead={onmenu} />

  <div class="scroll">
    {#if nearest}
      <button class="hero" onclick={() => openEdit(nearest)}>
        <span class="htext">
          <span class="hlabel">最近的一個</span>
          <span class="htitle clip">{nearest.title}</span>
          <span class="hdate">{fullDate(nearest.target)}</span>
        </span>
        {#if nearest.n === 0}
          <b class="hnow">就是今天</b>
        {:else}
          <span class="hnum"><b>{nearest.n}</b>天</span>
        {/if}
      </button>
    {/if}

    {#if items.length}
      <h2 class="section">全部 · {items.length}</h2>
      <div class="cards">
        {#each items as c (c.id)}
          {@const onHome = c.pinned !== false}
          <div class="card" class:past={c.n < 0}>
            <button class="cbody" onclick={() => openEdit(c)} aria-label="編輯「{c.title}」">
              <span class="ctext">
                <span class="ctitle clip">{c.title}</span>
                <span class="csub">{fullDate(c.target)}{c.yearly ? ` · 每年${c.nth > 0 ? ` · ${c.nth} 週年` : ""}` : ""}</span>
              </span>
              <span class="cnum">
                {#if c.n === 0}
                  <b class="now">今天</b>
                {:else}
                  <small>{c.n > 0 ? "還有" : "已經過了"}</small>
                  <span><b>{Math.abs(c.n)}</b>天</span>
                {/if}
              </span>
            </button>
            <button
              class="pin"
              class:on={onHome}
              aria-pressed={onHome}
              aria-label={onHome ? `從主頁拿掉「${c.title}」` : `把「${c.title}」顯示在主頁`}
              onclick={() => countdowns.setPinned(c.id, !onHome)}
            >
              <Icon name="pin" size={22} fill={onHome} />
            </button>
          </div>
        {/each}
      </div>
      <p class="note"><Icon name="pin" size={16} />釘選的倒數日會顯示在主頁 · 只存在這台裝置</p>
    {:else}
      <p class="empty">還沒有倒數日。按右下角的「新增倒數」，例如考試、生日、紀念日。</p>
    {/if}

    <section class="calc">
      <div class="calc-head">
        <h2>日期計算</h2>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={mode === "diff"} class:on={mode === "diff"} onclick={() => (mode = "diff")}>相差幾天</button>
          <button role="tab" aria-selected={mode === "add"} class:on={mode === "add"} onclick={() => (mode = "add")}>加減天數</button>
        </div>
      </div>

      {#if mode === "diff"}
        <div class="row">
          <label class="pair"><span>從</span><input class="input" type="date" bind:value={from} /></label>
          <label class="pair"><span>到</span><input class="input" type="date" bind:value={to} /></label>
        </div>
        {#if diff !== null}
          <div class="result">
            <span class="big"><small>相差</small><b>{Math.abs(diff)}</b><small>天</small></span>
            <span class="rsub">{[weeks(diff), spanText(from, to)].filter(Boolean).join(" · ") || (diff === 0 ? "同一天" : "")}</span>
            <button class="text-btn" onclick={() => openNew(to)}><Icon name="plus" size={16} stroke={1.8} />存成倒數日</button>
          </div>
        {/if}
      {:else}
        <div class="row">
          <input class="input" type="date" bind:value={base} aria-label="日期" />
          <div class="seg small">
            <button class:on={sign === 1} onclick={() => (sign = 1)} aria-label="往後">＋</button>
            <button class:on={sign === -1} onclick={() => (sign = -1)} aria-label="往前">－</button>
          </div>
          <input class="input num" type="number" min="0" inputmode="numeric" bind:value={amount} aria-label="天數" />
          <span class="unit">天</span>
        </div>
        {#if added}
          <div class="result">
            <span class="big"><b class="date-big">{fullDate(added)}</b></span>
            <span class="rsub">{added === today ? "就是今天" : dayDistance(added, today)}</span>
            <button class="text-btn" onclick={() => openNew(added)}><Icon name="plus" size={16} stroke={1.8} />存成倒數日</button>
          </div>
        {/if}
      {/if}
    </section>
  </div>

  <Fab label="新增倒數" onclick={() => openNew()} />
</div>

{#if form}
  <Sheet label={form.id ? "編輯倒數日" : "新增倒數日"} onclose={() => (form = null)}>
    <h2>{form.id ? "編輯倒數日" : "新增倒數日"}</h2>
    <label class="field">
      <span class="flabel">名稱</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={form.title} onkeydown={formKey} placeholder="例如：期末考、生日" enterkeyhint="done" autofocus={!form.id} />
    </label>
    <label class="field">
      <span class="flabel">日期</span>
      <input type="date" bind:value={form.date} />
    </label>
    <label class="switch-row">
      <span><span class="sw-title">每年重複</span><span class="sw-sub">生日、紀念日：倒數到下一次的這一天</span></span>
      <input type="checkbox" role="switch" class="switch" bind:checked={form.yearly} />
    </label>
    <label class="switch-row">
      <span class="sw-title">顯示在主頁</span>
      <input type="checkbox" role="switch" class="switch" bind:checked={form.pinned} />
    </label>
    <div class="actions">
      {#if form.id}<button class="text-btn danger" onclick={remove}><Icon name="trash" size={18} />刪除</button>{/if}
      <span class="grow"></span>
      <button class="text-btn" onclick={() => (form = null)}>取消</button>
      <button class="primary" onclick={save} disabled={!form.title.trim() || !form.date}>{form.id ? "儲存" : "新增"}</button>
    </div>
  </Sheet>
{/if}

<style>
  .page {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 96px;
  }
  .hero {
    width: calc(100% - 32px);
    margin: 4px 16px 0;
    padding: 20px;
    border-radius: 28px;
    background: var(--accent-container);
    color: var(--on-accent-container);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
  }
  .htext {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hlabel,
  .hdate {
    font-size: 13px;
  }
  .htitle {
    font-size: 22px;
    font-weight: 700;
  }
  .hnum {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-size: 15px;
  }
  .hnum b {
    font-size: 60px;
    line-height: 1;
  }
  .hnow {
    font-size: 26px;
  }
  .section {
    margin: 0;
    padding: 20px 20px 8px;
    font-size: 14px;
    font-weight: 700;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 16px;
  }
  .card {
    display: flex;
    align-items: center;
    border-radius: 20px;
    background: var(--c);
  }
  .cbody {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 4px 12px 18px;
    text-align: left;
  }
  .ctext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ctitle {
    font-size: 16px;
    font-weight: 500;
  }
  .csub {
    font-size: 13px;
    color: var(--sub);
  }
  .cnum {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 13px;
    color: var(--sub);
  }
  .cnum b {
    font-size: 26px;
    font-weight: 700;
    margin-right: 3px;
    color: var(--accent);
  }
  .card.past .cnum b {
    color: var(--text);
  }
  .cnum b.now {
    font-size: 20px;
    color: var(--warn);
  }
  .pin {
    flex: none;
    width: 48px;
    height: 48px;
    margin-right: 6px;
    border-radius: 24px;
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .pin.on {
    color: var(--accent);
  }
  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 12px 20px 0;
    font-size: 13px;
    color: var(--sub);
  }
  .empty {
    margin: 0;
    padding: 32px 24px 8px;
    text-align: center;
    font-size: 14px;
    line-height: 1.7;
    color: var(--sub);
  }
  .calc {
    margin: 24px 16px 0;
    padding: 16px;
    border-radius: 20px;
    background: var(--c);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .calc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .calc h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }
  .seg {
    display: inline-flex;
    height: 36px;
    border: 1px solid var(--faint);
    border-radius: 18px;
    overflow: hidden;
  }
  .seg button {
    padding: 0 14px;
    font-size: 13px;
    font-weight: 500;
  }
  .seg button + button {
    border-left: 1px solid var(--faint);
  }
  .seg button.on {
    background: var(--sel);
    color: var(--on-sel);
  }
  .seg.small button {
    width: 40px;
    padding: 0;
    font-size: 16px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--sub);
  }
  .input {
    height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 12px;
    background: var(--c-highest);
    font-size: 15px;
    outline: none;
  }
  .input.num {
    width: 90px;
  }
  .unit {
    font-size: 14px;
    color: var(--sub);
  }
  .result {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .big {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .big b {
    font-size: 32px;
    font-weight: 700;
    color: var(--accent);
  }
  .big b.date-big {
    font-size: 20px;
  }
  .big small,
  .rsub {
    font-size: 13px;
    color: var(--sub);
  }
  .result .text-btn {
    margin-left: -12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    padding: 8px 16px 10px;
    border-radius: 12px 12px 0 0;
    background: var(--c-highest);
    border-bottom: 2px solid var(--accent);
  }
  .flabel {
    font-size: 12px;
    color: var(--accent);
  }
  .field input {
    border: 0;
    outline: 0;
    background: none;
    padding: 0;
    font-size: 17px;
  }
  .field input::placeholder {
    color: var(--faint);
  }
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 56px;
    padding: 4px 4px;
  }
  .switch-row > span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sw-title {
    font-size: 16px;
  }
  .sw-sub {
    font-size: 13px;
    color: var(--sub);
  }
  .switch {
    appearance: none;
    flex: none;
    position: relative;
    width: 52px;
    height: 32px;
    margin: 0;
    border-radius: 16px;
    border: 2px solid var(--faint);
    background: var(--c-highest);
    transition: background 0.2s, border-color 0.2s;
  }
  .switch::after {
    content: "";
    position: absolute;
    top: 6px;
    left: 6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--faint);
    transition: transform 0.2s, width 0.2s, height 0.2s, top 0.2s, left 0.2s, background 0.2s;
  }
  .switch:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch:checked::after {
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    transform: translateX(20px);
    background: var(--on-accent);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }
  .grow {
    flex: 1;
  }
</style>
