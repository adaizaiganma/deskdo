import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isOverdue, localDate, localTime, localToday } from "./dates";
import { collator, t } from "./i18n.svelte";
import { toast } from "./toast.svelte";
import type { Folder, NewTodo, Prefs, Snapshot, Todo, TodoPatch, UpdateInfo } from "./types";

/** 資料都在 Rust 端；這裡只保留最新快照，修改一律透過 invoke */
class Store {
  snap = $state<Snapshot>({ todos: [], folders: [], today: localToday(), status: "syncing", message: "", lastSync: null });
  prefs = $state<Prefs | null>(null);
  /** 已下載好的新版 App；有值時顯示「重新啟動並更新」 */
  appUpdate = $state<UpdateInfo | null>(null);
  /** 要展開的待辦（手機上從主畫面小工具點進來）；清單展開它之後清掉 */
  focus = $state<string | null>(null);
  #localToday = $state(localToday());
  /** 現在的時間 HH:MM，每分鐘更新：今天有時間的待辦過了時間就算逾期 */
  now = $state(localTime());

  /** 跨日時不必等伺服器，本機日期往前就跟著換 */
  today = $derived(this.snap.today > this.#localToday ? this.snap.today : this.#localToday);
  /** 所有未完成的，包含還沒輪到的步驟 */
  allOpen = $derived(this.snap.todos.filter((t) => !t.done));
  /** 前一步還沒完成、先不顯示的步驟 */
  waiting = $derived.by(() => {
    const ids = new Set(this.allOpen.map((t) => t.id));
    return new Set(this.allOpen.filter((t) => t.afterId && ids.has(t.afterId)).map((t) => t.id));
  });
  /** 現在可以做的待辦（清單、數量都用這個） */
  open = $derived(this.allOpen.filter((t) => !this.waiting.has(t.id)));
  /** 前一步 id → 接著的那一步（未完成的） */
  nextOf = $derived(new Map(this.allOpen.flatMap((t) => (t.afterId ? [[t.afterId, t] as const] : []))));
  done = $derived(
    this.snap.todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  );
  doneToday = $derived(this.done.filter((t) => localDate(t.doneAt) === this.today));
  tags = $derived([...new Set(this.snap.todos.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, collator())));
  folders = $derived(this.snap.folders ?? []);
  /** 標籤 → 所在的資料夾 */
  folderOf = $derived(new Map(this.folders.flatMap((f) => f.tags.map((t) => [t, f.name] as const))));
  /** 不在任何資料夾裡的標籤 */
  looseTags = $derived(this.tags.filter((t) => !this.folderOf.has(t)));
  /** 依資料夾排序的標籤（資料夾裡的照資料夾順序，含還沒有待辦的；其餘照名稱） */
  orderedTags = $derived([...this.folders.flatMap((f) => f.tags), ...this.looseTags]);
  overdueCount = $derived(this.open.filter((t) => this.overdue(t)).length);
  /** 雲端版本 3 起才支援低優先；還不知道版本時先放行 */
  supportsLow = $derived((this.prefs?.cloudVersion ?? 3) >= 3);
  /** 雲端版本 5 起才有接續的步驟 */
  supportsSteps = $derived((this.prefs?.cloudVersion ?? 5) >= 5);
  /** 雲端版本 6 起才有多個標籤、期限的時間 */
  supportsV6 = $derived((this.prefs?.cloudVersion ?? 6) >= 6);
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
    setInterval(() => {
      this.#localToday = localToday();
      this.now = localTime();
    }, 60_000);
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
    if (!this.supportsLow) toast.error(t("低優先需要先更新雲端：到「設定 → 雲端」按「更新雲端」", "Low priority needs a cloud update: go to Settings → Cloud and press Update cloud"));
    return this.supportsLow;
  }

  /** 已經過期了（今天到期、時間已經過了的也算） */
  overdue(t: Todo): boolean {
    return isOverdue(t, this.today, this.now);
  }

  /** 要用期限的時間、第二個標籤前先問；雲端太舊時提示更新並回傳 false */
  canUseV6(what: "time" | "tags"): boolean {
    if (!this.supportsV6)
      toast.error(
        t(
          `${what === "time" ? "期限的時間" : "多個標籤"}需要先更新雲端：到「設定 → 雲端」按「更新雲端」`,
          `${what === "time" ? "Due times need" : "Multiple tags need"} a cloud update: go to Settings → Cloud and press Update cloud`,
        ),
      );
    return this.supportsV6;
  }

  setFolders(folders: Folder[]) {
    return this.#call("set_folders", { folders });
  }

  /** 要建立步驟前先問；雲端太舊時提示更新並回傳 false */
  canUseSteps(): boolean {
    if (!this.supportsSteps) toast.error(t("接續的步驟需要先更新雲端：到「設定 → 雲端」按「更新雲端」", "Follow-up steps need a cloud update: go to Settings → Cloud and press Update cloud"));
    return this.supportsSteps;
  }

  /** 依序新增好幾個步驟，每一步接在前一步後面 */
  async addSteps(steps: NewTodo[]) {
    let prev: string | undefined;
    for (const step of steps) {
      const created = await this.add(prev ? { ...step, afterId: prev } : step);
      if (!created?.id) return; // 失敗時已經顯示錯誤，後面的就不送了
      prev = created.id;
    }
  }

  /** 一串步驟中目前可以做的那一步（還沒輪到的步驟往前找） */
  headOf(todo: Todo): Todo {
    const seen = new Set<string>();
    let t = todo;
    while (this.waiting.has(t.id) && !seen.has(t.id)) {
      seen.add(t.id);
      const prev = this.prevOf(t);
      if (!prev) break;
      t = prev;
    }
    return t;
  }

  /** 前一步（如果有的話） */
  prevOf(todo: Todo): Todo | undefined {
    return todo.afterId ? this.find(todo.afterId) : undefined;
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
    const next = this.nextOf.get(todo.id);
    this.update(todo.id, { done: true });
    const msg = next
      ? t(`已完成「${todo.title}」，接著：${next.title}`, `Completed "${todo.title}". Next: ${next.title}`)
      : t(`已完成「${todo.title}」`, `Completed "${todo.title}"`);
    toast.show(msg, { undo: () => this.update(todo.id, { done: false }) });
  }

  reopen(todo: Todo) {
    this.update(todo.id, { done: false });
  }

  /** 刪除；5 秒內可以復原，之後才真的送出 */
  remove(todo: Todo) {
    this.#call("delete_todo", { id: todo.id });
    toast.show(t(`已刪除「${todo.title}」`, `Deleted "${todo.title}"`), { undo: () => this.#call("undo_delete", { id: todo.id }) });
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
