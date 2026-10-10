export interface Todo {
  id: string; // "tmp-" 開頭表示還在送出中
  title: string;
  done: boolean;
  doneAt: string | null;
  due: string | null; // YYYY-MM-DD
  tag: string | null;
  priority: Priority;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "claude" | "email";
  sourceRef: string | null;
}

export type SyncStatus = "syncing" | "ok" | "offline" | "error";

export interface Snapshot {
  todos: Todo[];
  today: string;
  status: SyncStatus;
  message: string;
  lastSync: string | null;
}

export interface Prefs {
  apiBase: string;
  apiToken: string;
  pollSeconds: number;
  showDesktopWidget: boolean;
  desktopOpacity: number;
  autostart: boolean;
  configured: boolean;
  /** 已完成的項目只同步最近這幾天的 */
  doneSyncDays: number;
  /** 雲端 Worker 的版本；null 表示還不知道 */
  cloudVersion: number | null;
  /** 這版 App 內建的 Worker 版本 */
  latestCloudVersion: number;
  /** 這個版本能不能「使用 Cloudflare 登入」 */
  oauthAvailable: boolean;
  /** 測試版（Deskdo Beta，和正式版分開安裝） */
  beta: boolean;
  appVersion: string;
}

/** 已經下載好、等使用者按「更新」的新版 App */
export interface UpdateInfo {
  version: string;
  notes: string | null;
}

// ---- 設定精靈 ----

export interface Account {
  id: string;
  name: string;
}

export interface Inspection {
  subdomain: string | null;
  suggestedSubdomain: string;
  existing: boolean;
  mode: "new" | "update";
  script: string;
}

export type SetupStep = "subdomain" | "database" | "migrate" | "device" | "upload" | "route" | "verify";

export interface SetupProgress {
  step: SetupStep;
  state: "running" | "done" | "skip" | "error";
  detail: string;
}

export interface SetupDone {
  apiBase: string;
  reachable: boolean;
  connectorUrl: string | null;
}

export interface Connector {
  url: string;
  rotatable: boolean;
}

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

export type Priority = "high" | "normal" | "low";

export type TodoPatch = Partial<Pick<Todo, "title" | "due" | "tag" | "priority" | "note" | "done">>;

export interface NewTodo {
  title: string;
  due?: string;
  tag?: string;
  priority?: "high" | "low";
  note?: string;
}
