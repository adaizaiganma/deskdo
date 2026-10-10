import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { localDate, localToday } from "./dates";
import { toast } from "./toast.svelte";
import type { NewTodo, Prefs, Snapshot, Todo, TodoPatch } from "./types";

/** 資料都在 Rust 端；這裡只保留最新快照，修改一律透過 invoke */
class Store {
  snap = $state<Snapshot>({ todos: [], today: localToday(), status: "syncing", message: "", lastSync: null });
  prefs = $state<Prefs | null>(null);
  #localToday = $state(localToday());

  /** 跨日時不必等伺服器，本機日期往前就跟著換 */
  today = $derived(this.snap.today > this.#localToday ? this.snap.today : this.#localToday);
  open = $derived(this.snap.todos.filter((t) => !t.done));
  done = $derived(
    this.snap.todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  );
  doneToday = $derived(this.done.filter((t) => localDate(t.doneAt) === this.today));
  tags = $derived([...new Set(this.snap.todos.flatMap((t) => (t.tag ? [t.tag] : [])))].sort((a, b) => a.localeCompare(b, "zh-Hant")));
  overdueCount = $derived(this.open.filter((t) => t.due && t.due < this.today).length);

  async init() {
    await listen<Snapshot>("state", (e) => (this.snap = e.payload));
    await listen<Prefs>("prefs", (e) => (this.prefs = e.payload));
    this.snap = await invoke<Snapshot>("get_state");
    this.prefs = await invoke<Prefs>("get_prefs");
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

  refresh() {
    return this.#call("refresh_now");
  }
}

export const store = new Store();
