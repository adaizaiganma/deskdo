/** 倒數日：只存在這台裝置（localStorage），不同步到雲端 */
import { diffDays, nextYearly } from "./dates";

export interface Countdown {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** 每年重複（生日、紀念日）：倒數到下一次的這一天 */
  yearly: boolean;
}

/** 算好的倒數：target = 要倒數到的那一天（每年重複的是下一次），n = 還有幾天（負的是已經過了幾天），nth = 第幾週年 */
export function resolve(c: Countdown, today: string) {
  const target = c.yearly ? nextYearly(c.date, today) : c.date;
  return { ...c, target, n: diffDays(today, target), nth: c.yearly ? Number(target.slice(0, 4)) - Number(c.date.slice(0, 4)) : 0 };
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
