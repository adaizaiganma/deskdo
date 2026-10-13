import { i18n, plural, t } from "./i18n.svelte";
import type { Todo } from "./types";

const WEEKDAYS = "日一二三四五六";
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 現在的時間 HH:MM */
export function localTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 過期了沒：期限在今天以前，或今天到期而且時間已經過了。
 * now 是現在的時間 HH:MM；沒給的話只看日期
 */
export function isOverdue(t: Pick<Todo, "due" | "dueTime">, today: string, now = ""): boolean {
  if (!t.due) return false;
  return t.due < today || (t.due === today && !!t.dueTime && !!now && t.dueTime < now);
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return format(d);
}

/** b - a，單位為天 */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

export function weekday(iso: string): string {
  const d = parse(iso).getUTCDay();
  return i18n.en ? WEEKDAYS_EN[d] : "週" + WEEKDAYS[d];
}

/** 月曆表頭：從週一開始的七天（一 二 … 日／Mon Tue … Sun） */
export function weekdayHeads(): string[] {
  return i18n.en ? [...WEEKDAYS_EN.slice(1), WEEKDAYS_EN[0]] : [..."一二三四五六日"];
}

/** 0 = 週一 … 6 = 週日 */
export function mondayIndex(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7;
}

export function monthDay(iso: string, today: string): string {
  const d = parse(iso);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? md : `${d.getUTCFullYear()}/${md}`;
}

export function longDate(iso: string): string {
  const d = parse(iso);
  if (i18n.en) return `${weekday(iso)}, ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${weekday(iso)}`;
}

/** 月曆標題：2026年10月／October 2026 */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (i18n.en) return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" })} ${y}`;
  return `${y}年${m}月`;
}

export function nextMonday(today: string): string {
  return addDays(today, 7 - mondayIndex(today));
}

/** 快速新增預覽、編輯面板用：今天／明天 15:00／後天／週五 10/16 */
export function relativeDue(due: string, today: string, time: string | null = null): string {
  const at = time ? ` ${time}` : "";
  const n = diffDays(today, due);
  if (n === 0) return `${t("今天", "Today")}${at}`;
  if (n === 1) return `${t("明天", "Tomorrow")}${at}`;
  if (n === 2 && !i18n.en) return `後天${at}`;
  if (n < 0) return `${monthDay(due, today)}${at}${t("（已過）", " (past)")}`;
  return `${weekday(due)} ${monthDay(due, today)}${at}`;
}

export interface RowDue {
  /** 倒數：逾期 2 天／今天到期／還有 3 天 */
  count: string;
  /** 實際日期：週三 10/14；今天到期時不顯示 */
  date: string;
  /** warn = 逾期或今天到期，soon = 3 天內 */
  tone: "warn" | "soon" | "";
}

/**
 * 清單列右側的期限：上面是倒數天數，下面是日期（有時間的話加上時間）。
 * 今天到期而且有時間的：上面直接寫時間，時間過了就是「已逾期」
 */
export function rowDue(due: string, today: string, time: string | null = null, now = ""): RowDue {
  const at = time ? ` ${time}` : "";
  const n = diffDays(today, due);
  const date = (n >= 0 && n <= 7 ? `${weekday(due)} ${monthDay(due, today)}` : monthDay(due, today)) + at;
  const today_ = t("今天", "Today");
  if (n < 0) return { count: t(`逾期 ${-n} 天`, `${plural(-n, "day")} overdue`), date, tone: "warn" };
  if (n === 0) {
    if (!time) return { count: t("今天到期", "Due today"), date: "", tone: "warn" };
    if (now && time < now) return { count: t("已逾期", "Overdue"), date: `${today_}${at}`, tone: "warn" };
    return { count: `${today_}${at}`, date: "", tone: "warn" };
  }
  return { count: t(`還有 ${n} 天`, `${plural(n, "day")} left`), date, tone: n <= 3 ? "soon" : "" };
}

export type GroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export interface Group {
  key: GroupKey;
  label: string;
  sub: string;
  tone: "warn" | "accent" | "";
  items: Todo[];
}

export function groupOf(due: string | null, today: string, time: string | null = null, now = ""): GroupKey {
  if (!due) return "none";
  const n = diffDays(today, due);
  if (n < 0 || isOverdue({ due, dueTime: time }, today, now)) return "overdue";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n <= 7) return "week";
  return "later";
}

/** 同一天到期時：有時間的照時間排在前面，一整天的在後面；再來高優先在前、低優先在後 */
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

export function compareDue(a: Todo, b: Todo): number {
  return (
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
    (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * 依期限分組，只回傳有項目的組。
 * pinned：編輯中的項目先固定在原本的組，避免改期限時整列跳走
 */
export function groupTodos(todos: Todo[], today: string, pinned?: { id: string; key: GroupKey } | null, now = ""): Group[] {
  const tomorrow = addDays(today, 1);
  const defs: Omit<Group, "items">[] = [
    { key: "overdue", label: t("逾期", "Overdue"), sub: "", tone: "warn" },
    { key: "today", label: t("今天", "Today"), sub: longDate(today), tone: "accent" },
    { key: "tomorrow", label: t("明天", "Tomorrow"), sub: `${weekday(tomorrow)} ${monthDay(tomorrow, today)}`, tone: "" },
    { key: "week", label: t("接下來 7 天", "Next 7 days"), sub: "", tone: "" },
    { key: "later", label: t("之後", "Later"), sub: "", tone: "" },
    { key: "none", label: t("沒有期限", "No due date"), sub: "", tone: "" },
  ];
  const buckets = new Map<GroupKey, Todo[]>(defs.map((d) => [d.key, []]));
  for (const t of todos) buckets.get(pinned?.id === t.id ? pinned.key : groupOf(t.due, today, t.dueTime, now))!.push(t);
  return defs
    .map((d) => ({ ...d, items: buckets.get(d.key)!.sort(compareDue) }))
    .filter((g) => g.items.length > 0);
}

export function localDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-10" 加減 n 個月 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + m - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** 月曆的格子：從 1 號那一週的週一，到月底那一週的週日 */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const start = addDays(first, -mondayIndex(first));
  const end = addDays(last, 6 - mondayIndex(last));
  return Array.from({ length: diffDays(start, end) + 1 }, (_, i) => addDays(start, i));
}

/** 日曆選到的那一天：今天／明天／昨天／3 天後／3 天前 */
export function dayDistance(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n === 0) return t("今天", "Today");
  if (n === 1) return t("明天", "Tomorrow");
  if (n === -1) return t("昨天", "Yesterday");
  if (i18n.en) return n > 0 ? `in ${plural(n, "day")}` : `${plural(-n, "day")} ago`;
  return n > 0 ? `${n} 天後` : `${-n} 天前`;
}

/** 2026年10月11日 週日 */
export function fullDate(iso: string): string {
  const d = parse(iso);
  if (i18n.en) return `${weekday(iso)}, ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${weekday(iso)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 每年的同一天：今年還沒過就是今年，過了就是明年（2/29 在平年算 2/28） */
export function nextYearly(date: string, today: string): string {
  const [, m, d] = date.split("-").map(Number);
  const at = (y: number) => `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
  const y = Number(today.slice(0, 4));
  return at(y) >= today ? at(y) : at(y + 1);
}

/** 兩天之間差幾年幾個月幾天（照日曆算，順序不拘）：先算滿幾個月，剩下的算天數 */
export function spanParts(a: string, b: string): { years: number; months: number; days: number } {
  if (a > b) [a, b] = [b, a];
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  let total = (by - ay) * 12 + (bm - am);
  if (bd < ad) total -= 1;
  // 滿 total 個月的那一天；那個月沒有這一天時（例如 1/31 加一個月）算月底
  const i = ay * 12 + am - 1 + total;
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  const anchor = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(ad, daysInMonth(y, m))).padStart(2, "0")}`;
  return { years: Math.floor(total / 12), months: total % 12, days: diffDays(anchor, b) };
}

/** 1 年 2 個月 3 天；不到一個月時回傳空字串（天數已經另外顯示） */
export function spanText(a: string, b: string): string {
  const { years, months, days } = spanParts(a, b);
  if (!years && !months) return "";
  if (i18n.en) return [years && plural(years, "year"), months && plural(months, "month"), days && plural(days, "day")].filter(Boolean).join(" ");
  return [years && `${years} 年`, months && `${months} 個月`, days && `${days} 天`].filter(Boolean).join(" ");
}
