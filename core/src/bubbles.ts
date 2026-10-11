/**
 * 整理標籤頁的泡泡模擬：大泡泡是資料夾，小泡泡是標籤。
 *
 * 只負責位置和大小，畫面（含細胞膜相融的效果）在 Folders.svelte。
 * 座標單位是「世界座標」，畫面再依可用空間整體縮放。
 */

export interface TagSpec {
  tag: string;
  r: number;
}
export interface FolderSpec {
  name: string;
  hue: number;
  tags: TagSpec[];
}

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 目前半徑，會慢慢長到 target，看起來像在膨脹 */
  r: number;
  target: number;
}
interface FolderBody extends Body {
  hue: number;
}
interface TagBody extends Body {
  folder: string | null;
}

export interface FolderView {
  id: string;
  x: number;
  y: number;
  r: number;
  hue: number;
}
export interface TagView {
  id: string;
  x: number;
  y: number;
  r: number;
  folder: string | null;
}

/** 資料夾之間的距離 */
const FOLDER_GAP = 34;
/**
 * 未分類標籤和其他泡泡的距離。細胞膜比泡泡大一圈（見 Folders.svelte），
 * 膜和膜之間要留 16px 以上，靜止時才不會黏在一起；拖過去時才會相融。
 */
const LOOSE_GAP = 34;
const LOOSE_LOOSE_GAP = 36;
const INNER_GAP = 5;
/** 標籤離資料夾邊緣至少多遠 */
const RIM = 7;
const WALL = 12;
const MIN_FOLDER = 62;
/** 拖著標籤經過資料夾時，資料夾鼓起來多少 */
const SWELL = 12;

export function folderRadius(tagRadii: number[]): number {
  const area = tagRadii.reduce((s, r) => s + (r + INNER_GAP) ** 2, 0);
  return Math.max(MIN_FOLDER, Math.sqrt(area / 0.58) + RIM + 4);
}

function jitter(n: number) {
  return (Math.random() - 0.5) * 2 * n;
}

export class Dish {
  w = 800;
  h = 600;
  folders = new Map<string, FolderBody>();
  tags = new Map<string, TagBody>();
  /** 跟 d3-force 一樣的「熱度」：有變動時升高，慢慢冷卻到靜止 */
  alpha = 1;
  drag: { kind: "folder" | "tag"; id: string } | null = null;
  /** 拖著的標籤目前在哪個資料夾上方 */
  hover: string | null = null;
  /** 下一次 sync 時，新資料夾或標籤要出現的位置 */
  private spawn = new Map<string, [number, number]>();

  resize(w: number, h: number) {
    if (Math.abs(w - this.w) < 0.5 && Math.abs(h - this.h) < 0.5) return;
    this.w = w;
    this.h = h;
    this.kick(0.4);
  }

  kick(a = 0.5) {
    this.alpha = Math.max(this.alpha, a);
  }

  /** 指定下一個出現的資料夾（f:名稱）或標籤（t:名稱）的位置 */
  placeAt(key: string, x: number, y: number) {
    this.spawn.set(key, [x, y]);
  }

  /** 資料夾改名時保留原本的位置 */
  rename(from: string, to: string) {
    const b = this.folders.get(from);
    if (!b) return;
    this.folders.delete(from);
    b.id = to;
    this.folders.set(to, b);
    for (const t of this.tags.values()) if (t.folder === from) t.folder = to;
  }

  /** 先在畫面上換資料夾，不用等存檔回來 */
  moveTag(tag: string, folder: string | null) {
    const t = this.tags.get(tag);
    if (t) t.folder = folder;
    this.kick(0.5);
  }

  sync(specs: FolderSpec[], loose: TagSpec[]) {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const ring = Math.min(this.w, this.h) * 0.3;

    const keepF = new Set<string>();
    specs.forEach((f, i) => {
      keepF.add(f.name);
      const target = folderRadius(f.tags.map((t) => t.r));
      let b = this.folders.get(f.name);
      if (!b) {
        const at = this.spawn.get(`f:${f.name}`);
        this.spawn.delete(`f:${f.name}`);
        const angle = (i / Math.max(1, specs.length)) * Math.PI * 2 - Math.PI / 2;
        const [x, y] = at ?? [cx + Math.cos(angle) * ring + jitter(10), cy + Math.sin(angle) * ring * 0.8 + jitter(10)];
        // 從小小的一顆長大
        b = { id: f.name, x, y, vx: 0, vy: 0, r: 16, target, hue: f.hue };
        this.folders.set(f.name, b);
      }
      b.target = target;
      b.hue = f.hue;
    });
    for (const id of [...this.folders.keys()]) if (!keepF.has(id)) this.folders.delete(id);

    const keepT = new Set<string>();
    const upsert = (t: TagSpec, folder: string | null) => {
      keepT.add(t.tag);
      let b = this.tags.get(t.tag);
      if (!b) {
        const at = this.spawn.get(`t:${t.tag}`);
        this.spawn.delete(`t:${t.tag}`);
        const home = folder ? this.folders.get(folder) : undefined;
        const angle = Math.random() * Math.PI * 2;
        const [x, y] =
          at ?? (home ? [home.x + jitter(home.r * 0.3), home.y + jitter(home.r * 0.3)] : [cx + Math.cos(angle) * ring * 1.4, cy + Math.sin(angle) * ring]);
        b = { id: t.tag, x, y, vx: 0, vy: 0, r: t.r * 0.4, target: t.r, folder };
        this.tags.set(t.tag, b);
      }
      b.target = t.r;
      // 正在拖的標籤先照畫面上的位置，放開後才會照存檔的結果
      if (!(this.drag?.kind === "tag" && this.drag.id === t.tag)) b.folder = folder;
    };
    for (const f of specs) for (const t of f.tags) upsert(t, f.name);
    for (const t of loose) upsert(t, null);
    for (const id of [...this.tags.keys()]) if (!keepT.has(id)) this.tags.delete(id);

    this.kick(0.5);
  }

  startDrag(kind: "folder" | "tag", id: string) {
    this.drag = { kind, id };
    this.dragBody = (kind === "tag" ? this.tags.get(id) : this.folders.get(id)) ?? null;
    this.kick(0.3);
  }

  /** 拖曳中：物體跟著指標，pointer 用來判斷落在哪個資料夾 */
  dragTo(x: number, y: number, px: number, py: number) {
    const d = this.drag;
    if (!d) return;
    const b = this.dragBody;
    if (!b) return;
    b.vx = (x - b.x) * 0.3;
    b.vy = (y - b.y) * 0.3;
    b.x = x;
    b.y = y;
    this.hover = d.kind === "tag" ? this.folderAt(px, py) : null;
    this.kick(0.3);
  }

  endDrag() {
    this.drag = null;
    this.dragBody = null;
    this.hover = null;
    this.kick(0.4);
  }

  tagAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const t of this.tags.values()) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= t.r && d < bestD) {
        best = t.id;
        bestD = d;
      }
    }
    return best;
  }

  folderAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestRatio = Infinity;
    for (const f of this.folders.values()) {
      const ratio = Math.hypot(f.x - x, f.y - y) / f.r;
      if (ratio <= 1 && ratio < bestRatio) {
        best = f.id;
        bestRatio = ratio;
      }
    }
    return best;
  }

  private dragBody: Body | null = null;
  private dragged(b: Body) {
    return b === this.dragBody;
  }

  /** 前進一格；回傳 false 表示已經靜止，可以停止動畫 */
  step(): boolean {
    const settling = [...this.folders.values(), ...this.tags.values()].some((b) => Math.abs(b.r - this.targetOf(b)) > 0.3);
    if (!this.drag && this.alpha < 0.004 && !settling) return false;

    const a = this.alpha;
    const cx = this.w / 2;
    const cy = this.h / 2;
    // 畫面比較寬時，水平方向的吸力弱一點，泡泡會往左右攤開
    const gy = 0.014 * a;
    const gx = gy * Math.min(1, this.h / this.w);
    const folders = [...this.folders.values()];
    const tags = [...this.tags.values()];

    for (const b of [...folders, ...tags]) b.r += (this.targetOf(b) - b.r) * 0.16;

    for (const f of folders) {
      if (this.dragged(f)) continue;
      f.vx += (cx - f.x) * gx;
      f.vy += (cy - f.y) * gy;
    }
    for (const t of tags) {
      if (this.dragged(t)) continue;
      const home = t.folder ? this.folders.get(t.folder) : undefined;
      if (home) {
        t.vx += (home.x - t.x) * 0.04 * a;
        t.vy += (home.y - t.y) * 0.04 * a;
      } else {
        t.vx += (cx - t.x) * gx;
        t.vy += (cy - t.y) * gy;
      }
    }
    for (const b of [...folders, ...tags]) {
      if (this.dragged(b)) continue;
      b.vx *= 0.62;
      b.vy *= 0.62;
      b.x += b.vx;
      b.y += b.vy;
    }

    const loose = tags.filter((t) => !t.folder || !this.folders.has(t.folder));
    const free = (b: Body) => !this.dragged(b);
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < folders.length; i++)
        for (let j = i + 1; j < folders.length; j++) this.push(folders[i], folders[j], folders[i].r + folders[j].r + FOLDER_GAP);
      for (const f of folders)
        for (const t of loose) if (free(t)) this.push(f, t, f.r + t.r + LOOSE_GAP);
      for (let i = 0; i < loose.length; i++)
        for (let j = i + 1; j < loose.length; j++)
          if (free(loose[i]) && free(loose[j])) this.push(loose[i], loose[j], loose[i].r + loose[j].r + LOOSE_LOOSE_GAP);
      for (const f of folders) {
        const inner = tags.filter((t) => t.folder === f.id && free(t));
        for (let i = 0; i < inner.length; i++)
          for (let j = i + 1; j < inner.length; j++) this.push(inner[i], inner[j], inner[i].r + inner[j].r + INNER_GAP);
        // 標籤留在資料夾裡面
        for (const t of inner) {
          const dx = t.x - f.x;
          const dy = t.y - f.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const max = Math.max(0, f.r - t.r - RIM);
          if (d > max) {
            const k = ((d - max) / d) * 0.45;
            t.x -= dx * k;
            t.y -= dy * k;
          }
        }
      }
      for (const b of [...folders, ...tags]) if (free(b)) this.wall(b);
    }

    this.alpha += ((this.drag ? 0.3 : 0) - this.alpha) * 0.025;
    return true;
  }

  private targetOf(b: Body) {
    return this.hover === b.id && this.folders.get(b.id) === b ? b.target + SWELL : b.target;
  }

  /** 兩顆泡泡重疊時推開，重的（大的）動得少，拖著的不動 */
  private push(p: Body, q: Body, min: number) {
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    let d = Math.hypot(dx, dy);
    if (d >= min) return;
    if (d < 1e-6) {
      dx = jitter(1);
      dy = jitter(1);
      d = Math.hypot(dx, dy) || 1;
    }
    const pFixed = this.dragged(p);
    const qFixed = this.dragged(q);
    if (pFixed && qFixed) return;
    const mp = p.r * p.r;
    const mq = q.r * q.r;
    const wp = pFixed ? 0 : qFixed ? 1 : mq / (mp + mq);
    const k = ((min - d) / d) * 0.5;
    p.x -= dx * k * wp;
    p.y -= dy * k * wp;
    q.x += dx * k * (1 - wp);
    q.y += dy * k * (1 - wp);
  }

  private wall(b: Body) {
    const fix = (v: number, r: number, size: number) => {
      if (2 * (r + WALL) >= size) return v + (size / 2 - v) * 0.5;
      if (v - r < WALL) return v + (WALL + r - v) * 0.5;
      if (v + r > size - WALL) return v - (v + r - (size - WALL)) * 0.5;
      return v;
    };
    b.x = fix(b.x, b.r, this.w);
    b.y = fix(b.y, b.r, this.h);
  }

  view(): { folders: FolderView[]; tags: TagView[] } {
    return {
      folders: [...this.folders.values()].map((f) => ({ id: f.id, x: f.x, y: f.y, r: f.r, hue: f.hue })),
      tags: [...this.tags.values()].map((t) => ({ id: t.id, x: t.x, y: t.y, r: t.r, folder: t.folder })),
    };
  }

  /** 存相對位置，下次打開時泡泡還在原來的地方 */
  save(): Layout {
    const rel = (b: Body): [number, number] => [b.x / this.w, b.y / this.h];
    return {
      folders: Object.fromEntries([...this.folders.values()].map((f) => [f.id, rel(f)])),
      tags: Object.fromEntries([...this.tags.values()].map((t) => [t.id, rel(t)])),
    };
  }

  restore(layout: Layout) {
    for (const [k, [x, y]] of Object.entries(layout.folders ?? {})) this.spawn.set(`f:${k}`, [x * this.w, y * this.h]);
    for (const [k, [x, y]] of Object.entries(layout.tags ?? {})) this.spawn.set(`t:${k}`, [x * this.w, y * this.h]);
  }
}

export interface Layout {
  folders: Record<string, [number, number]>;
  tags: Record<string, [number, number]>;
}
