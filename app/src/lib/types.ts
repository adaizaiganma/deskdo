export interface Todo {
  id: string; // "tmp-" 開頭表示還在送出中
  title: string;
  done: boolean;
  doneAt: string | null;
  due: string | null; // YYYY-MM-DD
  tag: string | null;
  priority: "high" | "normal";
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
}

export type TodoPatch = Partial<Pick<Todo, "title" | "due" | "tag" | "priority" | "note" | "done">>;

export interface NewTodo {
  title: string;
  due?: string;
  tag?: string;
  priority?: "high";
  note?: string;
}
