import { addDevice, sha256Hex } from "./auth";
import { safeEqual } from "./http";
import type { Env } from "./todos";

/**
 * 配對碼：已經連線的裝置（電腦版、Android 版）產生一組 6 位數，
 * 網頁版（例如 iPhone 加入主畫面的）輸入後換到自己的裝置 token。
 *
 * 存在 settings 表（key = 'pairing'），所以不需要新的 migration。
 * 同時只有一組有效、5 分鐘過期、用過或錯 5 次就作廢：猜中的機會只有百萬分之五，
 * 而且要再猜得先有已連線的裝置重新產生。
 */
const KEY = "pairing";
const TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

interface Pairing {
  hash: string;
  expiresAt: number;
  attempts: number;
}

export async function newPairing(env: Env): Promise<{ code: string; expiresAt: string }> {
  // 2^32 取 1,000,000 的餘數，偏差小於百萬分之一，可以忽略
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const pairing: Pairing = { hash: await sha256Hex(code), expiresAt: Date.now() + TTL_MS, attempts: 0 };
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  )
    .bind(KEY, JSON.stringify(pairing))
    .run();
  return { code, expiresAt: new Date(pairing.expiresAt).toISOString() };
}

/** 配對碼正確時建立一台裝置並回傳它的 token；不正確、過期或沒有配對碼時回傳 null */
export async function claimPairing(env: Env, code: string, deviceName: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return null;
  // 先把嘗試次數 +1 再比對：同時送來好幾個猜測也會各算一次
  const row = await env.DB.prepare(
    "UPDATE settings SET value = json_set(value, '$.attempts', json_extract(value, '$.attempts') + 1) WHERE key = ? RETURNING value",
  )
    .bind(KEY)
    .first<{ value: string }>();
  if (!row) return null;
  const pairing = JSON.parse(row.value) as Pairing;
  const valid = Date.now() <= pairing.expiresAt && pairing.attempts <= MAX_ATTEMPTS;
  const match = valid && safeEqual(await sha256Hex(code), pairing.hash);
  if (match || !valid || pairing.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(KEY).run();
  }
  return match ? await addDevice(env, deviceName) : null;
}
