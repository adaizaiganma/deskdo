import { safeEqual } from "./http";
import type { Env } from "./todos";

/**
 * 驗證來源：
 * - 裝置 token：存在 D1 的 devices 表（只存 SHA-256），由 Deskdo 的設定精靈建立，
 *   或是網頁版用配對碼換來的（放在 cookie，見 web.ts）
 * - env 的 API_TOKEN / MCP_SECRET：舊版 setup.ps1 部署與本機開發用，仍然有效
 *
 * 先比對 env，所以還沒套用 0002 migration 的資料庫也能正常運作。
 */

/** 裝置 lastSeenAt 的更新間隔，避免每次輪詢都寫入 D1 */
const SEEN_INTERVAL_MS = 60 * 60 * 1000;

export interface Caller {
  /** null 表示用 env 的 API_TOKEN 驗證 */
  deviceId: string | null;
  /** 用網頁版的 cookie 驗證時是那把 token：回應時順便延長 cookie 的期限 */
  cookieToken?: string;
}

/** 網頁版放裝置 token 的 cookie。__Host- 開頭：瀏覽器只接受 HTTPS、整個網站、不能指定網域的 */
export const COOKIE = "__Host-deskdo";
/** 瀏覽器最多只讓 cookie 存 400 天；每次更新 lastSeenAt 時順便延長 */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
/**
 * 用 cookie 驗證的請求一定要帶這個標頭。別的網站只能叫瀏覽器送出「普通」的請求，
 * 加不了自訂標頭，所以可以擋掉跨站偽造的請求（SameSite=Strict 之外再多一層）。
 */
export const WEB_HEADER = "X-Deskdo-Web";

export function tokenCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function cookieValue(req: Request, name: string): string {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** 網頁版的請求：cookie 裡有 token，而且帶了 WEB_HEADER */
export function webToken(req: Request): string {
  return req.headers.get(WEB_HEADER) === "1" ? cookieValue(req, COOKIE) : "";
}

/** 新增一台裝置，回傳它的 token（只存 SHA-256） */
export async function addDevice(env: Env, name: string): Promise<string> {
  const token = newSecret();
  await env.DB.prepare("INSERT INTO devices (id, name, tokenHash, createdAt) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), name, await sha256Hex(token), new Date().toISOString())
    .run();
  return token;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 bytes 的 URL-safe base64，可以直接放在網址路徑裡 */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 資料表不存在（還沒套用 migration）時當作查無資料 */
async function tryFirst<T>(stmt: D1PreparedStatement): Promise<T | null> {
  try {
    return await stmt.first<T>();
  } catch {
    return null;
  }
}

export async function authorize(req: Request, env: Env): Promise<Caller | null> {
  const header = req.headers.get("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const cookie = bearer ? "" : webToken(req);
  const token = bearer || cookie;
  if (!token) return null;

  const expected = env.API_TOKEN?.trim();
  if (bearer && expected && safeEqual(token, expected)) return { deviceId: null };

  const hash = await sha256Hex(token);
  const row = await tryFirst<{ id: string; lastSeenAt: string | null }>(
    env.DB.prepare("SELECT id, lastSeenAt FROM devices WHERE tokenHash = ?").bind(hash),
  );
  if (!row) return null;

  const now = Date.now();
  if (!row.lastSeenAt || now - Date.parse(row.lastSeenAt) > SEEN_INTERVAL_MS) {
    await env.DB.prepare("UPDATE devices SET lastSeenAt = ? WHERE id = ?")
      .bind(new Date(now).toISOString(), row.id)
      .run();
    if (cookie) return { deviceId: row.id, cookieToken: cookie };
  }
  return { deviceId: row.id };
}

/** 存在 D1 的 MCP 密鑰；沒有時回傳 null */
export async function storedMcpSecret(env: Env): Promise<string | null> {
  const row = await tryFirst<{ value: string }>(
    env.DB.prepare("SELECT value FROM settings WHERE key = 'mcp_secret'"),
  );
  return row?.value ?? null;
}

export async function mcpSecretValid(secret: string, env: Env): Promise<boolean> {
  if (!secret) return false;
  const fromEnv = env.MCP_SECRET?.trim();
  if (fromEnv && safeEqual(secret, fromEnv)) return true;
  const stored = await storedMcpSecret(env);
  return !!stored && safeEqual(secret, stored);
}

/** 產生新的 MCP 密鑰並存進 D1（舊的立即失效） */
export async function rotateMcpSecret(env: Env): Promise<string> {
  const secret = newSecret();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('mcp_secret', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  )
    .bind(secret)
    .run();
  return secret;
}
