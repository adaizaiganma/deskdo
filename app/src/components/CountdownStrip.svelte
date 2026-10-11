<script lang="ts">
  import { countdowns, resolve } from "../lib/countdowns.svelte";
  import { fullDate } from "../lib/dates";
  import Icon from "./Icon.svelte";

  let { today, onopen }: { today: string; onopen: () => void } = $props();

  /** 主頁上方：最近的三個還沒到的倒數日 */
  const next = $derived(
    countdowns.list
      .map((c) => resolve(c, today))
      .filter((c) => c.n >= 0)
      .sort((a, b) => a.n - b.n)
      .slice(0, 3),
  );
</script>

{#if next.length}
  <div class="strip">
    {#each next as c (c.id)}
      <button class="cd" onclick={onopen} title="{c.title}・{fullDate(c.target)}">
        <Icon name="hourglass" size={13} stroke={1.5} />
        <span class="name">{c.title}</span>
        <span class="n" class:now={c.n === 0}>{c.n === 0 ? "今天" : `${c.n} 天`}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 2px 14px;
  }
  .cd {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    height: 32px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--raised);
    box-shadow: 0 0 0 1px var(--line);
    font-size: 13px;
    color: var(--faint);
  }
  .cd:hover {
    background: var(--bg2);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .n {
    flex: none;
    font-weight: 700;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .n.now {
    color: var(--warn);
  }
</style>
