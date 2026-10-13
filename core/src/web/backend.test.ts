import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot, Todo } from "../types";
import { normalized, pairTags, WEB_HEADER, WebBackend } from "./backend";

/** 假的 Worker：記下收到的請求，依序回傳設定好的回應 */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { method: string; url: string; body: any; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("沒有設定回應");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const todo = (id: string, extra: Partial<Todo> = {}): Todo =>
  normalized({ id, title: id, createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z", ...extra });

function backend() {
  const b = new WebBackend({ appVersion: "test" });
  const states: Snapshot[] = [];
  void b.listen<Snapshot>("state", (s) => states.push(s));
  return { b, states, last: () => states[states.length - 1] };
}

beforeEach(() => {
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("location", { origin: "https://deskdo.example.workers.dev" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normalized / pairTags", () => {
  it("old cloud tag becomes tags, and no due means no time", () => {
    const t = normalized({ id: "a", tag: "微積分", due: null, dueTime: "09:00" });
    expect(t.tags).toEqual(["微積分"]);
    expect(t.tag).toBe("微積分");
    expect(t.dueTime).toBeNull();
  });

  it("tag is the first of tags", () => {
    const t = normalized({ id: "a", tags: ["考試", "微積分"], tag: "微積分", due: "2030-01-02", dueTime: "09:00" });
    expect(t.tag).toBe("考試");
    expect(t.dueTime).toBe("09:00");
  });

  it("pairTags fills the other field", () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ tags: ["a", "b"] }, { tags: ["a", "b"], tag: "a" }],
      [{ tags: [] }, { tags: [], tag: null }],
      [{ tag: "x" }, { tag: "x", tags: ["x"] }],
      [{ tag: null }, { tag: null, tags: [] }],
      [{ title: "t" }, { title: "t" }],
    ];
    for (const [input, expected] of cases) {
      pairTags(input);
      expect(input).toEqual(expected);
    }
  });
});

describe("WebBackend", () => {
  it("loads todos, sends the CSRF header and then uses the ETag", async () => {
    const calls = fakeFetch(json({ today: "2030-01-01", todos: [todo("a")], folders: [{ name: "學校", tags: ["微積分"] }] }, 200, { ETag: '"v1"' }), new Response(null, { status: 304 }));
    const { b, last } = backend();
    await b.refresh();
    expect(calls[0].url).toBe("/api/todos?doneDays=30");
    expect(calls[0].headers[WEB_HEADER]).toBe("1");
    expect(last().status).toBe("ok");
    expect(last().todos.map((t) => t.id)).toEqual(["a"]);
    expect(last().folders).toEqual([{ name: "學校", tags: ["微積分"] }]);

    await b.refresh();
    expect(calls[1].headers["If-None-Match"]).toBe('"v1"');
    expect(last().todos.map((t) => t.id)).toEqual(["a"]);
  });

  it("goes offline without losing data when the network fails", async () => {
    fakeFetch(json({ today: "2030-01-01", todos: [todo("a")] }), new TypeError("Failed to fetch"));
    const { b, last } = backend();
    await b.refresh();
    await b.refresh();
    expect(last().status).toBe("offline");
    expect(last().todos.map((t) => t.id)).toEqual(["a"]);
  });

  it("a 401 marks the browser as not paired", async () => {
    fakeFetch(json({ error: "unauthorized" }, 401));
    const { b } = backend();
    const prefs: boolean[] = [];
    void b.listen<{ configured: boolean }>("prefs", (p) => prefs.push(p.configured));
    await b.refresh();
    expect(prefs).toEqual([false]);
    expect(b.prefs().configured).toBe(false);
    expect(b.prefs().web).toBe(true);
  });

  it("adds optimistically and swaps in the server's copy", async () => {
    const calls = fakeFetch(json({ today: "2030-01-01", todos: [] }), json(todo("srv", { title: "買牛奶", tags: ["家事"] }), 201));
    const { b, states, last } = backend();
    await b.refresh();
    const created = await b.invoke<Todo>("add_todo", { fields: { title: " 買牛奶 ", tags: ["家事"] } });
    expect(calls[1].body).toEqual({ title: " 買牛奶 ", tags: ["家事"], tag: "家事" });
    // 送出前畫面上就有一筆暫時的
    expect(states.some((s) => s.todos.some((t) => t.id.startsWith("tmp-") && t.title === "買牛奶"))).toBe(true);
    expect(created.id).toBe("srv");
    expect(last().todos.map((t) => t.id)).toEqual(["srv"]);
  });

  it("rolls back an update that fails", async () => {
    fakeFetch(json({ today: "2030-01-01", todos: [todo("a")] }), json({ error: "bad" }, 400));
    const { b, states, last } = backend();
    await b.refresh();
    await expect(b.invoke("update_todo", { id: "a", patch: { done: true } })).rejects.toBe("HTTP 400：bad");
    expect(states.some((s) => s.todos[0]?.done && s.todos[0].doneAt)).toBe(true);
    expect(last().todos[0].done).toBe(false);
    expect(last().status).toBe("error");
  });

  it("deletes after the undo window, relinking the next step", async () => {
    vi.useFakeTimers();
    const calls = fakeFetch(json({ today: "2030-01-01", todos: [todo("a"), todo("b", { afterId: "a" })] }), new Response(null, { status: 204 }));
    const { b, last } = backend();
    await b.refresh();
    const done = b.invoke("delete_todo", { id: "a" });
    expect(last().todos.map((t) => [t.id, t.afterId])).toEqual([["b", null]]);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(calls[1]).toMatchObject({ method: "DELETE", url: "/api/todos/a" });
    expect(last().todos.map((t) => [t.id, t.afterId])).toEqual([["b", null]]);
  });

  it("undo before the window ends sends nothing", async () => {
    vi.useFakeTimers();
    const calls = fakeFetch(json({ today: "2030-01-01", todos: [todo("a")] }));
    const { b, last } = backend();
    await b.refresh();
    const done = b.invoke("delete_todo", { id: "a" });
    expect(last().todos).toEqual([]);
    await b.invoke("undo_delete", { id: "a" });
    expect(last().todos.map((t) => t.id)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(calls).toHaveLength(1);
  });

  it("rejects app-only commands", async () => {
    const { b } = backend();
    await expect(b.invoke("setup_run")).rejects.toContain("setup_run");
  });
});
