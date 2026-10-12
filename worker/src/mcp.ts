import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  addSchema,
  addTodo,
  ChainError,
  deleteTodo,
  getTodo,
  listTags,
  listTodos,
  openPredecessors,
  patchSchema,
  today,
  updateTodo,
  type Env,
} from "./todos";
import { getFolders } from "./folders";

// MCP 的 inputSchema 會轉成 JSON Schema，所以這裡只用不含 transform 的基本型別，
// 實際驗證與正規化交給 todos.ts 的 addSchema / patchSchema。
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const instructions = (env: Env) => `Personal to-do list of the user (UI language: Traditional Chinese).
- Dates are YYYY-MM-DD in the ${env.TIMEZONE || "Asia/Taipei"} timezone; list_todos returns "today" for reference.
- "tag" is usually a course name or project; reuse existing tags (returned by list_todos as "tags") instead of inventing near-duplicates.
- The user may group tags into folders (list_todos returns them as "folders"). Folders are only for display: a to-do still has a single tag, never set a folder name as a tag.
- Write titles and notes in Traditional Chinese unless the user says otherwise.
- To-dos can be chained into steps: "after_id" is the previous step. A step whose previous step is not done yet is hidden from the user's list (list_todos marks it waiting=true) and appears once the previous step is completed. When a task has a clear order (e.g. write the report, then print it), create the first step and add the next ones with after_id. Each step has its own due date and tag.
- When creating to-dos from emails, set source="email" and source_ref to the Gmail message ID so that re-running never creates duplicates.`;

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function error(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function invalid(err: z.ZodError) {
  return error(`輸入有誤：${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
}

async function chainSafe(run: () => Promise<ReturnType<typeof text> | ReturnType<typeof error>>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ChainError) return error(e.message);
    throw e;
  }
}

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: "todo", version: "0.1.0" }, { instructions: instructions(env) });

  server.registerTool(
    "list_todos",
    {
      title: "列出待辦",
      description:
        "List to-dos with optional filters. Defaults to open (not done) items. All filters are combined with AND. " +
        "Returns { today, count, todos, tags, folders } where tags lists every tag in use and folders groups tags as [{ name, tags }]. " +
        "Open to-dos whose previous step (after_id) is not done yet have waiting=true.",
      inputSchema: {
        status: z.enum(["open", "done", "all"]).optional().describe("Default: open"),
        tag: z.string().optional().describe("Exact tag match, case-insensitive"),
        priority: z.enum(["high", "normal", "low"]).optional(),
        due_before: date.optional().describe("Due on or before this date (YYYY-MM-DD)"),
        due_after: date.optional().describe("Due on or after this date (YYYY-MM-DD)"),
        overdue: z.boolean().optional().describe("Only open items whose due date is before today"),
        no_due: z.boolean().optional().describe("Only items without a due date"),
        query: z.string().optional().describe("Substring search in title and note"),
        limit: z.number().int().min(1).max(500).optional().describe("Default: 200"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const [todos, tags, folders, blocking] = await Promise.all([
        listTodos(env, {
          status: a.status ?? "open",
          tag: a.tag,
          priority: a.priority,
          dueBefore: a.due_before,
          dueAfter: a.due_after,
          overdue: a.overdue,
          noDue: a.no_due,
          q: a.query,
          limit: a.limit,
        }),
        listTags(env.DB),
        getFolders(env.DB),
        openPredecessors(env.DB),
      ]);
      const marked = todos.map((t) => (!t.done && t.afterId && blocking.has(t.afterId) ? { ...t, waiting: true } : t));
      return text({ today: today(env), count: todos.length, todos: marked, tags, folders });
    },
  );

  server.registerTool(
    "add_todo",
    {
      title: "新增待辦",
      description:
        "Add a to-do. If source_ref is given and a to-do with the same source_ref already exists, " +
        "nothing is created and the existing one is returned with created=false.",
      inputSchema: {
        title: z.string().describe("Short actionable title"),
        due: date.nullable().optional().describe("Due date YYYY-MM-DD"),
        tag: z.string().nullable().optional().describe("Course name / project"),
        priority: z.enum(["high", "normal", "low"]).optional().describe("Default: normal"),
        note: z.string().nullable().optional().describe("Details, links, email sender/subject, etc."),
        source: z
          .enum(["manual", "claude", "email"])
          .optional()
          .describe('Default: "claude". Use "email" when derived from an email.'),
        source_ref: z.string().optional().describe("Unique external ID for de-duplication, e.g. the Gmail message ID"),
        after_id: z
          .string()
          .optional()
          .describe("Make this the next step of that to-do: it stays hidden until that one is done. If that to-do already had a next step, the new one is inserted in between."),
      },
    },
    async (a) => {
      const parsed = addSchema.safeParse({
        title: a.title,
        due: a.due,
        tag: a.tag,
        priority: a.priority,
        note: a.note,
        source: a.source ?? "claude",
        sourceRef: a.source_ref,
        afterId: a.after_id,
      });
      if (!parsed.success) return invalid(parsed.error);
      return chainSafe(async () => text(await addTodo(env.DB, parsed.data)));
    },
  );

  server.registerTool(
    "update_todo",
    {
      title: "修改待辦",
      description:
        "Update fields of a to-do. Only the fields you pass are changed; pass null to clear due/tag/note. " +
        "after_id links it as the next step of another to-do (its own later steps move with it); after_id=null unlinks it.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        due: date.nullable().optional(),
        tag: z.string().nullable().optional(),
        priority: z.enum(["high", "normal", "low"]).optional(),
        note: z.string().nullable().optional(),
        done: z.boolean().optional(),
        after_id: z.string().nullable().optional(),
      },
    },
    async ({ id, after_id, ...rest }) => {
      const parsed = patchSchema.safeParse({ ...rest, afterId: after_id });
      if (!parsed.success) return invalid(parsed.error);
      return chainSafe(async () => {
        const todo = await updateTodo(env.DB, id, parsed.data);
        return todo ? text(todo) : error(`找不到待辦 id=${id}`);
      });
    },
  );

  server.registerTool(
    "complete_todo",
    {
      title: "完成待辦",
      description: "Mark a to-do as done (or set done=false to reopen it). Returns the next step that is now unlocked, if any.",
      inputSchema: {
        id: z.string(),
        done: z.boolean().optional().describe("Default: true"),
      },
      annotations: { idempotentHint: true },
    },
    async ({ id, done }) => {
      const todo = await updateTodo(env.DB, id, { done: done ?? true });
      if (!todo) return error(`找不到待辦 id=${id}`);
      const next = todo.done
        ? await env.DB.prepare("SELECT id FROM todos WHERE afterId = ? AND done = 0").bind(id).first<{ id: string }>()
        : null;
      return text(next ? { ...todo, next: await getTodo(env.DB, next.id) } : todo);
    },
  );

  server.registerTool(
    "delete_todo",
    {
      title: "刪除待辦",
      description: "Permanently delete a to-do. Prefer complete_todo for finished items.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const todo = await deleteTodo(env.DB, id);
      return todo ? text({ deleted: todo }) : error(`找不到待辦 id=${id}`);
    },
  );

  return server;
}

/** 無狀態的 Streamable HTTP：每個請求建立一次 server，不需要 Durable Objects。 */
export async function handleMcp(req: Request, env: Env): Promise<Response> {
  // 無狀態模式不提供 GET 的 SSE 串流與 DELETE 結束 session，依規範回 405
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const server = buildServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
