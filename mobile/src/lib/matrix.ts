import { t } from "@deskdo/core/i18n.svelte";
import { compareDue, diffDays } from "@deskdo/core/dates";
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

export function isUrgent(t: Todo, today: string): boolean {
  return !!t.due && diffDays(today, t.due) <= URGENT_DAYS;
}

export function quadrants(todos: Todo[], today: string): Quadrant[] {
  // 依期限（同一天有時間的在前）、優先排序
  const sorted = [...todos].sort(compareDue);
  const important = (t: Todo) => t.priority === "high";
  const urgent = (t: Todo) => isUrgent(t, today);
  return [
    { key: "do", title: t("馬上做", "Do now"), axis: t("重要・緊急", "Important · Urgent"), items: sorted.filter((t) => important(t) && urgent(t)) },
    { key: "plan", title: t("排時間做", "Schedule"), axis: t("重要・不緊急", "Important · Not urgent"), items: sorted.filter((t) => important(t) && !urgent(t)) },
    { key: "quick", title: t("盡快處理", "Get it done"), axis: t("不重要・緊急", "Not important · Urgent"), items: sorted.filter((t) => !important(t) && urgent(t)) },
    { key: "later", title: t("有空再做", "Someday"), axis: t("不重要・不緊急", "Not important · Not urgent"), items: sorted.filter((t) => !important(t) && !urgent(t)) },
  ];
}
