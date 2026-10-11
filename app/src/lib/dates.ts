import type { Todo } from "./types";

const WEEKDAYS = "日一二三四五六";

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
  return "週" + WEEKDAYS[parse(iso).getUTCDay()];
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
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${weekday(iso)}`;
}

export function nextMonday(today: string): string {
  return addDays(today, 7 - mondayIndex(today));
}

/** 快速新增預覽、編輯面板用：今天／明天／後天／週五 10/16 */
export function relativeDue(due: string, today: string): string {
  const n = diffDays(today, due);
  if (n === 0) return "今天";
  if (n === 1) return "明天";
  if (n === 2) return "後天";
  if (n < 0) return `${monthDay(due, today)}（已過）`;
  return `${weekday(due)} ${monthDay(due, today)}`;
}

export interface RowDue {
  /** 倒數：逾期 2 天／今天到期／還有 3 天 */
  count: string;
  /** 實際日期：週三 10/14；今天到期時不顯示 */
  date: string;
  /** warn = 逾期或今天到期，soon = 3 天內 */
  tone: "warn" | "soon" | "";
}

/** 清單列右側的期限：上面是倒數天數，下面是日期 */
export function rowDue(due: string, today: string): RowDue {
  const n = diffDays(today, due);
  const date = n >= 0 && n <= 7 ? `${weekday(due)} ${monthDay(due, today)}` : monthDay(due, today);
  if (n < 0) return { count: `逾期 ${-n} 天`, date, tone: "warn" };
  if (n === 0) return { count: "今天到期", date: "", tone: "warn" };
  return { count: `還有 ${n} 天`, date, tone: n <= 3 ? "soon" : "" };
}

export type GroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export interface Group {
  key: GroupKey;
  label: string;
  sub: string;
  tone: "warn" | "accent" | "";
  items: Todo[];
}

export function groupOf(due: string | null, today: string): GroupKey {
  if (!due) return "none";
  const n = diffDays(today, due);
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n <= 7) return "week";
  return "later";
}

/** 同一天到期時：高優先在前、低優先在後 */
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

function compare(a: Todo, b: Todo): number {
  return (
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * 依期限分組，只回傳有項目的組。
 * pinned：編輯中的項目先固定在原本的組，避免改期限時整列跳走
 */
export function groupTodos(todos: Todo[], today: string, pinned?: { id: string; key: GroupKey } | null): Group[] {
  const tomorrow = addDays(today, 1);
  const defs: Omit<Group, "items">[] = [
    { key: "overdue", label: "逾期", sub: "", tone: "warn" },
    { key: "today", label: "今天", sub: longDate(today), tone: "accent" },
    { key: "tomorrow", label: "明天", sub: `${weekday(tomorrow)} ${monthDay(tomorrow, today)}`, tone: "" },
    { key: "week", label: "接下來 7 天", sub: "", tone: "" },
    { key: "later", label: "之後", sub: "", tone: "" },
    { key: "none", label: "沒有期限", sub: "", tone: "" },
  ];
  const buckets = new Map<GroupKey, Todo[]>(defs.map((d) => [d.key, []]));
  for (const t of todos) buckets.get(pinned?.id === t.id ? pinned.key : groupOf(t.due, today))!.push(t);
  return defs
    .map((d) => ({ ...d, items: buckets.get(d.key)!.sort(compare) }))
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
  if (n === 0) return "今天";
  if (n === 1) return "明天";
  if (n === -1) return "昨天";
  return n > 0 ? `${n} 天後` : `${-n} 天前`;
}
