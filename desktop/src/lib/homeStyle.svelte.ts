/**
 * 主頁的外觀：背景圖片、組件的背景和字體大小。每個組件也可以有自己的背景和字體大小，沒設定就跟著主頁。
 * 只存在這台電腦：設定在 localStorage，背景圖片在 IndexedDB（圖片太大放不進 localStorage）。
 */
import { t } from "@deskdo/core/i18n.svelte";
import type { WidgetId } from "./homeLayout.svelte";

/** solid = 實心卡片；glass = 半透明、模糊後面的背景；none = 沒有背景，字直接在主頁上 */
export type WidgetBg = "solid" | "glass" | "none";

export const BG_OPTIONS: { id: WidgetBg; label: string }[] = [
  { id: "solid", get label() { return t("純色", "Solid"); } },
  { id: "glass", get label() { return t("毛玻璃", "Frosted"); } },
  { id: "none", get label() { return t("無背景", "None"); } },
];

/** 字體大小的倍數 */
export const FONT_SCALES: { id: number; label: string }[] = [
  { id: 0.875, get label() { return t("小", "Small"); } },
  { id: 1, get label() { return t("標準", "Normal"); } },
  { id: 1.15, get label() { return t("大", "Large"); } },
  { id: 1.3, get label() { return t("特大", "Extra large"); } },
];

/** 背景圖片怎麼擺：跟 Windows 桌布的選項一樣 */
export type ImageFit = "cover" | "contain" | "fill" | "center" | "tile";

export const FIT_OPTIONS: { id: ImageFit; label: string; size: string; repeat: string }[] = [
  { id: "cover", get label() { return t("填滿", "Fill"); }, size: "cover", repeat: "no-repeat" },
  { id: "contain", get label() { return t("符合", "Fit"); }, size: "contain", repeat: "no-repeat" },
  { id: "fill", get label() { return t("延展", "Stretch"); }, size: "100% 100%", repeat: "no-repeat" },
  { id: "center", get label() { return t("置中", "Center"); }, size: "auto", repeat: "no-repeat" },
  { id: "tile", get label() { return t("並排", "Tile"); }, size: "auto", repeat: "repeat" },
];

export interface WidgetLook {
  bg: WidgetBg;
  fs: number;
}

interface Saved extends WidgetLook {
  /** 右邊待辦清單的背景 */
  panel: WidgetBg;
  /** 背景圖片上蓋一層底色的濃度（0–0.8），字比較看得清楚 */
  dim: number;
  fit: ImageFit;
  /** 背景圖片的位置（background-position 的百分比，0–100） */
  x: number;
  y: number;
  widgets: Record<string, Partial<WidgetLook>>;
}

const KEY = "home.style";
const DEFAULTS: Saved = { bg: "solid", fs: 1, panel: "solid", dim: 0.25, fit: "cover", x: 50, y: 50, widgets: {} };

const isBg = (v: unknown): v is WidgetBg => BG_OPTIONS.some((o) => o.id === v);
const isFit = (v: unknown): v is ImageFit => FIT_OPTIONS.some((o) => o.id === v);
const pct = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d);
const isScale = (v: unknown): v is number => FONT_SCALES.some((o) => o.id === v);

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const widgets: Saved["widgets"] = {};
    for (const [id, o] of Object.entries(raw.widgets ?? {})) {
      const w = o as Partial<WidgetLook>;
      const look: Partial<WidgetLook> = {};
      if (isBg(w?.bg)) look.bg = w.bg;
      if (isScale(w?.fs)) look.fs = w.fs;
      if (Object.keys(look).length) widgets[id] = look;
    }
    return {
      bg: isBg(raw.bg) ? raw.bg : DEFAULTS.bg,
      fs: isScale(raw.fs) ? raw.fs : DEFAULTS.fs,
      panel: isBg(raw.panel) ? raw.panel : DEFAULTS.panel,
      dim: typeof raw.dim === "number" ? Math.min(0.8, Math.max(0, raw.dim)) : DEFAULTS.dim,
      fit: isFit(raw.fit) ? raw.fit : DEFAULTS.fit,
      x: pct(raw.x, DEFAULTS.x),
      y: pct(raw.y, DEFAULTS.y),
      widgets,
    };
  } catch {
    return DEFAULTS;
  }
}

// ---- 背景圖片：存在 IndexedDB，顯示時換成 blob: 網址 ----
const DB = "deskdo-home";
const STORE = "files";
const IMAGE = "background";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    d.close();
  }
}

/** 太大的圖縮到長邊 2560px，存起來和每次開啟都比較快 */
async function shrink(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 4_000_000) return file;
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  } finally {
    bmp.close();
  }
}

class HomeStyle {
  #s = $state<Saved>(read());
  /** 背景圖片的 blob: 網址；沒有圖片是 null */
  image = $state<string | null>(null);
  /** 背景圖片原本的大小（px），預覽「置中」「並排」要用 */
  imageSize = $state<{ w: number; h: number } | null>(null);

  constructor() {
    if (typeof indexedDB === "undefined") return;
    tx<Blob | undefined>("readonly", (s) => s.get(IMAGE))
      .then((blob) => {
        if (blob) this.#show(blob);
      })
      .catch((e) => console.warn("讀不到主頁的背景圖片", e));
  }

  get bg() {
    return this.#s.bg;
  }
  get fs() {
    return this.#s.fs;
  }
  get panel() {
    return this.#s.panel;
  }
  get dim() {
    return this.#s.dim;
  }
  get fit() {
    return this.#s.fit;
  }
  get x() {
    return this.#s.x;
  }
  get y() {
    return this.#s.y;
  }
  /** 給 background 用的 size / repeat / position */
  get css() {
    const o = FIT_OPTIONS.find((f) => f.id === this.#s.fit)!;
    return { size: o.size, repeat: o.repeat, position: `${this.#s.x}% ${this.#s.y}%` };
  }

  /** 這個組件自己的設定（沒設定的跟著主頁） */
  own(id: WidgetId): Partial<WidgetLook> {
    return this.#s.widgets[id] ?? {};
  }

  /** 這個組件實際用的背景和字體大小 */
  of(id: WidgetId): WidgetLook {
    const o = this.own(id);
    return { bg: o.bg ?? this.#s.bg, fs: o.fs ?? this.#s.fs };
  }

  /** 有幾個組件有自己的設定 */
  get customized() {
    return Object.keys(this.#s.widgets).length;
  }

  set(patch: Partial<Omit<Saved, "widgets">>) {
    this.#s = { ...this.#s, ...patch };
    this.#save();
  }

  /** 組件自己的設定；值是 undefined 就改回跟著主頁 */
  setWidget(id: WidgetId, patch: Partial<WidgetLook>) {
    const next = { ...this.own(id), ...patch };
    for (const k of Object.keys(next) as (keyof WidgetLook)[]) if (next[k] === undefined) delete next[k];
    const widgets = { ...this.#s.widgets };
    if (Object.keys(next).length) widgets[id] = next;
    else delete widgets[id];
    this.#s = { ...this.#s, widgets };
    this.#save();
  }

  /** 所有組件都改回跟著主頁 */
  resetWidgets() {
    this.#s = { ...this.#s, widgets: {} };
    this.#save();
  }

  async setImage(file: Blob) {
    const blob = await shrink(file);
    await tx("readwrite", (s) => s.put(blob, IMAGE));
    // 新圖片從正中間開始
    this.set({ x: 50, y: 50 });
    this.#show(blob);
  }

  async clearImage() {
    await tx("readwrite", (s) => s.delete(IMAGE));
    if (this.image) URL.revokeObjectURL(this.image);
    this.image = null;
    this.imageSize = null;
  }

  #show(blob: Blob) {
    if (this.image) URL.revokeObjectURL(this.image);
    this.image = URL.createObjectURL(blob);
    createImageBitmap(blob)
      .then((bmp) => {
        this.imageSize = { w: bmp.width, h: bmp.height };
        bmp.close();
      })
      .catch(() => (this.imageSize = null));
  }

  #save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.#s));
    } catch {}
  }
}

export const homeStyle = new HomeStyle();
