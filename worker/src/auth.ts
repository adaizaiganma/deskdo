import { safeEqual } from "./http";
import type { Env } from "./todos";

/**
 * 驗證來源：
 * - 裝置 token：存在 D1 的 devices 表（只存 SHA-256），由 Deskdo 的設定精靈建立
 * - env 的 API_TOKEN / MCP_SECRET：舊版 setup.ps1 部署與本機開發用，仍然有效
 *
 * 先比對 env，所以還沒套用 0002 migration 的資料庫也能正常運作。
 */

/** 裝置 lastSeenAt 的更新間隔，避免每次輪詢都寫入 D1 */
const SEEN_INTERVAL_MS = 60 * 60 * 1000;

export interface Caller {
  /** null 表示用 env 的 API_TOKEN 驗證 */
  deviceId: string | null;
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
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const expected = env.API_TOKEN?.trim();
  if (expected && safeEqual(token, expected)) return { deviceId: null };

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
