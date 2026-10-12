import { diffDays } from "@deskdo/core/dates";
import type { Todo } from "@deskdo/core/types";

/**
 * 艾森豪矩陣：依優先和期限自動分類。
 * 重要 = 高優先；緊急 = 已經逾期，或 3 天內（今天、明天、後天）到期。
 */
export type QuadrantKey = "do" | "plan" | "quick" | "later";

export interface Quadrant {
  key: QuadrantKey;
  title: string;
  axis: string;
  items: Todo[];
}

const URGENT_DAYS = 2;
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

export function isUrgent(t: Todo, today: string): boolean {
  return !!t.due && diffDays(today, t.due) <= URGENT_DAYS;
}

export function quadrants(todos: Todo[], today: string): Quadrant[] {
  const sorted = [...todos].sort(
    (a, b) =>
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const important = (t: Todo) => t.priority === "high";
  const urgent = (t: Todo) => isUrgent(t, today);
  return [
    { key: "do", title: "馬上做", axis: "重要・緊急", items: sorted.filter((t) => important(t) && urgent(t)) },
    { key: "plan", title: "排時間做", axis: "重要・不緊急", items: sorted.filter((t) => important(t) && !urgent(t)) },
    { key: "quick", title: "盡快處理", axis: "不重要・緊急", items: sorted.filter((t) => !important(t) && urgent(t)) },
    { key: "later", title: "有空再做", axis: "不重要・不緊急", items: sorted.filter((t) => !important(t) && !urgent(t)) },
  ];
}
