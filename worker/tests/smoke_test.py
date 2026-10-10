"""本機整合測試：先執行 `npm run dev`，再執行 `python tests/smoke_test.py`。

注意：測試開始時會刪除所有待辦，所以只允許對本機 wrangler dev 執行。
使用的是 .dev.vars 裡的本機測試密鑰。
"""
import json, time, urllib.request, urllib.error

BASE = "http://127.0.0.1:8787"
TOKEN = "local-dev-api-token"
MCP = f"{BASE}/mcp/local-dev-mcp-secret"


def req(method, url, body=None, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read().decode()
            return resp.status, dict(resp.headers), (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, dict(e.headers), (json.loads(raw) if raw else None)


def api(method, path, body=None, headers=None):
    return req(method, BASE + path, body, {"Authorization": f"Bearer {TOKEN}", **(headers or {})})


rpc_id = 0
def mcp(method, params=None):
    global rpc_id
    rpc_id += 1
    s, h, b = req("POST", MCP, {"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params or {}},
                  {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"})
    assert s == 200, (s, b)
    return b


def call(name, args):
    b = mcp("tools/call", {"name": name, "arguments": args})
    res = b["result"]
    txt = res["content"][0]["text"]
    return res.get("isError", False), (txt if res.get("isError") else json.loads(txt))


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        raise SystemExit(1)


for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=2)
    except urllib.error.HTTPError:
        break
    except Exception:
        time.sleep(1)

# --- auth ---
s, _, _ = req("GET", BASE + "/api/todos")
check(s == 401, "REST 無 token → 401")
s, _, _ = req("POST", BASE + "/mcp/wrong", {"jsonrpc": "2.0", "id": 1, "method": "initialize"})
check(s == 404, "MCP 錯誤密鑰 → 404")

# --- REST ---
for t in api("GET", "/api/todos")[2]["todos"]:
    api("DELETE", f"/api/todos/{t['id']}")
s, h, b = api("GET", "/api/todos")
check(s == 200 and "ETag" in h and b["todos"] == [], f"GET 列表 version={b['version']} today={b['today']}")
etag = h["ETag"]
s, _, _ = api("GET", "/api/todos", headers={"If-None-Match": etag})
check(s == 304, "沒變動時 If-None-Match → 304")

s, _, t1 = api("POST", "/api/todos", {"title": "交作業三", "due": "2026-10-12", "tag": "微積分", "priority": "high"})
check(s == 201 and t1["source"] == "manual" and t1["done"] is False, "POST 新增")
s, _, _ = api("GET", "/api/todos", headers={"If-None-Match": etag})
check(s == 200, "新增後 ETag 改變")

s, _, b = api("POST", "/api/todos", {"title": "", "due": "2026-02-30"})
check(s == 400 and len(b["issues"]) == 2, f"驗證錯誤 → 400 {b['issues']}")

s, _, t = api("PATCH", f"/api/todos/{t1['id']}", {"done": True})
check(s == 200 and t["done"] and t["doneAt"], "PATCH 勾選完成")
done_at = t["doneAt"]
time.sleep(0.01)
s, _, t = api("PATCH", f"/api/todos/{t1['id']}", {"done": True, "note": "已上傳"})
check(t["doneAt"] == done_at and t["note"] == "已上傳", "重複勾選保留原完成時間")
s, _, t = api("PATCH", f"/api/todos/{t1['id']}", {"done": False, "tag": ""})
check(not t["done"] and t["doneAt"] is None and t["tag"] is None, "取消完成、空字串清除 tag")

_, h1, _ = api("GET", "/api/todos")
s, _, _ = api("PATCH", "/api/todos/nonexist", {"title": "x"})
check(s == 404, "PATCH 不存在 → 404")
_, h2, _ = api("GET", "/api/todos")
check(h1["ETag"] == h2["ETag"], "改不存在的項目不會讓版本號增加")

# --- MCP ---
b = mcp("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                        "clientInfo": {"name": "test", "version": "1"}})
check(b["result"]["serverInfo"]["name"] == "todo" and "instructions" in b["result"], "MCP initialize")
tools = [t["name"] for t in mcp("tools/list")["result"]["tools"]]
check(sorted(tools) == sorted(["list_todos", "add_todo", "update_todo", "complete_todo", "delete_todo"]), f"tools/list {tools}")

err, r = call("add_todo", {"title": "回覆教授信件", "due": "2026-10-09", "source": "email", "source_ref": "gmail-abc123"})
check(not err and r["created"] and r["todo"]["source"] == "email", "add_todo（email）")
err, r2 = call("add_todo", {"title": "回覆教授信件（重複）", "source": "email", "source_ref": "gmail-abc123"})
check(not err and r2["created"] is False and r2["todo"]["id"] == r["todo"]["id"], "相同 source_ref 不重複新增")
err, r3 = call("add_todo", {"title": "買牛奶"})
check(r3["todo"]["source"] == "claude", "add_todo 預設 source=claude")

err, l = call("list_todos", {"overdue": True})
check([t["title"] for t in l["todos"]] == ["回覆教授信件"], f"overdue 篩選（today={l['today']}）")
err, l = call("list_todos", {"tag": "微積分"})
check(len(l["todos"]) == 0 and l["tags"] == [], "tag 篩選 / tags 清單（tag 已清除）")
call("update_todo", {"id": t1["id"], "tag": "微積分"})
err, l = call("list_todos", {"due_before": "2026-10-12", "due_after": "2026-10-10"})
check([t["title"] for t in l["todos"]] == ["交作業三"], "日期區間篩選")
err, l = call("list_todos", {"query": "牛奶"})
check(len(l["todos"]) == 1, "關鍵字搜尋")
err, l = call("list_todos", {})
check([t["title"] for t in l["todos"]] == ["回覆教授信件", "交作業三", "買牛奶"] and l["tags"] == ["微積分"], "預設排序：期限近的在前、無期限在後")

err, r = call("complete_todo", {"id": r3["todo"]["id"]})
check(r["done"], "complete_todo")
err, l = call("list_todos", {"status": "done"})
check(len(l["todos"]) == 1, "status=done")
err, r = call("update_todo", {"id": t1["id"], "due": None, "priority": "normal"})
check(r["due"] is None and r["priority"] == "normal", "update_todo 用 null 清除 due")
err, r = call("update_todo", {"id": t1["id"], "due": "2026-13-01"})
check(err, f"update_todo 無效日期 → 錯誤：{r[:60]}")
err, r = call("delete_todo", {"id": r3["todo"]["id"]})
check(not err and r["deleted"]["title"] == "買牛奶", "delete_todo")
err, r = call("delete_todo", {"id": r3["todo"]["id"]})
check(err, "刪除不存在 → isError")
s, _, _ = api("DELETE", f"/api/todos/{t1['id']}")
check(s == 204, "REST DELETE → 204")

print("\nALL PASSED")
