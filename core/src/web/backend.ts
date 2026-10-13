/**
 * 網頁版的後端：網頁由使用者自己的雲端 Worker 提供（/app），所以直接呼叫同一個網址的 /api/*，
 * 驗證靠配對時 Worker 設定的 cookie。
 * 做的事和 Rust 的 core/rust/src/store.rs 一樣：輪詢、先改畫面再送出、失敗時復原、刪除 5 秒內可以復原。
 */
import type { Backend } from "../backend";
import { localToday } from "../dates";
import { t } from "../i18n.svelte";
import type { Folder, Prefs, Snapshot, SyncStatus, Todo } from "../types";

/** 刪除後可以「復原」的時間；過了才真的送出 DELETE */
const DELETE_DELAY_MS = 5_000;
/** 已完成的項目只同步最近這幾天的（和 Rust 端一樣） */
export const DONE_SYNC_DAYS = 30;
const POLL_SECONDS = 30;
/** 多久檢查一次雲端版本 */
const VERSION_CHECK_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = "web.cache";
/** Worker 只接受帶這個標頭的 cookie 請求：別的網站沒辦法自己加標頭，可以擋掉跨站偽造的請求 */
export const WEB_HEADER = "X-Deskdo-Web";

interface ApiResult {
  /** 0 表示沒有連上伺服器 */
  status: number;
  data: any;
  /** null 表示成功（2xx 或 304） */
  error: string | null;
  etag: string | null;
}

/** 呼叫同一個網址的 Worker API；不會 throw */
export async function send(method: string, path: string, body?: unknown, etag?: string | null, keepalive = false): Promise<ApiResult> {
  const headers: Record<string, string> = { [WEB_HEADER]: "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (etag) headers["If-None-Match"] = etag;
  let resp: Response;
  try {
    resp = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      // ETag 自己處理，不要讓瀏覽器的快取插手
      cache: "no-store",
      keepalive,
      signal: keepalive ? undefined : AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === "TimeoutError";
    return { status: 0, data: null, error: timeout ? t("連線逾時", "The connection timed out") : t("無法連線到伺服器", "Can't reach the server"), etag: null };
  }
  const status = resp.status;
  const data = await resp.json().catch(() => null);
  let error: string | null = null;
  if (status === 401) {
    error = t("這個瀏覽器還沒配對，或已經被撤銷", "This browser isn't paired, or it was revoked");
  } else if (status >= 400) {
    error = `HTTP ${status}`;
    if (typeof data?.error === "string") error += t(`：${data.error}`, `: ${data.error}`);
    const issues = Array.isArray(data?.issues) ? data.issues.filter((i: unknown) => typeof i === "string") : [];
    if (issues.length) error += t(`（${issues.join("；")}）`, ` (${issues.join("; ")})`);
  }
  return { status, data, error, etag: resp.headers.get("ETag") };
}

/** 舊版雲端沒有 tags 時用 tag 補上；tag 一律是第一個標籤，沒有期限就沒有時間 */
export function normalized(raw: Partial<Todo> & { id: string }): Todo {
  const tags = raw.tags?.length ? [...raw.tags] : raw.tag ? [raw.tag] : [];
  const due = raw.due ?? null;
  return {
    title: "",
    done: false,
    doneAt: null,
    note: null,
    createdAt: "",
    updatedAt: "",
    source: "manual",
    sourceRef: null,
    priority: "normal",
    afterId: null,
    ...raw,
    due,
    dueTime: due ? (raw.dueTime ?? null) : null,
    tags,
    tag: tags[0] ?? null,
  };
}

/** 新增、修改時 tags 和 tag 一起送：新版雲端看 tags，舊版雲端只看 tag */
export function pairTags(fields: Record<string, unknown>) {
  if (Array.isArray(fields.tags)) {
    fields.tag = fields.tags.find((x) => typeof x === "string") ?? null;
  } else if ("tag" in fields) {
    const tag = typeof fields.tag === "string" ? fields.tag.trim() : "";
    fields.tags = tag ? [tag] : [];
  }
}

function strField(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const UPDATABLE = ["title", "due", "dueTime", "tags", "tag", "priority", "note", "done", "afterId"];

interface Cache {
  today: string | null;
  todos: Todo[];
  folders: Folder[];
}

function loadCache(): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return c && Array.isArray(c.todos) ? c : null;
  } catch {
    return null;
  }
}

function saveCache(c: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {}
}

export interface WebOptions {
  /** 網頁版的版本，顯示在設定頁 */
  appVersion: string;
}

export class WebBackend implements Backend {
  #todos: Todo[] = [];
  #folders: Folder[] = [];
  #serverToday: string | null = null;
  #status: SyncStatus = "syncing";
  #message = "";
  #lastSync: string | null = null;
  #etag: string | null = null;
  /** 進行中的修改請求數 */
  #pending = 0;
  #fetching = false;
  #refetchAfter = false;
  #forceNext = false;
  /** 已按刪除、還在等待復原期限的項目 */
  #hidden = new Set<string>();
  /** 收到 401 就是沒配對（或被撤銷）；畫面看到 configured = false 會改顯示配對頁 */
  #paired = true;
  #cloudVersion: number | null = null;
  #versionCheckedAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #listeners = new Map<string, Set<(payload: any) => void>>();
  #options: WebOptions;

  constructor(options: WebOptions) {
    this.#options = options;
    const cache = loadCache();
    if (cache) {
      this.#todos = cache.todos;
      this.#folders = cache.folders ?? [];
      this.#serverToday = cache.today;
    }
  }

  /** 開始輪詢；回到前景時馬上同步一次，離開網頁前把等待中的刪除送出去 */
  start() {
    if (this.#started) return;
    this.#started = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.wake(false);
    });
    addEventListener("online", () => this.wake(false));
    addEventListener("pagehide", () => this.#flushDeletes());
    void this.#loop();
  }

  async invoke<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
    const result = await this.#command(cmd, args);
    return result as T;
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    const set = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, set);
    set.add(handler);
    return () => set.delete(handler);
  }

  #command(cmd: string, args: Record<string, any>): Promise<unknown> | unknown {
    switch (cmd) {
      case "get_state":
        return this.snapshot();
      case "get_prefs":
        return this.prefs();
      case "get_update":
        return null;
      case "refresh_now":
        return this.wake(true);
      case "add_todo":
        return this.#add(args.fields ?? {});
      case "update_todo":
        return this.#update(args.id, args.patch ?? {});
      case "delete_todo":
        return this.#delete(args.id);
      case "undo_delete":
        this.#hidden.delete(args.id);
        return this.#emitState();
      case "set_folders":
        return this.#setFolders(args.folders ?? []);
      case "set_language":
        return;
      case "get_connector":
        return this.#connector("GET", "/api/connector");
      case "rotate_connector":
        return this.#connector("POST", "/api/connector/rotate");
      case "list_devices":
        return this.#listDevices();
      case "revoke_device":
        return this.#revokeDevice(args.id);
      default:
        // App 才有的功能（設定精靈、小工具、更新……）在網頁版不會出現在畫面上
        return Promise.reject(t(`網頁版不支援這個功能（${cmd}）`, `The web version doesn't support this (${cmd})`));
    }
  }

  // ---- 狀態 ----

  /** 伺服器的「今天」（Asia/Taipei）和本機日期取較晚者 */
  #today(): string {
    const local = localToday();
    return this.#serverToday && this.#serverToday.length === 10 && this.#serverToday > local ? this.#serverToday : local;
  }

  snapshot(): Snapshot {
    return {
      todos: this.#visibleTodos(),
      folders: this.#folders.map((f) => ({ name: f.name, tags: [...f.tags] })),
      today: this.#today(),
      status: this.#status,
      message: this.#message,
      lastSync: this.#lastSync,
    };
  }

  prefs(): Prefs {
    return {
      apiBase: location.origin,
      apiToken: "",
      pollSeconds: POLL_SECONDS,
      showDesktopWidget: false,
      desktopOpacity: 1,
      autostart: false,
      configured: this.#paired,
      doneSyncDays: DONE_SYNC_DAYS,
      cloudVersion: this.#cloudVersion,
      // 網頁就是雲端提供的，一定和雲端同一版
      latestCloudVersion: this.#cloudVersion ?? 0,
      oauthAvailable: false,
      beta: false,
      appVersion: this.#options.appVersion,
      web: true,
    };
  }

  /** 去掉等待刪除的項目；接在它們後面的步驟改接到它們的前一步（和雲端真的刪除後一樣） */
  #visibleTodos(): Todo[] {
    const afterOf = (id: string) => this.#todos.find((t) => t.id === id)?.afterId ?? null;
    return this.#todos
      .filter((t) => !this.#hidden.has(t.id))
      .map((raw) => {
        const t = normalized(raw);
        let guard = 0;
        while (t.afterId && this.#hidden.has(t.afterId) && guard++ <= this.#hidden.size) t.afterId = afterOf(t.afterId);
        return t;
      });
  }

  #replace(id: string, next: Todo | null) {
    const i = this.#todos.findIndex((t) => t.id === id);
    if (i < 0) return;
    if (next) this.#todos[i] = next;
    else this.#todos.splice(i, 1);
  }

  #emit(event: string, payload: unknown) {
    for (const handler of this.#listeners.get(event) ?? []) handler(payload);
  }

  #emitState() {
    this.#emit("state", this.snapshot());
  }

  #setPaired(paired: boolean) {
    if (this.#paired === paired) return;
    this.#paired = paired;
    this.#emit("prefs", this.prefs());
  }

  /** 送出請求後看驗證結果：401 表示沒配對，其他的都表示 cookie 還有效 */
  #checkAuth(r: ApiResult) {
    if (r.status === 401) this.#setPaired(false);
    else if (r.status) this.#setPaired(true);
  }

  // ---- 同步 ----

  /** 立即同步一次；force 會忽略 ETag 重新下載 */
  wake(force: boolean) {
    if (force) {
      this.#forceNext = true;
      this.#etag = null;
    }
    if (!this.#started) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    void this.#loop();
  }

  async #loop() {
    // 背景分頁不輪詢，回到前景時（visibilitychange）再抓
    if (document.visibilityState !== "hidden") {
      await this.refresh();
      if (Date.now() - this.#versionCheckedAt > VERSION_CHECK_MS) await this.#checkVersion();
    }
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#loop(), POLL_SECONDS * 1000);
  }

  async #checkVersion() {
    const r = await send("GET", "/api/info");
    this.#checkAuth(r);
    if (r.error || typeof r.data?.version !== "number") return;
    this.#versionCheckedAt = Date.now();
    if (this.#cloudVersion !== r.data.version) {
      this.#cloudVersion = r.data.version;
      this.#emit("prefs", this.prefs());
    }
  }

  async refresh() {
    if (this.#pending > 0) {
      // 修改還沒完成時抓到的資料可能是舊的，等修改完成後再抓
      this.#refetchAfter = true;
      return;
    }
    if (this.#fetching) return;
    this.#fetching = true;
    const force = this.#forceNext;
    this.#forceNext = false;
    const etag = force ? null : this.#etag;
    if (this.#status !== "ok") {
      this.#status = "syncing";
      this.#emitState();
    }

    const r = await send("GET", `/api/todos?doneDays=${DONE_SYNC_DAYS}`, undefined, etag);
    this.#fetching = false;
    this.#checkAuth(r);
    if (r.error) {
      this.#status = r.status === 0 ? "offline" : "error";
      this.#message = r.error;
    } else {
      this.#lastSync = new Date().toTimeString().slice(0, 5);
      if (r.status === 200 && this.#pending === 0 && r.data) {
        this.#etag = r.etag;
        this.#serverToday = typeof r.data.today === "string" ? r.data.today : null;
        this.#todos = Array.isArray(r.data.todos) ? r.data.todos : [];
        // 雲端版本 4 起才有資料夾；舊版沒有這個欄位就當作沒有資料夾
        this.#folders = Array.isArray(r.data.folders) ? r.data.folders : [];
        saveCache({ today: this.#serverToday, todos: this.#todos, folders: this.#folders });
      }
      this.#status = "ok";
      this.#message = "";
    }
    this.#emitState();
  }

  // ---- 修改（先更新畫面，失敗再復原） ----

  #failure(r: ApiResult): [offline: boolean, message: string] | null {
    if (!r.error) return null;
    return r.status === 0 ? [true, t("離線中，修改未儲存", "Offline, the change wasn't saved")] : [false, r.error];
  }

  /** 修改請求完成後呼叫。成功時套用伺服器回傳的資料，失敗時復原並 reject 錯誤訊息 */
  #finish(fail: [boolean, string] | null, onOk: () => void, undo: () => void) {
    this.#pending = Math.max(0, this.#pending - 1);
    if (fail) {
      undo();
      this.#status = fail[0] ? "offline" : "error";
      this.#message = fail[1];
    } else {
      onOk();
    }
    this.#etag = null; // 確保下一次輪詢拿到最新資料
    const refetch = this.#pending === 0 && (this.#refetchAfter || !fail);
    if (refetch) this.#refetchAfter = false;
    this.#emitState();
    if (refetch) this.wake(false);
    if (fail) throw fail[1];
  }

  async #add(input: Record<string, unknown>): Promise<Todo> {
    const fields = { ...input };
    const title = strField(fields, "title");
    if (!title) throw t("標題不能是空的", "The title can't be empty");
    pairTags(fields);
    const tmpId = `tmp-${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;
    const now = new Date().toISOString();
    this.#todos.push(
      normalized({
        id: tmpId,
        title,
        due: strField(fields, "due"),
        dueTime: strField(fields, "dueTime"),
        tags: Array.isArray(fields.tags) ? fields.tags.filter((x): x is string => typeof x === "string") : [],
        priority: (strField(fields, "priority") ?? "normal") as Todo["priority"],
        note: strField(fields, "note"),
        createdAt: now,
        updatedAt: now,
        source: "manual",
        afterId: strField(fields, "afterId"),
      }),
    );
    this.#pending++;
    this.#emitState();

    const r = await send("POST", "/api/todos", fields);
    this.#checkAuth(r);
    const created: Todo | null = r.data && typeof r.data.id === "string" ? r.data : null;
    const failure = this.#failure(r) ?? (created ? null : ([false, t("伺服器回應格式錯誤", "Unexpected server response")] as [boolean, string]));
    this.#finish(
      failure,
      () => {
        // 前一步原本就有下一步時，雲端會把新的這筆插在中間；本機先跟著改，下一次同步再確認
        const prev = created!.afterId;
        if (prev) for (const t of this.#todos) if (t.afterId === prev && t.id !== tmpId) t.afterId = created!.id;
        this.#replace(tmpId, created);
      },
      () => this.#replace(tmpId, null),
    );
    return normalized(created!);
  }

  async #update(id: string, input: Record<string, unknown>) {
    const patch = Object.fromEntries(Object.entries(input).filter(([k]) => UPDATABLE.includes(k)));
    pairTags(patch);
    if (id.startsWith("tmp-") || !Object.keys(patch).length) return;
    const i = this.#todos.findIndex((t) => t.id === id);
    if (i < 0) throw t("找不到這筆待辦", "Can't find this to-do");
    const old = this.#todos[i];
    const next = { ...old, ...patch } as Todo;
    if (typeof patch.done === "boolean") next.doneAt = patch.done ? new Date().toISOString() : null;
    this.#todos[i] = normalized(next);
    this.#pending++;
    this.#emitState();

    const r = await send("PATCH", `/api/todos/${encodeURIComponent(id)}`, patch);
    this.#checkAuth(r);
    const server: Todo | null = r.data && typeof r.data.id === "string" ? r.data : null;
    this.#finish(
      this.#failure(r),
      () => server && this.#replace(id, server),
      () => this.#replace(id, old),
    );
  }

  /** 整份取代標籤資料夾 */
  async #setFolders(folders: Folder[]) {
    const old = this.#folders;
    this.#folders = folders.map((f) => ({ name: f.name, tags: [...f.tags] }));
    this.#pending++;
    this.#emitState();

    const r = await send("PUT", "/api/folders", { folders });
    this.#checkAuth(r);
    const server: Folder[] | null = Array.isArray(r.data?.folders) ? r.data.folders : null;
    this.#finish(
      this.#failure(r),
      () => server && (this.#folders = server),
      () => (this.#folders = old),
    );
  }

  /** 先從畫面上隱藏；DELETE_DELAY_MS 之內呼叫 undo_delete 就不會真的刪除 */
  async #delete(id: string) {
    if (id.startsWith("tmp-")) return;
    this.#hidden.add(id);
    this.#emitState();

    await new Promise((r) => setTimeout(r, DELETE_DELAY_MS));
    if (!this.#hidden.delete(id)) return; // 已復原（或離開網頁時已經送出）
    const idx = this.#todos.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [todo] = this.#todos.splice(idx, 1);
    // 刪掉中間一步時，雲端會把前後接起來；本機先跟著改，失敗時再改回來
    const relinked: string[] = [];
    for (const next of this.#todos)
      if (next.afterId === todo.id) {
        next.afterId = todo.afterId ?? null;
        relinked.push(next.id);
      }
    this.#pending++;
    this.#emitState();

    const r = await send("DELETE", `/api/todos/${encodeURIComponent(id)}`);
    this.#checkAuth(r);
    // 404：別處已經刪掉了，也算成功
    this.#finish(
      r.status === 404 ? null : this.#failure(r),
      () => {},
      () => {
        for (const next of this.#todos) if (relinked.includes(next.id)) next.afterId = todo.id;
        this.#todos.splice(Math.min(idx, this.#todos.length), 0, todo);
      },
    );
  }

  /** 離開網頁前，把還在等待復原期限的刪除送出去（keepalive：網頁關掉後瀏覽器還是會送完） */
  #flushDeletes() {
    for (const id of this.#hidden) void send("DELETE", `/api/todos/${encodeURIComponent(id)}`, undefined, null, true);
    this.#hidden.clear();
  }

  // ---- 連接器與裝置（設定頁用） ----

  async #connector(method: string, path: string) {
    const r = await send(method, path);
    this.#checkAuth(r);
    if (r.error) throw r.error;
    if (typeof r.data?.url !== "string") throw t("伺服器回應格式錯誤", "Unexpected server response");
    return { url: r.data.url, rotatable: !!r.data.rotatable };
  }

  async #listDevices() {
    const r = await send("GET", "/api/devices");
    this.#checkAuth(r);
    if (r.error) throw r.error;
    return Array.isArray(r.data?.devices) ? r.data.devices : [];
  }

  async #revokeDevice(id: string) {
    const r = await send("DELETE", `/api/devices/${encodeURIComponent(id)}`);
    this.#checkAuth(r);
    if (r.error && r.status !== 404) throw r.error;
  }
}
