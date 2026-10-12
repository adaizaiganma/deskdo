/**
 * 快速新增語法：
 *
 *     交作業三 #微積分 @明天 !
 *
 * - `#標籤`              設定標籤，可以寫好幾個
 * - `@今天` `@明天` `@後天` `@週五` `@下週三` `@10/15` `@10-15` `@2026-10-15`   設定期限
 * - `15:00` 或 `@15:00`  期限的時間；沒寫日期就是今天，沒寫時間就是一整天
 * - `!` 或 `！`          高優先
 * - `~` 或 `～`          低優先
 * 其餘文字為標題。各部分以空白分隔，順序不限。
 *
 * 用 `>`（或 `＞`、`→`）隔開好幾個步驟，後一步要等前一步完成才出現：
 *
 *     做預報 @週三 > 印預報 @週四 #機工實驗
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

/** 「9:30」「09:30」「＠15：00」→ HH:MM */
export function parseTime(text: string): string | null {
  const m = text.trim().match(/^[@＠]?([01]?\d|2[0-3])[:：]([0-5]\d)$/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** 有時間沒日期的放在 day（預設是今天） */
function withDay(t: NewTodo, day: string): NewTodo {
  return t.dueTime && !t.due ? { ...t, due: day } : t;
}

function parseOne(text: string, today: string): NewTodo | null {
  const titleParts: string[] = [];
  const fields: Partial<NewTodo> = {};
  const tags: string[] = [];
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const head = tok[0];
    let due: string | null;
    let time: string | null;
    if (tok === "!" || tok === "！") {
      fields.priority = "high";
    } else if (tok === "~" || tok === "～") {
      fields.priority = "low";
    } else if ((head === "#" || head === "＃") && tok.length > 1) {
      if (!tags.includes(tok.slice(1))) tags.push(tok.slice(1));
    } else if ((time = parseTime(tok))) {
      fields.dueTime = time;
    } else if ((head === "@" || head === "＠") && tok.length > 1 && (due = parseDue(tok.slice(1), today))) {
      fields.due = due;
    } else {
      titleParts.push(tok);
    }
  }
  const title = titleParts.join(" ").trim();
  if (!title) return null;
  return { ...fields, ...(tags.length ? { tags } : {}), title };
}

/** 回傳可直接送給 API 的欄位；標題為空時回傳 null。day：只寫時間沒寫日期時用哪一天 */
export function parseQuickAdd(text: string, today: string, day = today): NewTodo | null {
  const t = parseOne(text, today);
  return t && withDay(t, day);
}

const STEP_SEPARATOR = /\s*(?:>|＞|→)\s*/;

/**
 * 拆成好幾個步驟。標籤和優先度寫一次就套用到每一步（某一步自己有寫的除外）；
 * 沒寫期限的步驟用後面最近一步的期限（要在下一步之前做完），最後幾步沒寫的用前面的。
 * 時間不會套用到別的步驟。
 * 沒有任何步驟時回傳 null。
 */
export function parseSteps(text: string, today: string, day = today): NewTodo[] | null {
  const steps = text
    .split(STEP_SEPARATOR)
    .map((part) => parseOne(part, today))
    .filter((s): s is NewTodo => s !== null);
  if (!steps.length) return null;

  const tags = steps.find((s) => s.tags)?.tags;
  const priority = steps.find((s) => s.priority)?.priority;
  const dues = steps.map((s) => s.due);
  return steps.map((s, i) => {
    const due = s.due ?? dues.slice(i + 1).find(Boolean) ?? dues.slice(0, i).reverse().find(Boolean);
    return withDay(
      {
        ...s,
        ...(s.tags || !tags ? {} : { tags }),
        ...(s.priority || !priority ? {} : { priority }),
        ...(due ? { due } : {}),
      },
      day,
    );
  });
}
