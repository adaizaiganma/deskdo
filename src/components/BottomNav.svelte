<script lang="ts" module>
  import { t } from "@deskdo/core/i18n.svelte";
  export type Tab = "home" | "all" | "calendar" | "countdown";
</script>

<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";

  let { current, ongo }: { current: Tab | null; ongo: (tab: Tab) => void } = $props();

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: "home", get label() { return t("主頁", "Home"); }, icon: "home" },
    { id: "all", get label() { return t("全部", "All"); }, icon: "inbox" },
    { id: "calendar", get label() { return t("日曆", "Calendar"); }, icon: "calendar" },
    { id: "countdown", get label() { return t("倒數日", "Countdowns"); }, icon: "hourglass" },
  ];
</script>

<nav class="bar" aria-label={t("主要頁面", "Main pages")}>
  {#each tabs as t (t.id)}
    <button class="tab" class:on={current === t.id} aria-current={current === t.id ? "page" : undefined} onclick={() => ongo(t.id)}>
      <span class="pill-ind"><Icon name={t.icon} size={24} /></span>
      <span class="label">{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .bar {
    flex: none;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    height: calc(80px + var(--nav-inset));
    padding-bottom: var(--nav-inset);
    background: var(--c);
  }
  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--sub);
  }
  .pill-ind {
    width: 64px;
    height: 32px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    transition: background 0.2s;
  }
  .label {
    font-size: 12px;
    font-weight: 500;
  }
  .tab.on {
    color: var(--text);
  }
  .tab.on .pill-ind {
    background: var(--sel);
    color: var(--on-sel);
  }
  .tab.on .label {
    font-weight: 700;
  }
</style>
