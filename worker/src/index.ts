import { handleApi } from "./api";
import { mcpSecretValid } from "./auth";
import { json, notFound } from "./http";
import { handleMcp } from "./mcp";
import { handleWeb } from "./web";
import type { Env } from "./todos";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/api/")) {
        return await handleApi(req, env, url);
      }

      if (path === "/app" || path.startsWith("/app/")) {
        return await handleWeb(req, env, url);
      }

      // /mcp/<MCP_SECRET>：密鑰錯誤時回 404，不透露端點存在
      if (path.startsWith("/mcp/")) {
        const secret = path.slice("/mcp/".length).replace(/\/$/, "");
        if (!(await mcpSecretValid(secret, env))) return notFound();
        return await handleMcp(req, env);
      }

      return notFound();
    } catch (e) {
      console.error("unhandled error:", e instanceof Error ? e.message : e);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
