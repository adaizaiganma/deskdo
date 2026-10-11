import { z } from "zod";
import { authorize, rotateMcpSecret, storedMcpSecret, type Caller } from "./auth";
import { foldersSchema, getFolders, setFolders } from "./folders";
import { json, notFound } from "./http";
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
import { WORKER_VERSION } from "./version";

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

function methodNotAllowed(allow: string): Response {
  return json({ error: "method not allowed" }, 405, { Allow: allow });
}

/**
 * REST API（給桌面 App 用），全部需要 Bearer token
 *   GET    /api/todos              支援 If-None-Match，資料沒變時回 304；?doneDays=N 只回傳最近 N 天完成的項目
 *   POST   /api/todos
 *   PATCH  /api/todos/:id
 *   DELETE /api/todos/:id
 *   GET    /api/folders            標籤資料夾（GET /api/todos 也會一併回傳）
 *   PUT    /api/folders            整份取代：{ folders: [{ name, tags }] }
 *   GET    /api/info               Worker 版本（App 用來判斷雲端要不要更新）
 *   GET    /api/connector          claude.ai 連接器網址
 *   POST   /api/connector/rotate   更換連接器網址（舊的立即失效）
 *   GET    /api/devices            已連線的電腦
 *   DELETE /api/devices/:id        撤銷某台電腦的 token
 */
export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const caller = await authorize(req, env);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const parts = url.pathname.split("/").filter(Boolean); // ["api", resource, id?]
  if (parts.length > 3) return notFound();
  switch (parts[1]) {
    case "todos":
      return handleTodos(req, env, url, parts[2]);
    case "folders":
      return handleFolders(req, env, parts[2]);
    case "info":
      if (parts.length > 2) return notFound();
      return req.method === "GET" ? json({ version: WORKER_VERSION }) : methodNotAllowed("GET");
    case "connector":
      return handleConnector(req, env, url, parts[2]);
    case "devices":
      return handleDevices(req, env, caller, parts[2]);
    default:
      return notFound();
  }
}

async function handleTodos(req: Request, env: Env, url: URL, id: string | undefined): Promise<Response> {

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
      const [todos, folders] = await Promise.all([listTodos(env, filter), getFolders(env.DB)]);
      return json({ version, today: day, todos, folders }, 200, { ETag: etag });
    }
    if (req.method === "POST") {
      const parsed = addSchema.safeParse(await readJson(req));
      if (!parsed.success) return badRequest(parsed.error);
      const { todo, created } = await addTodo(env.DB, { source: "manual", ...parsed.data });
      return json(todo, created ? 201 : 200);
    }
    return methodNotAllowed("GET, POST");
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
  return methodNotAllowed("PATCH, DELETE");
}

async function handleFolders(req: Request, env: Env, extra: string | undefined): Promise<Response> {
  if (extra) return notFound();
  if (req.method === "GET") return json({ folders: await getFolders(env.DB) });
  if (req.method === "PUT") {
    const body = (await readJson(req)) as { folders?: unknown } | undefined;
    const parsed = foldersSchema.safeParse(body?.folders);
    if (!parsed.success) return badRequest(parsed.error);
    await setFolders(env.DB, parsed.data);
    return json({ folders: parsed.data });
  }
  return methodNotAllowed("GET, PUT");
}

/**
 * env 有設定 MCP_SECRET（舊版 setup.ps1 部署）時，D1 裡的密鑰換了也沒用，
 * 所以回傳 rotatable: false，請使用者改用 setup.ps1 -RotateSecrets。
 */
async function handleConnector(req: Request, env: Env, url: URL, action: string | undefined): Promise<Response> {
  const rotatable = !env.MCP_SECRET?.trim();
  const connectorUrl = (secret: string) => `${url.origin}/mcp/${secret}`;

  if (!action) {
    if (req.method !== "GET") return methodNotAllowed("GET");
    const secret = env.MCP_SECRET?.trim() || (await storedMcpSecret(env)) || (await rotateMcpSecret(env));
    return json({ url: connectorUrl(secret), rotatable });
  }
  if (action === "rotate") {
    if (req.method !== "POST") return methodNotAllowed("POST");
    if (!rotatable) return json({ error: "這個 Worker 的密鑰設定在環境變數，請用 setup.ps1 -RotateSecrets 更換" }, 409);
    return json({ url: connectorUrl(await rotateMcpSecret(env)), rotatable });
  }
  return notFound();
}

interface DeviceRow {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

async function handleDevices(req: Request, env: Env, caller: Caller, id: string | undefined): Promise<Response> {
  if (!id) {
    if (req.method !== "GET") return methodNotAllowed("GET");
    const { results } = await env.DB.prepare(
      "SELECT id, name, createdAt, lastSeenAt FROM devices ORDER BY createdAt",
    ).all<DeviceRow>();
    return json({ devices: results.map((d) => ({ ...d, current: d.id === caller.deviceId })) });
  }
  if (req.method !== "DELETE") return methodNotAllowed("DELETE");
  const res = await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(id).run();
  return res.meta.changes ? new Response(null, { status: 204 }) : notFound();
}
