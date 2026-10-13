/**
 * 介面語言：中文、英文或跟隨系統。
 * 設定存在 localStorage（同一台裝置的視窗共用，一個視窗改了，其他視窗從 storage 事件收到）；
 * 也告訴後端（Rust 端的系統匣、錯誤訊息、手機主畫面小工具；網頁版不需要）。
 *
 * 文字直接寫在用到的地方：t("待辦", "To-dos")。t() 讀的是 $state，在畫面和 $derived 裡切換語言會自動更新。
 */
import { invoke } from "./backend";

export type LangPref = "system" | "zh" | "en";
export type Lang = "zh" | "en";

const KEY = "app.lang";

function read(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "zh" || v === "en" ? v : "system";
  } catch {
    return "system";
  }
}

function systemLang(): Lang {
  try {
    return (navigator.languages?.[0] ?? navigator.language ?? "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

class I18n {
  pref = $state<LangPref>(read());
  #system = $state<Lang>(systemLang());

  /** 現在實際用的語言 */
  get lang(): Lang {
    return this.pref === "system" ? this.#system : this.pref;
  }

  get en() {
    return this.lang === "en";
  }

  set(pref: LangPref) {
    this.pref = pref;
    try {
      localStorage.setItem(KEY, pref);
    } catch {}
    this.#apply();
  }

  /** 視窗載入時呼叫（在 mount 之前） */
  init() {
    addEventListener("languagechange", () => {
      this.#system = systemLang();
      this.#apply();
    });
    addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      this.pref = read();
      this.#apply();
    });
    this.#apply();
  }

  #apply() {
    document.documentElement.lang = this.en ? "en" : "zh-Hant";
    invoke("set_language", { lang: this.lang }).catch(() => {});
  }
}

export const i18n = new I18n();

/** 依目前的語言選一個 */
export function t(zh: string, en: string): string {
  return i18n.lang === "en" ? en : zh;
}

/** 英文的單複數：plural(3, "day") → "3 days" */
export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** 英文序數：1st、2nd、3rd、11th */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** 排序、比較用的語系 */
export function collator(): string {
  return i18n.lang === "en" ? "en" : "zh-Hant";
}

export const LANG_OPTIONS: { id: LangPref; label: () => string }[] = [
  { id: "system", label: () => t("跟隨系統", "System") },
  { id: "zh", label: () => "中文" },
  { id: "en", label: () => "English" },
];
