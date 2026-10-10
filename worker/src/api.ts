import { z } from "zod";
import { json, notFound, safeEqual } from "./http";
import {
  addDays,
  addSchema,
  addTodo,
  dateSchema,
  deleteTodo,
  fields,
  getVersion,
  listTodos,
  patchSchema,
  today,
  updateTodo,
  type Env,
  type TodoFilter,
} from "./todos";

const querySchema = z.object({
  status: fields.status.optional(),
  tag: z.string().optional(),
  priority: fields.priority.optional(),
  dueBefore: dateSchema.optional(),
  dueAfter: dateSchema.optional(),
  overdue: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  // 已完成的項目只回傳最近 N 天內完成的（桌面 App 不需要完整歷史）
  doneDays: z.coerce.number().int().min(1).max(3650).optional(),
});

function authorized(req: Request, env: Env): boolean {
  const expected = env.API_TOKEN?.trim();
  if (!expected) return false;
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return safeEqual(token, expected);
}

function badRequest(err: z.ZodError): Response {
  return json({ error: "invalid input", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/**
 * REST API（給桌面小工具用）
 *   GET    /api/todos          支援 If-None-Match，資料沒變時回 304；?doneDays=N 只回傳最近 N 天完成的項目
 *   POST   /api/todos
 *   PATCH  /api/todos/:id
 *   DELETE /api/todos/:id
 */
export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);

  const parts = url.pathname.split("/").filter(Boolean); // ["api", "todos", id?]
  if (parts.length > 3) return notFound();
  const id = parts[2];

  if (!id) {
    if (req.method === "GET") {
      const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return badRequest(parsed.error);

      // 先讀版本號再讀資料：中間若有寫入，下一次輪詢會因版本不同而重新下載
      const version = await getVersion(env.DB);
      const day = today(env);
      // 不同查詢條件的回應內容不同，所以 ETag 也要帶上查詢字串
      const etag = `"v${version}-${day}${url.search}"`;
      if (req.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      const { doneDays, ...q } = parsed.data;
      const filter: TodoFilter = {
        ...q,
        overdue: q.overdue === "true",
        doneSince: doneDays ? addDays(day, -doneDays) : undefined,
        limit: q.limit ?? 500,
      };
      const todos = await listTodos(env, filter);
      return json({ version, today: day, todos }, 200, { ETag: etag });
    }
    if (req.method === "POST") {
      const parsed = addSchema.safeParse(await readJson(req));
      if (!parsed.success) return badRequest(parsed.error);
      const { todo, created } = await addTodo(env.DB, { source: "manual", ...parsed.data });
      return json(todo, created ? 201 : 200);
    }
    return json({ error: "method not allowed" }, 405, { Allow: "GET, POST" });
  }

  if (req.method === "PATCH") {
    const parsed = patchSchema.safeParse(await readJson(req));
    if (!parsed.success) return badRequest(parsed.error);
    const todo = await updateTodo(env.DB, id, parsed.data);
    return todo ? json(todo) : notFound();
  }
  if (req.method === "DELETE") {
    const todo = await deleteTodo(env.DB, id);
    return todo ? new Response(null, { status: 204 }) : notFound();
  }
  return json({ error: "method not allowed" }, 405, { Allow: "PATCH, DELETE" });
}
