/** 主頁左半的組件版面：12 欄的格子，每個組件有位置和大小。只存在這台裝置（localStorage） */

export type WidgetId = "date" | "clock" | "quote" | "matrix" | "countdowns";

/** 以格子為單位：x、w 是欄，y、h 是列 */
export interface Box {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const COLS = 12;
/** 一列的高度和格子間距（px） */
export const ROW_HEIGHT = 40;
export const GAP = 12;

export const WIDGETS: Record<WidgetId, { label: string; minW: number; minH: number }> = {
  date: { label: "日期", minW: 3, minH: 2 },
  clock: { label: "時鐘", minW: 2, minH: 3 },
  quote: { label: "每日一言", minW: 3, minH: 2 },
  matrix: { label: "優先矩陣", minW: 5, minH: 6 },
  countdowns: { label: "倒數日", minW: 3, minH: 1 },
};

export const DEFAULT_LAYOUT: Box[] = [
  { id: "date", x: 0, y: 0, w: 8, h: 3 },
  { id: "clock", x: 8, y: 0, w: 4, h: 4 },
  { id: "quote", x: 0, y: 3, w: 8, h: 2 },
  { id: "matrix", x: 0, y: 5, w: 12, h: 9 },
  { id: "countdowns", x: 0, y: 14, w: 12, h: 2 },
];

export function collides(a: Box, b: Box): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 大小和位置限制在格子裡、不小於組件的最小尺寸 */
export function clampBox(b: Box): Box {
  const min = WIDGETS[b.id];
  const w = Math.min(COLS, Math.max(min.minW, Math.round(b.w)));
  const h = Math.max(min.minH, Math.round(b.h));
  return { id: b.id, w, h, x: Math.min(COLS - w, Math.max(0, Math.round(b.x))), y: Math.max(0, Math.round(b.y)) };
}

/**
 * 往上靠攏：每個組件（由上往下）往上移到不會和已經放好的組件重疊的最高位置。
 * fixed：拖曳中的組件留在原地，其他組件繞開它。
 */
export function compact(items: Box[], fixed?: WidgetId): Box[] {
  const pinned = items.find((b) => b.id === fixed);
  const placed: Box[] = pinned ? [pinned] : [];
  const rest = items.filter((b) => b !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const b of rest) {
    let y = 0;
    for (;;) {
      const hit = placed.find((p) => collides({ ...b, y }, p));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    placed.push({ ...b, y });
  }
  return items.map((b) => placed.find((p) => p.id === b.id)!);
}

export function bottomOf(items: Box[]): number {
  return items.reduce((n, b) => Math.max(n, b.y + b.h), 0);
}

const KEY = "home.layout";

function read(): Box[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!Array.isArray(raw)) return DEFAULT_LAYOUT;
    const seen = new Set<string>();
    const items = raw
      .filter((b) => b && b.id in WIDGETS && !seen.has(b.id) && seen.add(b.id) && [b.x, b.y, b.w, b.h].every(Number.isFinite))
      .map((b) => clampBox(b));
    return compact(items);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

class HomeLayout {
  items = $state<Box[]>(read());
  /** 被拿掉的組件，可以再加回來 */
  hidden = $derived((Object.keys(WIDGETS) as WidgetId[]).filter((id) => !this.items.some((b) => b.id === id)));

  set(items: Box[]) {
    this.items = compact(items.map(clampBox));
    this.#save();
  }

  remove(id: WidgetId) {
    this.set(this.items.filter((b) => b.id !== id));
  }

  /** 加回來的組件放在最下面，用預設的大小 */
  add(id: WidgetId) {
    const def = DEFAULT_LAYOUT.find((b) => b.id === id)!;
    this.set([...this.items, { ...def, x: 0, y: bottomOf(this.items) }]);
  }

  reset() {
    this.items = DEFAULT_LAYOUT;
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }

  #save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {}
  }
}

export const homeLayout = new HomeLayout();
