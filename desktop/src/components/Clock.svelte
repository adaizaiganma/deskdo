<script lang="ts">
  import { onMount } from "svelte";

  import type { ClockStyle } from "@deskdo/core/homePrefs.svelte";

  /** analog = 指針時鐘，下面一行小的數位時間；digital = 只有大字的數位時間 */
  let { size = 132, mode = "analog" }: { size?: number; mode?: ClockStyle } = $props();

  let now = $state(new Date());

  onMount(() => {
    // 對齊到整秒再開始跳，秒針才不會比系統時間慢半拍
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      now = new Date();
      timer = setInterval(() => (now = new Date()), 1000);
    }, 1000 - (Date.now() % 1000));
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  });

  const s = $derived(now.getSeconds());
  const m = $derived(now.getMinutes() + s / 60);
  const h = $derived((now.getHours() % 12) + m / 60);
  const label = $derived(now.toLocaleTimeString("zh-TW", { hour: "numeric", minute: "2-digit" }));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = $derived(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  const sec = $derived(`:${pad(s)}`);
</script>

{#if mode === "digital"}
  <div class="digital" role="timer" aria-label="現在時間 {label}">
    <span class="hm">{hm}</span><span class="sec">{sec}</span>
  </div>
{:else}
  <div class="analog">
    <svg class="clock" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="現在時間 {label}">
      <circle class="face" cx="50" cy="50" r="47" />
      {#each Array(12) as _, i (i)}
        <line class="tick" class:major={i % 3 === 0} x1="50" y1={i % 3 === 0 ? 9 : 10} x2="50" y2={i % 3 === 0 ? 16 : 14} transform="rotate({i * 30} 50 50)" />
      {/each}
      <line class="hand hour" x1="50" y1="54" x2="50" y2="28" transform="rotate({h * 30} 50 50)" />
      <line class="hand minute" x1="50" y1="56" x2="50" y2="17" transform="rotate({m * 6} 50 50)" />
      <line class="hand second" x1="50" y1="60" x2="50" y2="14" transform="rotate({s * 6} 50 50)" />
      <circle class="pin" cx="50" cy="50" r="2.6" />
    </svg>
    <div class="small" aria-hidden="true"><span>{hm}</span><span class="sec">{sec}</span></div>
  </div>
{/if}

<style>
  .analog {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .clock {
    display: block;
  }
  .small,
  .digital {
    display: flex;
    align-items: baseline;
    gap: 1px;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .small span:first-child {
    font-size: calc(22px * var(--fs, 1));
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .small .sec {
    font-size: calc(13px * var(--fs, 1));
    font-weight: 500;
    color: var(--faint);
  }
  .digital {
    flex: none;
    gap: 2px;
  }
  .digital .hm {
    font-size: calc(56px * var(--fs, 1));
    font-weight: 800;
    letter-spacing: 0.01em;
  }
  .digital .sec {
    font-size: calc(22px * var(--fs, 1));
    font-weight: 600;
    color: var(--faint);
  }
  .face {
    fill: var(--raised);
    stroke: var(--line);
    stroke-width: 1.5;
  }
  .tick {
    stroke: var(--faint);
    stroke-width: 1.2;
    stroke-linecap: round;
  }
  .tick.major {
    stroke: var(--sub);
    stroke-width: 2.2;
  }
  .hand {
    stroke: var(--text);
    stroke-linecap: round;
  }
  .hour {
    stroke-width: 4;
  }
  .minute {
    stroke-width: 2.6;
  }
  .second {
    stroke: var(--accent);
    stroke-width: 1.2;
  }
  .pin {
    fill: var(--accent);
  }
</style>
