<script lang="ts">
  import { store } from "@deskdo/core/store.svelte";
  import { onMount } from "svelte";
  import { iOS } from "./device";
  import { useSheet, WIDE_QUERY, type Layout } from "./layout";
  import { longPressAsContextMenu } from "./longpress";
  import Pair from "./Pair.svelte";

  const media = matchMedia(WIDE_QUERY);
  let wideScreen = $state(media.matches);
  /** 還沒配對（或被撤銷、登出）時顯示配對頁 */
  const paired = $derived(!!store.prefs?.configured);
  /** 配對頁本身是窄的，一律用手機版的樣式 */
  const want = $derived<Layout>(paired && wideScreen ? "wide" : "narrow");
  /** 已經載入好樣式的版面；和 want 不同時（樣式還在載入）先不顯示 */
  let shown = $state<Layout | null>(null);

  $effect(() => {
    const layout = want;
    useSheet(layout).then(() => {
      if (want === layout) shown = layout;
    });
  });

  // 電腦版介面的右鍵選單：iPad 上用長按（手機版介面自己處理長按）
  $effect(() => {
    if (iOS && want === "wide") return longPressAsContextMenu();
  });

  onMount(() => {
    // iPad 轉向、分割畫面時跟著換
    const change = () => (wideScreen = media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  });
</script>

{#if shown === want}
  {#if !paired}
    <Pair />
  {:else if want === "wide"}
    {#await import("deskdo/windows/Main.svelte") then m}<m.default />{/await}
  {:else}
    {#await import("@deskdo/mobile/windows/Main.svelte") then m}<m.default />{/await}
  {/if}
{/if}
