/**
 * 每日一言：連得上網時用 uapis.cn 的每日一句（古詩文），抓不到就用內建的句子（quotes.ts）。
 * 那邊是簡體，抓到後轉成繁體（opencc-js，一 MB 多的字典，用到才載入），連同日期存在這台裝置，一天只抓一次。點一下可以換一句（random），換過的那句當天都會留著。
 */
import { quoteOf, type Quote } from "./quotes";

const API = "https://uapis.cn/api/v1/saying/random?category=" + encodeURIComponent("古诗文");
const KEY = "deskdo.saying";
/** 抓失敗後隔多久才再試 */
const RETRY_MS = 5 * 60_000;

interface Item {
  content?: unknown;
  author?: unknown;
  source?: unknown;
}

/** API 回傳的一句轉成 Quote：出處寫成「作者《篇名》」，跟內建的一樣 */
export function toQuote(item: Item, convert: (s: string) => string = (s) => s): Quote | null {
  const str = (v: unknown) => (typeof v === "string" ? convert(v.trim()) : "");
  const text = str(item.content);
  if (!text) return null;
  const author = str(item.author);
  const title = str(item.source);
  const source = author && title ? `${author}《${title}》` : author || title;
  return { text, source };
}

function cached(day: string): Quote | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return c?.day === day && typeof c.text === "string" ? { text: c.text, source: String(c.source ?? "") } : null;
  } catch {
    return null;
  }
}

function save(day: string, q: Quote) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ day, ...q }));
  } catch {}
}

/** daily：當天大家都一樣的那句；random：隨便一句（點一下換句子） */
async function fetchQuote(mode: "daily" | "random"): Promise<Quote> {
  const res = await fetch(`${API}&mode=${mode}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const { Converter } = await import("opencc-js/cn2t");
  // daily 的句子包在 item 裡，random 直接就是句子
  const q = toQuote(body?.item ?? body ?? {}, Converter({ from: "cn", to: "tw" }));
  if (!q) throw new Error("沒有內容");
  return q;
}

let pending: { day: string; p: Promise<Quote | null> } | null = null;
let failedAt = 0;

function fetchDaily(day: string): Promise<Quote | null> {
  return fetchQuote("daily").then(
    (q) => (save(day, q), q),
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
  let online = $state<Quote | null>(cached(today()));
  let loading = $state(false);
  /** 換過句子後，還沒回來的每日一句就不要蓋掉它 */
  let picked = 0;

  $effect(() => {
    const day = today();
    // 只寫不讀 online，不然換句子時會再跑一次
    const saved = cached(day);
    online = saved;
    if (saved || Date.now() - failedAt < RETRY_MS) return;
    if (pending?.day !== day) pending = { day, p: fetchDaily(day) };
    const n = picked;
    let alive = true;
    pending.p.then((q) => {
      if (alive && q && n === picked) online = q;
    });
    return () => (alive = false);
  });

  return {
    get current(): Quote {
      return online ?? quoteOf(today());
    },
    get loading() {
      return loading;
    },
    /** 換一句；抓不到就丟出錯誤，原本的句子不變 */
    async refresh() {
      if (loading) return;
      loading = true;
      try {
        const day = today();
        const q = await fetchQuote("random");
        picked++;
        save(day, q);
        online = q;
      } finally {
        loading = false;
      }
    },
  };
}
