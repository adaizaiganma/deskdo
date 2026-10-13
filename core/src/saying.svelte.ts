/**
 * 每日一言：連得上網時用 uapis.cn 的每日一句，抓不到就用內建的句子（quotes.ts）。
 * 那邊是簡體，抓到後轉成繁體（opencc-js，一 MB 多的字典，用到才載入），連同日期存在這台裝置，一天只抓一次。點一下可以換一句（random），換過的那句當天都會留著。
 * 要哪幾種句子在設定裡選（sayingPrefs，只存在這台裝置）；換了類型就重新抓一句。
 * 英文介面不連網，用內建的英文句子（QUOTES_EN），點一下隨便換一句。
 */
import { i18n } from "./i18n.svelte";
import { QUOTES_EN, quoteOf, type Quote } from "./quotes";

const API = "https://uapis.cn/api/v1/saying/random";
const KEY = "deskdo.saying";
const CATEGORIES_KEY = "deskdo.sayingCategories";
/** 抓失敗後隔多久才再試 */
const RETRY_MS = 5 * 60_000;

/** 可以選的類型：id 是 API 用的名稱（簡體），label 顯示在設定裡 */
export const SAYING_CATEGORIES = [
  { id: "古诗文", label: "古詩文", en: "Classical prose" },
  { id: "诗词", label: "詩詞", en: "Poetry" },
  { id: "文学", label: "文學", en: "Literature" },
  { id: "哲学", label: "哲學", en: "Philosophy" },
  { id: "影视", label: "影視", en: "Film & TV" },
  { id: "动画", label: "動畫", en: "Anime" },
  { id: "网络", label: "網路", en: "Internet" },
  { id: "原创", label: "原創", en: "Original" },
] as const;

const DEFAULT_CATEGORIES = ["古诗文"];

function readCategories(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(CATEGORIES_KEY) ?? "null");
    const known = Array.isArray(list) ? SAYING_CATEGORIES.map((c) => c.id).filter((id) => list.includes(id)) : [];
    return known.length ? known : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

class SayingPrefs {
  /** 照 SAYING_CATEGORIES 的順序，至少一種 */
  categories = $state<string[]>(readCategories());

  /** 開關一種類型；最後一種關不掉 */
  toggle(id: string) {
    const on = this.categories.includes(id);
    if (on && this.categories.length === 1) return;
    this.categories = SAYING_CATEGORIES.map((c) => c.id).filter((c) => (c === id ? !on : this.categories.includes(c)));
    try {
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(this.categories));
    } catch {}
  }
}

export const sayingPrefs = new SayingPrefs();

interface Item {
  content?: unknown;
  author?: unknown;
  source?: unknown;
}

/** 篇名是這些的話只是類型，不是真的出處 */
const GENERIC_TITLES = new Set(["网络", "原创"]);

/** API 回傳的一句轉成 Quote：出處寫成「作者《篇名》」，跟內建的一樣 */
export function toQuote(item: Item, convert: (s: string) => string = (s) => s): Quote | null {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const text = str(item.content);
  if (!text) return null;
  const author = str(item.author);
  let title = str(item.source);
  if (title === author || (author && GENERIC_TITLES.has(title))) title = "";
  const source = author && title ? `${author}《${title}》` : author || title;
  return { text: convert(text), source: convert(source) };
}

/** 存著的句子：同一天、同樣的類型才算數 */
function cached(day: string, cats: string): Quote | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    // 還沒有類型設定以前存的，當成預設的古詩文
    const savedCats = c?.cats ?? DEFAULT_CATEGORIES.join(",");
    return c?.day === day && savedCats === cats && typeof c.text === "string" ? { text: c.text, source: String(c.source ?? "") } : null;
  } catch {
    return null;
  }
}

function save(day: string, cats: string, q: Quote) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day, cats, ...q }));
  } catch {}
}

/** daily：當天大家都一樣的那句；random：隨便一句（點一下換句子）。cats 是用逗號隔開的類型 */
async function fetchQuote(mode: "daily" | "random", cats: string): Promise<Quote> {
  const url = `${API}?mode=${mode}&category=${encodeURIComponent(cats)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const { Converter } = await import("opencc-js/cn2t");
  // daily 的句子包在 item 裡，random 直接就是句子
  const q = toQuote(body?.item ?? body ?? {}, Converter({ from: "cn", to: "tw" }));
  if (!q) throw new Error("沒有內容");
  return q;
}

let pending: { key: string; p: Promise<Quote | null> } | null = null;
let failedAt = 0;

function fetchDaily(day: string, cats: string): Promise<Quote | null> {
  return fetchQuote("daily", cats).then(
    (q) => (save(day, cats, q), q),
    (e) => {
      console.warn("每日一言抓不到，用內建的句子", e);
      failedAt = Date.now();
      pending = null;
      return null;
    },
  );
}

/** 在元件初始化時呼叫：current 先是存著的或內建的句子，抓到當天的句子後換掉；refresh() 換一句，當天都顯示換過的 */
export function dailyQuote(today: () => string) {
  const cats = () => sayingPrefs.categories.join(",");
  let online = $state<Quote | null>(cached(today(), cats()));
  let loading = $state(false);
  /** 英文介面換過的句子（當天有效） */
  let english = $state<{ day: string; q: Quote } | null>(null);
  /** 換過句子後，還沒回來的每日一句就不要蓋掉它 */
  let picked = 0;
  let shownDay = today();

  $effect(() => {
    if (i18n.en) return;
    const day = today();
    const c = cats();
    // 只寫不讀 online，不然換句子時會再跑一次。換了類型時先留著原本的句子，等新的抓回來
    const saved = cached(day, c);
    if (saved || day !== shownDay) online = saved;
    shownDay = day;
    if (saved || Date.now() - failedAt < RETRY_MS) return;
    const key = `${day}|${c}`;
    if (pending?.key !== key) pending = { key, p: fetchDaily(day, c) };
    const n = picked;
    let alive = true;
    pending.p.then((q) => {
      if (alive && q && n === picked) online = q;
    });
    return () => (alive = false);
  });

  return {
    get current(): Quote {
      if (i18n.en) return english?.day === today() ? english.q : quoteOf(today(), QUOTES_EN);
      return online ?? quoteOf(today());
    },
    get loading() {
      return loading;
    },
    /** 換一句；抓不到就丟出錯誤，原本的句子不變 */
    async refresh() {
      if (loading) return;
      if (i18n.en) {
        const cur = this.current;
        const others = QUOTES_EN.filter((q) => q !== cur);
        english = { day: today(), q: others[Math.floor(Math.random() * others.length)] };
        return;
      }
      loading = true;
      try {
        const day = today();
        const c = cats();
        const q = await fetchQuote("random", c);
        picked++;
        save(day, c, q);
        online = q;
      } finally {
        loading = false;
      }
    },
  };
}
