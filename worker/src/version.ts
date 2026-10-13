/**
 * Worker 的版本號。Deskdo 會把這個 Worker 嵌進安裝檔，並比對雲端回報的版本，
 * 比較舊時提示使用者更新雲端。改了 Worker 的行為或新增 migration 時 +1。
 * （app/src-tauri/build.rs 會從這個檔案讀取數字）
 */
export const WORKER_VERSION = 7;
