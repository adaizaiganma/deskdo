<script lang="ts">
  import { countdowns, resolve } from "@deskdo/core/countdowns.svelte";
  import { fullDate, longDate } from "@deskdo/core/dates";

  /** 主頁上一個倒數日的組件：名稱、還有／已經幾天、日期 */
  let { id, today, onopen }: { id: string; today: string; onopen: () => void } = $props();

  const c = $derived.by(() => {
    const x = countdowns.list.find((c) => c.id === id);
    return x ? resolve(x, today) : null;
  });
</script>

{#if c}
  <button class="cdw" onclick={onopen} title="{c.title}・{fullDate(c.target)}">
    <span class="title">{c.title}</span>
    <span class="num">
      {#if c.n === 0}
        <b class="now">就是今天</b>
      {:else}
        <small>{c.n > 0 ? "還有" : "已經"}</small><b class:past={c.n < 0}>{Math.abs(c.n)}</b><small>天</small>
      {/if}
    </span>
    <span class="sub">{longDate(c.target)}</span>
  </button>
{/if}

<style>
  .cdw {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 8px 14px;
    border-radius: 12px;
    text-align: left;
    overflow: hidden;
  }
  .cdw:hover {
    background: var(--hover);
  }
  .title,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-size: calc(13px * var(--fs, 1));
    font-weight: 500;
  }
  .num {
    display: flex;
    align-items: baseline;
    gap: 3px;
    white-space: nowrap;
  }
  small {
    font-size: calc(12px * var(--fs, 1));
    color: var(--sub);
  }
  b {
    font-size: calc(26px * var(--fs, 1));
    font-weight: 700;
    line-height: 1.15;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  b.past {
    color: var(--text);
  }
  b.now {
    font-size: calc(20px * var(--fs, 1));
    color: var(--warn);
  }
  .sub {
    font-size: calc(11.5px * var(--fs, 1));
    color: var(--faint);
  }
</style>
