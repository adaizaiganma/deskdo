<script lang="ts" module>
  export type Tab = "home" | "all" | "calendar" | "countdown";
</script>

<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";

  let { current, ongo }: { current: Tab | null; ongo: (tab: Tab) => void } = $props();

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: "home", label: "主頁", icon: "home" },
    { id: "all", label: "全部", icon: "inbox" },
    { id: "calendar", label: "日曆", icon: "calendar" },
    { id: "countdown", label: "倒數日", icon: "hourglass" },
  ];
</script>

<nav class="bar" aria-label="主要頁面">
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
