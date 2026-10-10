import { handleApi } from "./api";
import { json, notFound, safeEqual } from "./http";
import { handleMcp } from "./mcp";
import type { Env } from "./todos";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === "/api/todos" || path.startsWith("/api/todos/")) {
        return await handleApi(req, env, url);
      }

      // /mcp/<MCP_SECRET>：密鑰錯誤時回 404，不透露端點存在
      if (path.startsWith("/mcp/")) {
        const secret = path.slice("/mcp/".length).replace(/\/$/, "");
        const expected = env.MCP_SECRET?.trim();
        if (!expected || !safeEqual(secret, expected)) return notFound();
        return await handleMcp(req, env);
      }

      return notFound();
    } catch (e) {
      console.error("unhandled error:", e instanceof Error ? e.message : e);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
