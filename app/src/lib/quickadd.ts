/**
 * 快速新增語法：
 *
 *     交作業三 #微積分 @明天 !
 *
 * - `#標籤`              設定標籤
 * - `@今天` `@明天` `@後天` `@週五` `@下週三` `@10/15` `@10-15` `@2026-10-15`   設定期限
 * - `!` 或 `！`          高優先
 * - `~` 或 `～`          低優先
 * 其餘文字為標題。各部分以空白分隔，順序不限。
 */
import { addDays, diffDays, mondayIndex } from "./dates";
import type { NewTodo } from "./types";

const WEEKDAYS = "一二三四五六日";
const RELATIVE: Record<string, number> = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 後天: 2, 后天: 2, 大後天: 3 };

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseDue(text: string, today: string): string | null {
  text = text.trim();
  if (text in RELATIVE) return addDays(today, RELATIVE[text]);

  let m = text.match(/^(下)?(?:週|周|星期|禮拜)([一二三四五六日天])$/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2] === "天" ? "日" : m[2]);
    const cur = mondayIndex(today);
    // 「下週X」：下一週的那一天；「週X」：今天起最近的那一天
    const days = m[1] ? target - cur + 7 : (((target - cur) % 7) + 7) % 7;
    return addDays(today, days);
  }

  m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);

  m = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const year = +today.slice(0, 4);
    const d = validDate(year, +m[1], +m[2]);
    if (!d) return null;
    // 已經過了超過兩個月的日期，視為明年
    return diffDays(d, today) > 60 ? validDate(year + 1, +m[1], +m[2]) : d;
  }
  return null;
}

/** 回傳可直接送給 API 的欄位；標題為空時回傳 null */
export function parseQuickAdd(text: string, today: string): NewTodo | null {
  const titleParts: string[] = [];
  const fields: Partial<NewTodo> = {};
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const head = tok[0];
    let due: string | null;
    if (tok === "!" || tok === "！") {
      fields.priority = "high";
    } else if (tok === "~" || tok === "～") {
      fields.priority = "low";
    } else if ((head === "#" || head === "＃") && tok.length > 1) {
      fields.tag = tok.slice(1);
    } else if ((head === "@" || head === "＠") && tok.length > 1 && (due = parseDue(tok.slice(1), today))) {
      fields.due = due;
    } else {
      titleParts.push(tok);
    }
  }
  const title = titleParts.join(" ").trim();
  if (!title) return null;
  return { ...fields, title };
}
