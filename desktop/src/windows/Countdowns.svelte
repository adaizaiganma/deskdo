<script lang="ts">
  import { i18n, ordinal, plural, t } from "@deskdo/core/i18n.svelte";
  import Icon from "../components/Icon.svelte";
  import { countdowns, resolve, type Countdown } from "@deskdo/core/countdowns.svelte";
  import { addDays, dayDistance, diffDays, fullDate, spanText } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import { toast } from "@deskdo/core/toast.svelte";

  let { today }: { today: string } = $props();

  // ---- 倒數日 ----
  let title = $state("");
  // 輸入欄的預設值只在打開頁面時取一次
  let date = $state(addDays(store.today, 30));
  let yearly = $state(false);
  /** 新增的倒數日預設顯示在主頁 */
  let pinned = $state(true);
  let titleInput = $state<HTMLInputElement>();

  const items = $derived(
    countdowns.list
      .map((c) => resolve(c, today))
      // 還沒到的（越近越前面），接著是已經過了的（越近越前面）
      .sort((a, b) => (a.n >= 0) !== (b.n >= 0) ? (a.n >= 0 ? -1 : 1) : Math.abs(a.n) - Math.abs(b.n)),
  );

  function add() {
    const t = title.trim();
    if (!t || !date) return;
    countdowns.add({ title: t, date, yearly, pinned });
    title = "";
    yearly = false;
    pinned = true;
  }

  /** 正在編輯的那一張卡片 */
  let editing = $state<Countdown | null>(null);

  function save() {
    if (!editing) return;
    const t = editing.title.trim();
    if (t && editing.date) countdowns.update(editing.id, { title: t, date: editing.date, yearly: editing.yearly });
    editing = null;
  }

  function remove(c: Countdown) {
    const index = countdowns.list.findIndex((x) => x.id === c.id);
    const old = countdowns.list[index];
    if (!old) return;
    countdowns.remove(c.id);
    editing = null;
    toast.show(t(`已刪除「${old.title}」`, `Deleted "${old.title}"`), { undo: () => countdowns.restore(old, index) });
  }

  function key(e: KeyboardEvent, enter: () => void) {
    if (e.isComposing) return;
    if (e.key === "Enter") enter();
    if (e.key === "Escape") editing = null;
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

  /** 把計算的結果存成倒數日 */
  function keep(d: string) {
    date = d;
    titleInput?.focus();
    titleInput?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function weeks(n: number): string {
    const a = Math.abs(n);
    if (a < 7) return "";
    const w = Math.floor(a / 7);
    if (i18n.en) return [plural(w, "week"), a % 7 && plural(a % 7, "day")].filter(Boolean).join(" ");
    return `${w} 週${a % 7 ? ` ${a % 7} 天` : ""}`;
  }
</script>

<div class="page">
  <header>
    <h1>{t("倒數日", "Countdowns")}</h1>
    <p>{t("距離某一天還有多久、已經過了幾天・只存在這台裝置", "How long until a day, or how long since · stored on this device only")}</p>
  </header>

  <div class="add">
    <input class="text" bind:this={titleInput} bind:value={title} onkeydown={(e) => key(e, add)} placeholder={t("名稱，例如：期末考、生日", "Name, e.g. Finals, Birthday")} aria-label={t("名稱", "Name")} enterkeyhint="done" />
    <input class="date" type="date" bind:value={date} aria-label={t("日期", "Date")} />
    <label class="check"><input type="checkbox" bind:checked={yearly} />{t("每年", "Yearly")}</label>
    <label class="check"><input type="checkbox" bind:checked={pinned} />{t("加到主頁", "Show on home")}</label>
    <button class="primary" onclick={add} disabled={!title.trim() || !date}><Icon name="plus" size={14} stroke={1.8} />{t("新增", "Add")}</button>
  </div>

  {#if items.length}
    <p class="pinned-note">{t(`主頁會顯示加到主頁的倒數日（${items.filter((c) => c.pinned !== false).length} 個）`, `Countdowns marked Show on home appear on the home page (${items.filter((c) => c.pinned !== false).length})`)}</p>
    <div class="cards">
      {#each items as c (c.id)}
        {#if editing?.id === c.id}
          <div class="card edit">
            <input class="text" bind:value={editing.title} onkeydown={(e) => key(e, save)} aria-label={t("名稱", "Name")} />
            <input class="date" type="date" bind:value={editing.date} aria-label={t("日期", "Date")} />
            <label class="check"><input type="checkbox" bind:checked={editing.yearly} />{t("每年重複", "Repeat yearly")}</label>
            <div class="actions">
              <button class="tbtn danger" onclick={() => remove(c)}><Icon name="trash" size={13} stroke={1.5} />{t("刪除", "Delete")}</button>
              <span class="grow"></span>
              <button class="tbtn" onclick={() => (editing = null)}>{t("取消", "Cancel")}</button>
              <button class="primary" onclick={save}>{t("儲存", "Save")}</button>
            </div>
          </div>
        {:else}
          {@const onHome = c.pinned !== false}
          <div class="card" class:past={c.n < 0} class:now={c.n === 0}>
            <span class="ctitle">{c.title}</span>
            <span class="big">
              {#if c.n === 0}
                <b>{t("就是今天", "Today")}</b>
              {:else}
                {#if i18n.en}<b>{Math.abs(c.n)}</b><small>{Math.abs(c.n) === 1 ? "day" : "days"} {c.n > 0 ? "left" : "ago"}</small>{:else}<small>{c.n > 0 ? "還有" : "已經"}</small><b>{Math.abs(c.n)}</b><small>天</small>{/if}
              {/if}
            </span>
            <span class="csub">{[fullDate(c.target), spanText(today, c.target)].filter(Boolean).join(t("・", " · "))}</span>
            {#if c.yearly}
              <span class="csub">{t("每年", "Yearly")}{c.nth > 0 ? t(`・${c.nth} 週年`, ` · ${ordinal(c.nth)} anniversary`) : ""}</span>
            {:else if c.n < 0}
              <span class="csub">{t(`今天是第 ${-c.n + 1} 天`, `Day ${-c.n + 1}`)}</span>
            {/if}
            <!-- 撐開剩下的高度，同一排卡片的按鈕才會對齊 -->
            <span class="spacer"></span>
            <div class="card-foot">
              <button class="pin" class:on={onHome} aria-pressed={onHome} onclick={() => countdowns.setPinned(c.id, !onHome)}>
                <Icon name="home" size={14} />{onHome ? t("已在主頁", "On home") : t("加到主頁", "Show on home")}
              </button>
              <button class="tbtn" onclick={() => (editing = { id: c.id, title: c.title, date: c.date, yearly: c.yearly })} aria-label={t(`編輯「${c.title}」`, `Edit "${c.title}"`)}>{t("編輯", "Edit")}</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="empty">{t("還沒有倒數日。輸入名稱和日期就能新增，例如考試、生日、紀念日。", "No countdowns yet. Enter a name and a date to add one, like an exam, a birthday or an anniversary.")}</p>
  {/if}

  <section class="calc">
    <div class="calc-head">
      <h2>{t("日期計算", "Date calculator")}</h2>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected={mode === "diff"} class:on={mode === "diff"} onclick={() => (mode = "diff")}>{t("相差幾天", "Days between")}</button>
        <button role="tab" aria-selected={mode === "add"} class:on={mode === "add"} onclick={() => (mode = "add")}>{t("加減天數", "Add or subtract")}</button>
      </div>
    </div>

    {#if mode === "diff"}
      <div class="row">
        <!-- 窄的時候「到」和日期一起換行 -->
        <span class="pair"><span class="lbl">{t("從", "From")}</span><input class="date" type="date" bind:value={from} aria-label={t("開始日期", "Start date")} /></span>
        <span class="pair"><span class="lbl">{t("到", "To")}</span><input class="date" type="date" bind:value={to} aria-label={t("結束日期", "End date")} /></span>
      </div>
      {#if diff !== null}
        <div class="result">
          <span class="big">{#if i18n.en}<b>{Math.abs(diff)}</b><small>{Math.abs(diff) === 1 ? "day" : "days"} apart</small>{:else}<small>相差</small><b>{Math.abs(diff)}</b><small>天</small>{/if}</span>
          <span class="csub">
            {[weeks(diff), spanText(from, to)].filter(Boolean).join(t("・", " · ")) || (diff === 0 ? t("同一天", "Same day") : "")}
          </span>
          <button class="tbtn" onclick={() => keep(to)}><Icon name="plus" size={12} stroke={1.8} />{t(`把「${fullDate(to)}」存成倒數日`, `Save ${fullDate(to)} as a countdown`)}</button>
        </div>
      {/if}
    {:else}
      <div class="row">
        <input class="date" type="date" bind:value={base} aria-label={t("日期", "Date")} />
        <div class="seg small">
          <button class:on={sign === 1} onclick={() => (sign = 1)} aria-label={t("往後", "Later")}>＋</button>
          <button class:on={sign === -1} onclick={() => (sign = -1)} aria-label={t("往前", "Earlier")}>－</button>
        </div>
        <input class="num" type="number" min="0" inputmode="numeric" bind:value={amount} aria-label={t("天數", "Days")} />
        <span class="lbl">{t("天", "days")}</span>
      </div>
      {#if added}
        <div class="result">
          <span class="big"><b class="date-big">{fullDate(added)}</b></span>
          <span class="csub">{added === today ? t("就是今天", "Today") : dayDistance(added, today)}</span>
          <button class="tbtn" onclick={() => keep(added)}><Icon name="plus" size={12} stroke={1.8} />{t("存成倒數日", "Save as countdown")}</button>
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 28px 80px;
  }
  header {
    padding: 0 10px 14px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
  }
  header p {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--sub);
  }
  .add,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .text,
  .date,
  .num {
    height: 38px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1.5px solid transparent;
    background: var(--bg2);
    font-size: 14px;
    color: var(--text);
    outline: none;
    font-family: inherit;
  }
  .text:focus,
  .date:focus,
  .num:focus {
    border-color: var(--accent);
    background: var(--raised);
  }
  .add .text {
    flex: 1 1 200px;
    min-width: 0;
  }
  .date {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .num {
    width: 96px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--sub);
    cursor: pointer;
  }
  .check input {
    accent-color: var(--accent);
    width: 15px;
    height: 15px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-size: 13.5px;
    font-weight: 500;
  }
  .primary:disabled {
    opacity: 0.4;
  }
  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--sub);
  }
  .tbtn:hover {
    background: var(--hover);
    color: var(--text);
  }
  .tbtn.danger {
    color: var(--warn);
  }
  .grow {
    flex: 1;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
    margin-top: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--raised);
    box-shadow: var(--card-shadow);
    text-align: left;
  }
  .spacer {
    flex: 1;
    min-height: 4px;
  }
  .card-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .pin {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--bg2);
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sub);
    transition: background 0.12s, color 0.12s;
  }
  .pin:hover {
    color: var(--text);
  }
  .pin.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .pinned-note {
    margin: 18px 10px 0;
    font-size: 12.5px;
    color: var(--sub);
  }
  .card.edit {
    gap: 8px;
  }
  .card.edit .text,
  .card.edit .date {
    width: 100%;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    margin-top: 2px;
  }
  .actions .primary {
    height: 30px;
    padding: 0 14px;
    font-size: 12.5px;
  }
  .ctitle {
    max-width: 100%;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .big {
    display: flex;
    align-items: baseline;
    gap: 4px;
    color: var(--accent);
  }
  .big b {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .big small {
    font-size: 13px;
    color: var(--sub);
  }
  .past .big {
    color: var(--text);
  }
  .now .big b {
    font-size: 24px;
    color: var(--warn);
  }
  .csub {
    font-size: 12px;
    color: var(--faint);
  }
  .csub:empty {
    display: none;
  }
  .empty {
    margin: 18px 10px 0;
    font-size: 13px;
    color: var(--sub);
    line-height: 1.7;
  }

  .calc {
    margin-top: 32px;
    padding: 16px;
    border-radius: 14px;
    background: var(--raised);
    box-shadow: var(--card-shadow);
  }
  .calc-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: 9px;
    background: var(--bg2);
  }
  .seg button {
    height: 28px;
    padding: 0 12px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--sub);
  }
  .seg button.on {
    background: var(--raised);
    color: var(--text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .seg.small button {
    width: 34px;
    padding: 0;
    font-size: 15px;
  }
  .pair {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .lbl {
    font-size: 13px;
    color: var(--sub);
  }
  .result {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin-top: 14px;
  }
  .result .tbtn {
    margin: 4px 0 0 -10px;
    color: var(--accent);
  }
  .date-big {
    font-size: 22px !important;
  }

</style>
