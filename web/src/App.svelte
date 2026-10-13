<script lang="ts">
  import { store } from "@deskdo/core/store.svelte";
  import MobileMain from "@deskdo/mobile/windows/Main.svelte";
  import Pair from "./Pair.svelte";

  /** 還沒配對（或被撤銷、登出）時顯示配對頁 */
  const paired = $derived(!!store.prefs?.configured);
</script>

{#if paired}
  <MobileMain />
{:else}
  <Pair />
{/if}
