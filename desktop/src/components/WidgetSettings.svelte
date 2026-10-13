<script lang="ts">
  import { i18n, t } from "@deskdo/core/i18n.svelte";
  import { homePrefs, type ClockStyle } from "@deskdo/core/homePrefs.svelte";
  import { SAYING_CATEGORIES, sayingPrefs } from "@deskdo/core/saying.svelte";
  import { spec, type WidgetId } from "../lib/homeLayout.svelte";
  import { BG_OPTIONS, FONT_SCALES, homeStyle } from "../lib/homeStyle.svelte";
  import Popover from "./Popover.svelte";

  /** 單一組件的設定：背景、字體大小（可以跟著主頁），還有組件自己的選項（時鐘樣式、一言類型） */
  let { id, x, y, onclose }: { id: WidgetId; x: number; y: number; onclose: () => void } = $props();

  const own = $derived(homeStyle.own(id));
  const label = (list: { id: unknown; label: string }[], v: unknown) => list.find((o) => o.id === v)?.label;

  const clockStyles: { id: ClockStyle; label: string }[] = [
    { id: "analog", get label() { return t("指針", "Analog"); } },
    { id: "digital", get label() { return t("數位", "Digital"); } },
  ];
</script>

<Popover {x} {y} title={t(`${spec(id).label}・組件設定`, `${spec(id).label} · Widget settings`)} {onclose}>
  {#if id === "clock"}
    <div class="opt">
      <div class="opt-name">{t("時鐘樣式", "Clock style")}</div>
      <div class="seg" role="radiogroup" aria-label={t("時鐘樣式", "Clock style")}>
        {#each clockStyles as c (c.id)}
          <button role="radio" aria-checked={homePrefs.clock === c.id} class:on={homePrefs.clock === c.id} onclick={() => homePrefs.setClock(c.id)}>{c.label}</button>
        {/each}
      </div>
    </div>
  {:else if id === "quote"}
    <div class="opt">
      <div class="opt-name">{t("句子類型", "Quote types")}</div>
      {#if i18n.en}
        <div class="hint">English quotes are built in. Switch the language to Chinese to pick quote types.</div>
      {:else}
      <div class="chips" role="group" aria-label="每日一言的類型">
        {#each SAYING_CATEGORIES as c (c.id)}
          {@const on = sayingPrefs.categories.includes(c.id)}
          <button class="chip" class:on aria-pressed={on} onclick={() => sayingPrefs.toggle(c.id)}>{c.label}</button>
        {/each}
      </div>
      <div class="hint">可以選好幾種，換了之後會抓一句新的</div>
      {/if}
    </div>
  {/if}

  <div class="opt">
    <div class="opt-name">
      <span>{t("背景", "Background")}</span>
      {#if own.bg === undefined}<span class="follow">{t("跟著主頁：", "Same as home: ")}{label(BG_OPTIONS, homeStyle.bg)}</span>{/if}
    </div>
    <div class="seg" role="radiogroup" aria-label={t("背景", "Background")}>
      <button role="radio" aria-checked={own.bg === undefined} class:on={own.bg === undefined} onclick={() => homeStyle.setWidget(id, { bg: undefined })}>{t("跟著主頁", "Same as home")}</button>
      {#each BG_OPTIONS as o (o.id)}
        <button role="radio" aria-checked={own.bg === o.id} class:on={own.bg === o.id} onclick={() => homeStyle.setWidget(id, { bg: o.id })}>{o.label}</button>
      {/each}
    </div>
  </div>

  <div class="opt">
    <div class="opt-name">
      <span>{t("字體大小", "Font size")}</span>
      {#if own.fs === undefined}<span class="follow">{t("跟著主頁：", "Same as home: ")}{label(FONT_SCALES, homeStyle.fs)}</span>{/if}
    </div>
    <div class="seg" role="radiogroup" aria-label={t("字體大小", "Font size")}>
      <button role="radio" aria-checked={own.fs === undefined} class:on={own.fs === undefined} onclick={() => homeStyle.setWidget(id, { fs: undefined })}>{t("跟著主頁", "Same as home")}</button>
      {#each FONT_SCALES as o (o.id)}
        <button role="radio" aria-checked={own.fs === o.id} class:on={own.fs === o.id} onclick={() => homeStyle.setWidget(id, { fs: o.id })}>{o.label}</button>
      {/each}
    </div>
  </div>
</Popover>

<style>
  .follow {
    font-size: 11.5px;
    color: var(--faint);
  }
</style>
