import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { localDate, localToday } from "./dates";
import { toast } from "./toast.svelte";
import type { Folder, NewTodo, Prefs, Snapshot, Todo, TodoPatch, UpdateInfo } from "./types";

/** 資料都在 Rust 端；這裡只保留最新快照，修改一律透過 invoke */
class Store {
  snap = $state<Snapshot>({ todos: [], folders: [], today: localToday(), status: "syncing", message: "", lastSync: null });
  prefs = $state<Prefs | null>(null);
  /** 已下載好的新版 App；有值時顯示「重新啟動並更新」 */
  appUpdate = $state<UpdateInfo | null>(null);
  #localToday = $state(localToday());

  /** 跨日時不必等伺服器，本機日期往前就跟著換 */
  today = $derived(this.snap.today > this.#localToday ? this.snap.today : this.#localToday);
  open = $derived(this.snap.todos.filter((t) => !t.done));
  done = $derived(
    this.snap.todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  );
  doneToday = $derived(this.done.filter((t) => localDate(t.doneAt) === this.today));
  tags = $derived([...new Set(this.snap.todos.flatMap((t) => (t.tag ? [t.tag] : [])))].sort((a, b) => a.localeCompare(b, "zh-Hant")));
  folders = $derived(this.snap.folders ?? []);
  /** 標籤 → 所在的資料夾 */
  folderOf = $derived(new Map(this.folders.flatMap((f) => f.tags.map((t) => [t, f.name] as const))));
  /** 不在任何資料夾裡的標籤 */
  looseTags = $derived(this.tags.filter((t) => !this.folderOf.has(t)));
  /** 依資料夾排序的標籤（資料夾裡的照資料夾順序，其餘照名稱） */
  orderedTags = $derived([
    ...this.folders.flatMap((f) => f.tags.filter((t) => this.tags.includes(t))),
    ...this.looseTags,
  ]);
  overdueCount = $derived(this.open.filter((t) => t.due && t.due < this.today).length);
  /** 雲端版本 3 起才支援低優先；還不知道版本時先放行 */
  supportsLow = $derived((this.prefs?.cloudVersion ?? 3) >= 3);
  /** 雲端版本 4 起才能儲存資料夾 */
  supportsFolders = $derived((this.prefs?.cloudVersion ?? 4) >= 4);
  cloudOutdated = $derived(
    !!this.prefs?.configured && this.prefs.cloudVersion !== null && this.prefs.cloudVersion < this.prefs.latestCloudVersion,
  );

  async init() {
    await listen<Snapshot>("state", (e) => (this.snap = e.payload));
    await listen<Prefs>("prefs", (e) => (this.prefs = e.payload));
    await listen<UpdateInfo>("update", (e) => (this.appUpdate = e.payload));
    this.snap = await invoke<Snapshot>("get_state");
    this.prefs = await invoke<Prefs>("get_prefs");
    this.appUpdate = (await invoke<UpdateInfo | null>("get_update")) ?? null;
    setInterval(() => (this.#localToday = localToday()), 60_000);
  }

  async #call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      toast.error(String(e));
      return undefined;
    }
  }

  /** 要設成低優先前先問；雲端太舊時提示更新並回傳 false */
  canUseLow(): boolean {
    if (!this.supportsLow) toast.error("低優先需要先更新雲端：到「設定 → 雲端」按「更新雲端」");
    return this.supportsLow;
  }

  setFolders(folders: Folder[]) {
    return this.#call("set_folders", { folders });
  }

  find(id: string): Todo | undefined {
    return this.snap.todos.find((t) => t.id === id);
  }

  add(fields: NewTodo) {
    return this.#call<Todo>("add_todo", { fields });
  }

  update(id: string, patch: TodoPatch) {
    return this.#call("update_todo", { id, patch });
  }

  /** 完成；畫面底部會出現「復原」 */
  complete(todo: Todo) {
    this.update(todo.id, { done: true });
    toast.show(`已完成「${todo.title}」`, { undo: () => this.update(todo.id, { done: false }) });
  }

  reopen(todo: Todo) {
    this.update(todo.id, { done: false });
  }

  /** 刪除；5 秒內可以復原，之後才真的送出 */
  remove(todo: Todo) {
    this.#call("delete_todo", { id: todo.id });
    toast.show(`已刪除「${todo.title}」`, { undo: () => this.#call("undo_delete", { id: todo.id }) });
  }

  /** 安裝已下載的新版；Deskdo 會關閉，裝完自動重新開啟 */
  installUpdate() {
    return this.#call("install_update");
  }

  refresh() {
    return this.#call("refresh_now");
  }
}

export const store = new Store();
