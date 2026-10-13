import { invoke } from "./backend";
import type { Device, Pairing } from "./types";

/** 配對碼有效時，多久查一次裝置清單（看網頁版配對好了沒） */
const CHECK_EVERY = 3;

/**
 * 設定頁的「在 iPhone、iPad 使用」：產生配對碼、倒數，
 * 裝置清單多了一台（網頁版配對成功）時收起配對碼，顯示加入的是哪一台。
 */
export class PairingFlow {
  pairing = $state<Pairing | null>(null);
  error = $state("");
  /** 配對碼還有幾秒失效 */
  left = $state(0);
  /** 剛配對好的裝置名稱 */
  joined = $state<string | null>(null);
  #onjoin: () => void;
  #known = new Set<string>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #tick = 0;

  /** onjoin：有新裝置加入時（例如重新載入裝置清單） */
  constructor(onjoin: () => void = () => {}) {
    this.#onjoin = onjoin;
  }

  async start() {
    this.error = "";
    this.joined = null;
    try {
      this.#known = new Set((await invoke<Device[]>("list_devices")).map((d) => d.id));
      this.pairing = await invoke<Pairing>("create_pairing");
    } catch (e) {
      this.error = String(e);
      return;
    }
    this.#tick = 0;
    this.stop();
    this.#update();
    this.#timer = setInterval(() => this.#update(), 1000);
  }

  /** 離開設定頁時呼叫 */
  stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #update() {
    const p = this.pairing;
    if (!p) return;
    this.left = Math.max(0, Math.round((Date.parse(p.expiresAt) - Date.now()) / 1000));
    if (this.left === 0) return this.stop();
    if (++this.#tick % CHECK_EVERY) return;
    const devices = await invoke<Device[]>("list_devices").catch(() => null);
    const added = devices?.find((d) => !this.#known.has(d.id));
    if (!added || this.pairing !== p) return;
    this.stop();
    this.pairing = null;
    this.joined = added.name;
    this.#onjoin();
  }
}

/** 倒數顯示成 4:05 */
export function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
