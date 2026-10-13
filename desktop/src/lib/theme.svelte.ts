/**
 * 深色、淺色或跟隨系統。
 * - 網頁：在 <html> 加上 data-theme="dark" / "light"，CSS 依這個切換（跟隨系統時看 prefers-color-scheme）。
 * - 視窗：Tauri 的 setTheme 讓標題列、Mica 背景也跟著變。
 * 設定存在 localStorage（主視窗和桌面小工具共用）；一個視窗改了，另一個從 storage 事件收到。
 */
import { t } from "@deskdo/core/i18n.svelte";
import { setTheme } from "@tauri-apps/api/app";

export type ThemePref = "system" | "light" | "dark";

export const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", get label() { return t("跟隨系統", "System"); } },
  { id: "light", get label() { return t("淺色", "Light"); } },
  { id: "dark", get label() { return t("深色", "Dark"); } },
];

const KEY = "app.theme";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

class Theme {
  pref = $state<ThemePref>(read());
  #systemDark = $state(false);

  /** 現在實際是不是深色 */
  get dark() {
    return this.pref === "dark" || (this.pref === "system" && this.#systemDark);
  }

  set(pref: ThemePref) {
    this.pref = pref;
    try {
      localStorage.setItem(KEY, pref);
    } catch {}
    this.#apply();
  }

  /** 視窗載入時呼叫（在 mount 之前，第一次畫面就是對的顏色） */
  init() {
    const media = matchMedia("(prefers-color-scheme: dark)");
    this.#systemDark = media.matches;
    media.addEventListener("change", () => {
      this.#systemDark = media.matches;
      this.#paint();
    });
    addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      this.pref = read();
      this.#apply();
    });
    this.#apply();
  }

  #paint() {
    document.documentElement.dataset.theme = this.dark ? "dark" : "light";
  }

  #apply() {
    // 強制深色、淺色時 WebView 的 prefers-color-scheme 可能也跟著變；改回跟隨系統後會再收到 change，那時再畫一次
    this.#paint();
    setTheme(this.pref === "system" ? null : this.pref).catch((e) => console.warn("無法切換視窗的深色、淺色", e));
  }
}

export const theme = new Theme();
