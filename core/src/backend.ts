/**
 * 前端和資料之間的那一層：App 裡是 Rust（Tauri 的 invoke 和事件），
 * 網頁版（web/backend.ts）是直接呼叫雲端的 TypeScript。
 * 命令和事件的名稱兩邊一樣，所以 store 和畫面不用知道現在是哪一種。
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

export interface Backend {
  /** 失敗時 reject 一段給使用者看的訊息 */
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** 回傳取消訂閱的函式 */
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
}

const tauri: Backend = {
  invoke: (cmd, args) => tauriInvoke(cmd, args),
  listen: (event, handler) => tauriListen(event, (e) => handler(e.payload as never)),
};

let current: Backend = tauri;

/** 網頁版在載入畫面前換成自己的實作 */
export function useBackend(backend: Backend) {
  current = backend;
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return current.invoke<T>(cmd, args);
}

export function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  return current.listen<T>(event, handler);
}
