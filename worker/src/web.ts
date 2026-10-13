import { clearedCookie, cookieValue, COOKIE, sha256Hex, tokenCookie, WEB_HEADER } from "./auth";
import { json, notFound } from "./http";
import { claimPairing } from "./pairing";
import type { Env } from "./todos";
import { ASSETS } from "./web.generated";

/**
 * 網頁版（web/ 建置出來的檔案，scripts/embed-web.mjs 嵌進這個 Worker）：
 *   GET  /app/...       網頁本身；找不到的路徑一律回 index.html（單頁應用）
 *   POST /app/pair      { code, name? }：配對碼正確就建立一台裝置，token 放在 cookie
 *   POST /app/logout    撤銷這個瀏覽器的裝置並清掉 cookie
 * 網頁和 API 在同一個網址，所以不需要 CORS。
 */
export async function handleWeb(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === "/app") return Response.redirect(`${url.origin}/app/`, 308);
  if (path === "/app/pair") return pair(req, env);
  if (path === "/app/logout") return logout(req, env);
  if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method not allowed" }, 405, { Allow: "GET" });
  let rel: string;
  try {
    rel = decodeURIComponent(path.slice("/app/".length));
  } catch {
    return notFound();
  }
  return serve(req, rel);
}

/** 網頁版的請求都會帶 WEB_HEADER；別的網站送不出這種請求 */
function fromWebApp(req: Request): boolean {
  return req.method === "POST" && req.headers.get(WEB_HEADER) === "1";
}

async function pair(req: Request, env: Env): Promise<Response> {
  if (!fromWebApp(req)) return notFound();
  const body = (await req.json().catch(() => null)) as { code?: unknown; name?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.replace(/\s/g, "") : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : deviceName(req);
  const token = await claimPairing(env, code, name);
  if (!token) return json({ error: "配對碼不正確或已經過期，請在電腦版重新產生一組" }, 400);
  return json({ ok: true }, 200, { "Set-Cookie": tokenCookie(token) });
}

async function logout(req: Request, env: Env): Promise<Response> {
  if (!fromWebApp(req)) return notFound();
  const token = cookieValue(req, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM devices WHERE tokenHash = ?").bind(await sha256Hex(token)).run();
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookie() } });
}

/** 沒有提供名稱時，從 User-Agent 猜是哪種裝置 */
function deviceName(req: Request): string {
  const ua = req.headers.get("User-Agent") ?? "";
  const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "";
  return kind ? `${kind}（網頁版）` : "網頁版";
}

/**
 * 網頁只連自己（同一個網址的 API），外加主頁「每日一句」的來源；
 * Svelte 的轉場會寫 style 屬性，所以 style 要允許 inline；
 * 主頁的背景圖片存在瀏覽器（IndexedDB），用 blob: 網址顯示。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://uapis.cn",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function serve(req: Request, rel: string): Response {
  // 有副檔名的是檔案，找不到就是 404；沒有副檔名的是網頁裡的頁面，回 index.html
  const asset = ASSETS[rel || "index.html"] ?? (/\.[a-z0-9]+$/i.test(rel) ? undefined : ASSETS["index.html"]);
  if (!asset) {
    if (!ASSETS["index.html"]) return new Response("這個雲端版本沒有包含網頁版", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return notFound();
  }
  const headers: Record<string, string> = {
    "Content-Type": asset.type,
    ETag: asset.etag,
    // 檔名帶雜湊的（assets/）永遠不會變；其他的（index.html、sw.js、manifest）每次都要確認
    "Cache-Control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (asset.type.startsWith("text/html")) {
    headers["Content-Security-Policy"] = CSP;
    headers["X-Frame-Options"] = "DENY";
  }
  if (req.headers.get("If-None-Match") === asset.etag) return new Response(null, { status: 304, headers });
  const body = asset.base64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
  return new Response(req.method === "HEAD" ? null : body, { headers });
}
