<script lang="ts">
  import { countdowns, resolve } from "../lib/countdowns.svelte";
  import { fullDate } from "../lib/dates";
  import Icon from "./Icon.svelte";

  let { today, onopen }: { today: string; onopen: () => void } = $props();

  /** 主頁：加到主頁的倒數日，還沒到的（越近越前面）在前，已經過了的在後 */
  const next = $derived(
    countdowns.list
      .filter((c) => c.pinned !== false)
      .map((c) => resolve(c, today))
      .sort((a, b) => ((a.n >= 0) !== (b.n >= 0) ? (a.n >= 0 ? -1 : 1) : Math.abs(a.n) - Math.abs(b.n))),
  );
</script>

{#if next.length}
  <div class="strip">
    {#each next as c (c.id)}
      <button class="cd" onclick={onopen} title="{c.title}・{fullDate(c.target)}">
        <Icon name="hourglass" size={13} stroke={1.5} />
        <span class="name">{c.title}</span>
        <span class="n" class:now={c.n === 0} class:past={c.n < 0}>{c.n === 0 ? "今天" : c.n > 0 ? `${c.n} 天` : `已 ${-c.n} 天`}</span>
      </button>
    {/each}
  </div>
{:else}
  <button class="empty" onclick={onopen}>還沒有加到主頁的倒數日，到「倒數日」新增</button>
{/if}

<style>
  .strip {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
    padding: 1px 2px;
  }
  .empty {
    font-size: 12.5px;
    color: var(--faint);
    padding: 6px 2px;
  }
  .empty:hover {
    color: var(--accent);
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
  .n.past {
    color: var(--sub);
  }
  .n.now {
    color: var(--warn);
  }
</style>
