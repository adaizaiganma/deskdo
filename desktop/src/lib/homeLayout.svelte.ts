/**
 * 主頁左半的組件版面。格子的大小是固定的（不跟著視窗縮放），視窗寬一點就多幾欄。
 * 每個組件有位置和大小（以格子為單位），只存在這台裝置（localStorage）。
 */
import { t } from "@deskdo/core/i18n.svelte";
import { countdowns } from "@deskdo/core/countdowns.svelte";

export type BaseId = "date" | "clock" | "quote" | "matrix";
/** 加到主頁的倒數日各自是一個組件：cd:<倒數日的 id> */
export type WidgetId = BaseId | `cd:${string}`;

/** 以格子為單位：x、w 是欄，y、h 是列 */
export interface Box {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一格的邊長和格子間距（px） */
export const CELL = 40;
export const GAP = 12;
export const STEP = CELL + GAP;

/** 格子數換成 px */
export const span = (n: number) => n * STEP - GAP;

export const BASE: Record<BaseId, { label: string; minW: number; minH: number }> = {
  date: { get label() { return t("日期", "Date"); }, minW: 4, minH: 2 },
  clock: { get label() { return t("時鐘", "Clock"); }, minW: 2, minH: 2 },
  quote: { get label() { return t("每日一言", "Daily quote"); }, minW: 4, minH: 2 },
  matrix: { get label() { return t("優先矩陣", "Priority matrix"); }, minW: 6, minH: 5 },
};
export const BASE_IDS = Object.keys(BASE) as BaseId[];

/** 倒數日組件的預設和最小大小 */
const COUNTDOWN = { w: 3, h: 2, minW: 2, minH: 2 };

export const isCountdown = (id: WidgetId): id is `cd:${string}` => id.startsWith("cd:");
export const countdownId = (id: `cd:${string}`) => id.slice(3);

/** 組件的名稱和最小大小 */
export function spec(id: WidgetId): { label: string; minW: number; minH: number } {
  if (!isCountdown(id)) return BASE[id];
  const c = countdowns.list.find((x) => x.id === countdownId(id));
  return { label: c?.title ?? t("倒數日", "Countdown"), minW: COUNTDOWN.minW, minH: COUNTDOWN.minH };
}

/** 預設的大小照內容決定：日期一行大字（和旁邊的時鐘一樣高）、一言兩行、矩陣四格各放幾項 */
export const DEFAULT_LAYOUT: Box[] = [
  { id: "date", x: 0, y: 0, w: 6, h: 3 },
  { id: "clock", x: 6, y: 0, w: 3, h: 3 },
  { id: "quote", x: 0, y: 3, w: 6, h: 2 },
  { id: "matrix", x: 0, y: 5, w: 7, h: 7 },
];

export function collides(a: Box, b: Box): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 位置不小於 0、大小不小於組件的最小尺寸 */
export function clampBox(b: Box): Box {
  const min = spec(b.id);
  const w = Math.max(min.minW, Math.round(b.w));
  const h = Math.max(min.minH, Math.round(b.h));
  return { id: b.id, w, h, x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)) };
}

/**
 * 讓開：組件留在原本的位置（不會往上補空位），只有和已經放好的組件重疊時才往下移到放得下的地方。
 * 由上往下處理；fixed：拖曳中的組件留在原地，其他組件繞開它。
 */
export function settle(items: Box[], fixed?: WidgetId): Box[] {
  const pinned = items.find((b) => b.id === fixed);
  const placed: Box[] = pinned ? [pinned] : [];
  const rest = items.filter((b) => b !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of rest) {
    let y = b.y;
    for (;;) {
      const hit = placed.find((p) => collides({ ...b, y }, p));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    placed.push({ ...b, y });
  }
  return items.map((b) => placed.find((p) => p.id === b.id)!);
}

/**
 * 照目前的欄數排好：放得下的組件留在原位，超出右邊或撞到的（視窗變窄時）縮到放得下、移到第一個空位。
 * 只影響顯示，視窗變寬就回到原本的位置。
 */
export function arrange(items: Box[], cols: number): Box[] {
  const placed: Box[] = [];
  for (const b of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (b.x + b.w <= cols && !placed.some((p) => collides(b, p))) placed.push(b);
    else placed.push(firstFit(placed, b.id, Math.max(spec(b.id).minW, Math.min(b.w, cols)), b.h, cols));
  }
  const out = settle(placed);
  return items.map((b) => out.find((p) => p.id === b.id)!);
}

/** 第一個放得下 w×h 的空位（由上往下、由左往右找） */
export function firstFit(items: Box[], id: WidgetId, w: number, h: number, cols: number): Box {
  const width = Math.max(w, cols);
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= width; x++) {
      const b = { id, x, y, w, h };
      if (!items.some((p) => collides(b, p))) return b;
    }
  }
}

export function bottomOf(items: Box[]): number {
  return items.reduce((n, b) => Math.max(n, b.y + b.h), 0);
}

/** 格子的大小改了，換一個 key，舊的版面不沿用 */
const KEY = "home.grid";

function read(): Box[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!Array.isArray(raw)) return DEFAULT_LAYOUT;
    const seen = new Set<string>();
    return raw
      .filter(
        (b) =>
          b &&
          typeof b.id === "string" &&
          (b.id in BASE || b.id.startsWith("cd:")) &&
          !seen.has(b.id) &&
          seen.add(b.id) &&
          [b.x, b.y, b.w, b.h].every(Number.isFinite),
      )
      .map((b) => clampBox(b));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

class HomeLayout {
  #saved = $state<Box[]>(read());
  /** 現在放得下幾欄，DashGrid 量到寬度後設定 */
  cols = $state(12);

  /** 加到主頁的倒數日 */
  #pinned = $derived(countdowns.list.filter((c) => c.pinned !== false).map((c) => `cd:${c.id}` as const));

  /** 要顯示的組件：存起來的版面（拿掉沒有加到主頁的倒數日），照目前的欄數排好；新加到主頁的倒數日放在第一個空位 */
  items = $derived.by(() => {
    const pinned = new Set<WidgetId>(this.#pinned);
    const list = arrange(this.#saved.filter((b) => !isCountdown(b.id) || pinned.has(b.id)), this.cols);
    for (const id of this.#pinned) {
      if (!list.some((b) => b.id === id)) list.push(firstFit(list, id, COUNTDOWN.w, COUNTDOWN.h, this.cols));
    }
    return list;
  });

  /** 被拿掉的組件，可以再加回來 */
  hidden = $derived(BASE_IDS.filter((id) => !this.items.some((b) => b.id === id)));

  set(items: Box[]) {
    this.#saved = settle(items.map(clampBox));
    this.#save();
  }

  /** 倒數日是從主頁拿掉（在倒數日頁面還在） */
  remove(id: WidgetId) {
    if (isCountdown(id)) countdowns.setPinned(countdownId(id), false);
    this.set(this.items.filter((b) => b.id !== id));
  }

  /** 加回來的組件用預設的大小，放在第一個空位 */
  add(id: WidgetId) {
    if (isCountdown(id)) {
      countdowns.setPinned(countdownId(id), true);
      return;
    }
    const def = DEFAULT_LAYOUT.find((b) => b.id === id)!;
    this.set([...this.items, firstFit(this.items, id, Math.min(def.w, Math.max(this.cols, BASE[id].minW)), def.h, this.cols)]);
  }

  reset() {
    this.#saved = DEFAULT_LAYOUT;
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }

  #save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.#saved));
    } catch {}
  }
}

export const homeLayout = new HomeLayout();
