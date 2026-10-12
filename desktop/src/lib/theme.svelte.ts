/**
 * 深色、淺色或跟著 Windows。用 Tauri 的 setTheme 套到整個 App（主視窗、桌面小工具都會變），
 * 網頁的 prefers-color-scheme 也跟著變，所以 CSS 和桌面小工具的毛玻璃不用另外處理。
 * 存在 localStorage（兩個視窗共用），哪個視窗先載入就先套用。
 */
import { setTheme } from "@tauri-apps/api/app";

export type ThemePref = "system" | "light" | "dark";

export const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "跟隨系統" },
  { id: "light", label: "淺色" },
  { id: "dark", label: "深色" },
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

function apply(pref: ThemePref) {
  setTheme(pref === "system" ? null : pref).catch((e) => console.warn("無法切換深色、淺色", e));
}

class Theme {
  pref = $state<ThemePref>(read());

  set(pref: ThemePref) {
    this.pref = pref;
    try {
      localStorage.setItem(KEY, pref);
    } catch {}
    apply(pref);
  }

  /** 視窗載入時呼叫 */
  init() {
    apply(this.pref);
  }
}

export const theme = new Theme();
