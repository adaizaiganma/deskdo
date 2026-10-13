import { store } from "@deskdo/core/store.svelte";
import { openUrl } from "@tauri-apps/plugin-opener";

/** 用外部瀏覽器開連結；網頁版開新分頁 */
export function openLink(url: string) {
  if (store.prefs?.web) window.open(url, "_blank", "noopener,noreferrer");
  else void openUrl(url);
}
