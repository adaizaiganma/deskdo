import { z } from "zod";

export interface Env {
  DB: D1Database;
  /** 舊版 setup.ps1 部署用；設定精靈部署的 Worker 改用 D1 裡的 settings / devices */
  MCP_SECRET?: string;
  API_TOKEN?: string;
  TIMEZONE?: string;
}

export type Priority = "high" | "normal" | "low";
export type Source = "manual" | "claude" | "email";
export type Status = "open" | "done" | "all";

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  doneAt: string | null;
  due: string | null;
  tag: string | null;
  priority: Priority;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  source: Source;
  sourceRef: string | null;
}

type TodoRow = Omit<Todo, "done"> & { done: number };

// ---------- 驗證 ----------

function isValidDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD")
  .refine(isValidDate, "不是有效的日期");

// 空字串視為 null，方便表單直接送出
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v.trim() === "" ? null : v.trim()));

export const fields = {
  title: z.string().trim().min(1, "標題不能是空的").max(200),
  due: dateSchema.nullable(),
  tag: nullableText(50),
  priority: z.enum(["high", "normal", "low"]),
  note: nullableText(4000),
  source: z.enum(["manual", "claude", "email"]),
  sourceRef: z.string().trim().min(1).max(200),
  status: z.enum(["open", "done", "all"]),
};

export const addSchema = z.object({
  title: fields.title,
  due: fields.due.optional(),
  tag: fields.tag.optional(),
  priority: fields.priority.optional(),
  note: fields.note.optional(),
  source: fields.source.optional(),
  sourceRef: fields.sourceRef.optional(),
});
export type AddInput = z.infer<typeof addSchema>;

export const patchSchema = z.object({
  title: fields.title.optional(),
  due: fields.due.optional(),
  tag: fields.tag.optional(),
  priority: fields.priority.optional(),
  note: fields.note.optional(),
  done: z.boolean().optional(),
});
export type PatchInput = z.infer<typeof patchSchema>;

export interface TodoFilter {
  status?: Status;
  tag?: string;
  priority?: Priority;
  dueBefore?: string; // 含當天
  dueAfter?: string; // 含當天
  overdue?: boolean;
  noDue?: boolean;
  /** 已完成的項目只取這一天（含）之後完成的；未完成的不受影響 */
  doneSince?: string;
  q?: string;
  limit?: number;
}

// ---------- 工具函式 ----------

export function today(env: Env): string {
  // en-CA 的日期格式剛好是 YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.TIMEZONE || "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ID_ALPHABET[b % 32]).join("");
}

function fromRow(row: TodoRow): Todo {
  return { ...row, done: row.done === 1 };
}

// 只有前一個語句真的改到資料時才遞增版本號（在同一個 batch 交易中執行）
export const BUMP_VERSION = "UPDATE meta SET value = value + 1 WHERE key = 'version' AND changes() > 0";

// ---------- 資料存取 ----------

export async function getVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'version'").first<{ value: number }>();
  return row?.value ?? 0;
}

export async function getTodo(db: D1Database, id: string): Promise<Todo | null> {
  const row = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first<TodoRow>();
  return row ? fromRow(row) : null;
}

export async function listTodos(env: Env, f: TodoFilter): Promise<Todo[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const status = f.status ?? "all";

  if (status === "open") where.push("done = 0");
  if (status === "done") where.push("done = 1");
  if (f.tag) {
    where.push("tag = ? COLLATE NOCASE");
    params.push(f.tag);
  }
  if (f.priority) {
    where.push("priority = ?");
    params.push(f.priority);
  }
  if (f.dueBefore) {
    where.push("due IS NOT NULL AND due <= ?");
    params.push(f.dueBefore);
  }
  if (f.dueAfter) {
    where.push("due IS NOT NULL AND due >= ?");
    params.push(f.dueAfter);
  }
  if (f.overdue) {
    where.push("done = 0 AND due IS NOT NULL AND due < ?");
    params.push(today(env));
  }
  if (f.noDue) where.push("due IS NULL");
  if (f.doneSince) {
    // doneAt 是 UTC 的 ISO 字串，和 YYYY-MM-DD 直接比較字串即可
    where.push("(done = 0 OR doneAt >= ?)");
    params.push(f.doneSince);
  }
  if (f.q) {
    where.push("(instr(lower(title), lower(?)) > 0 OR instr(lower(coalesce(note, '')), lower(?)) > 0)");
    params.push(f.q, f.q);
  }

  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  const sql =
    "SELECT * FROM todos" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    // 未完成在前（依期限、優先度），已完成在後（最近完成的在前）
    " ORDER BY done ASC," +
    " CASE WHEN done = 1 THEN doneAt END DESC," +
    " CASE WHEN due IS NULL THEN 1 ELSE 0 END, due ASC," +
    " CASE priority WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END, createdAt ASC" +
    ` LIMIT ${limit}`;

  const { results } = await env.DB.prepare(sql).bind(...params).all<TodoRow>();
  return results.map(fromRow);
}

export async function listTags(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT tag FROM todos WHERE tag IS NOT NULL ORDER BY tag")
    .all<{ tag: string }>();
  return results.map((r) => r.tag);
}

/** 新增待辦。若 sourceRef 已存在，回傳既有那筆並標記 created: false。 */
export async function addTodo(db: D1Database, input: AddInput): Promise<{ todo: Todo; created: boolean }> {
  if (input.sourceRef) {
    const existing = await findBySourceRef(db, input.sourceRef);
    if (existing) return { todo: existing, created: false };
  }

  const now = new Date().toISOString();
  const todo: Todo = {
    id: newId(),
    title: input.title,
    done: false,
    doneAt: null,
    due: input.due ?? null,
    tag: input.tag ?? null,
    priority: input.priority ?? "normal",
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
    source: input.source ?? "manual",
    sourceRef: input.sourceRef ?? null,
  };

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO todos (id, title, done, doneAt, due, tag, priority, note, createdAt, updatedAt, source, sourceRef)
           VALUES (?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(todo.id, todo.title, todo.due, todo.tag, todo.priority, todo.note, now, now, todo.source, todo.sourceRef),
      db.prepare(BUMP_VERSION),
    ]);
  } catch (e) {
    // 兩個請求同時用同一個 sourceRef 新增時，唯一索引會擋下第二個
    if (input.sourceRef && /UNIQUE/i.test(String(e))) {
      const existing = await findBySourceRef(db, input.sourceRef);
      if (existing) return { todo: existing, created: false };
    }
    throw e;
  }
  return { todo, created: true };
}

async function findBySourceRef(db: D1Database, sourceRef: string): Promise<Todo | null> {
  const row = await db.prepare("SELECT * FROM todos WHERE sourceRef = ?").bind(sourceRef).first<TodoRow>();
  return row ? fromRow(row) : null;
}

/** 只更新有提供的欄位，避免兩邊同時改不同欄位時互相覆蓋。找不到回傳 null。 */
export async function updateTodo(db: D1Database, id: string, patch: PatchInput): Promise<Todo | null> {
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const key of ["title", "due", "tag", "priority", "note"] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (patch.done !== undefined) {
    // 已經完成的項目再標記完成時，保留原本的完成時間
    sets.push("done = ?", "doneAt = CASE WHEN ? = 1 THEN coalesce(doneAt, ?) ELSE NULL END");
    const d = patch.done ? 1 : 0;
    params.push(d, d, now);
  }
  if (sets.length === 0) return getTodo(db, id);

  sets.push("updatedAt = ?");
  params.push(now, id);

  const [res] = await db.batch<TodoRow>([
    db.prepare(`UPDATE todos SET ${sets.join(", ")} WHERE id = ? RETURNING *`).bind(...params),
    db.prepare(BUMP_VERSION),
  ]);
  const row = res.results[0];
  return row ? fromRow(row) : null;
}

/** 刪除成功回傳被刪的那筆，找不到回傳 null。 */
export async function deleteTodo(db: D1Database, id: string): Promise<Todo | null> {
  const [res] = await db.batch<TodoRow>([
    db.prepare("DELETE FROM todos WHERE id = ? RETURNING *").bind(id),
    db.prepare(BUMP_VERSION),
  ]);
  const row = res.results[0];
  return row ? fromRow(row) : null;
}
