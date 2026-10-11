/** 倒數日：只存在這台裝置（localStorage），不同步到雲端 */

export interface Countdown {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** 每年重複（生日、紀念日）：倒數到下一次的這一天 */
  yearly: boolean;
}

const KEY = "deskdo.countdowns";

function read(): Countdown[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((c) => c && typeof c.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) : [];
  } catch {
    return [];
  }
}

class Countdowns {
  list = $state<Countdown[]>(read());

  #save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list));
    } catch {}
  }

  add(c: Omit<Countdown, "id">) {
    this.list = [...this.list, { ...c, id: crypto.randomUUID() }];
    this.#save();
  }

  update(id: string, c: Omit<Countdown, "id">) {
    this.list = this.list.map((x) => (x.id === id ? { ...c, id } : x));
    this.#save();
  }

  /** 復原刪掉的那一筆，放回原本的位置 */
  restore(c: Countdown, index: number) {
    const list = this.list.filter((x) => x.id !== c.id);
    list.splice(index, 0, c);
    this.list = list;
    this.#save();
  }

  remove(id: string) {
    this.list = this.list.filter((x) => x.id !== id);
    this.#save();
  }
}

export const countdowns = new Countdowns();
