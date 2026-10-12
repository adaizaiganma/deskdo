"""本機整合測試：先執行 `npm run dev`，再執行 `python tests/smoke_test.py`。

注意：測試開始時會刪除所有待辦，所以只允許對本機 wrangler dev 執行。
使用的是 .dev.vars 裡的本機測試密鑰。
"""
import hashlib, json, os, subprocess, time, urllib.request, urllib.error

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


def d1(sql):
    """直接對本機 D1 執行 SQL（模擬設定精靈用 Cloudflare API 寫入裝置與密鑰）"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(f'npx wrangler d1 execute deskdo --local --command "{sql}"',
                       cwd=root, shell=True, capture_output=True)
    assert r.returncode == 0, r.stderr.decode(errors="replace")


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
s, h, b = api("GET", "/api/todos?doneDays=30")
check(s == 200 and [x["id"] for x in b["todos"]] == [t1["id"]], "doneDays=30 包含剛完成的項目")
check(h["ETag"] != api("GET", "/api/todos")[1]["ETag"], "不同查詢條件的 ETag 不同")
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

# --- 低優先度 ---
s, _, lo = api("POST", "/api/todos", {"title": "低優先項目", "priority": "low"})
_, _, hi = api("POST", "/api/todos", {"title": "高優先項目", "priority": "high"})
_, _, no = api("POST", "/api/todos", {"title": "普通項目"})
check(s == 201 and lo["priority"] == "low", "POST 低優先")
ids = {lo["id"], hi["id"], no["id"]}
titles = [t["title"] for t in api("GET", "/api/todos?status=open")[2]["todos"] if t["id"] in ids]
check(titles == ["高優先項目", "普通項目", "低優先項目"], f"排序：高、普通、低 {titles}")
err, r = call("update_todo", {"id": no["id"], "priority": "low"})
check(not err and r["priority"] == "low", "MCP update_todo 設為低優先")
s, _, _ = api("POST", "/api/todos", {"title": "x", "priority": "urgent"})
check(s == 400, "未知的優先度 → 400")
for i in ids:
    api("DELETE", f"/api/todos/{i}")

# --- 接續的待辦（步驟） ---
def todo(i):
    return next(t for t in api("GET", "/api/todos")[2]["todos"] if t["id"] == i)

_, _, A = api("POST", "/api/todos", {"title": "做預報"})
s, _, B = api("POST", "/api/todos", {"title": "印預報", "afterId": A["id"]})
check(s == 201 and B["afterId"] == A["id"], "POST afterId：印預報接在做預報後面")
err, C = call("add_todo", {"title": "檢查預報", "after_id": A["id"]})
check(not err and C["todo"]["afterId"] == A["id"] and todo(B["id"])["afterId"] == C["todo"]["id"],
      "MCP add_todo after_id：插在中間（做預報 > 檢查 > 印預報）")
C = C["todo"]
err, r = call("list_todos", {})
w = {t["title"]: t.get("waiting", False) for t in r["todos"]}
check(not err and not w["做預報"] and w["檢查預報"] and w["印預報"], "list_todos 標記還沒輪到的步驟 waiting=true")
s, _, b = api("PATCH", f"/api/todos/{A['id']}", {"afterId": B["id"]})
check(s == 400 and "不能反過來接" in b["error"], "會繞成圈 → 400")
s, _, _ = api("PATCH", f"/api/todos/{A['id']}", {"afterId": A["id"]})
check(s == 400, "接在自己後面 → 400")
s, _, _ = api("POST", "/api/todos", {"title": "x", "afterId": "nope"})
check(s == 400, "前一步不存在 → 400")
err, r = call("update_todo", {"id": A["id"], "after_id": "nope"})
check(err, "MCP update_todo 前一步不存在 → 錯誤訊息")
err, r = call("complete_todo", {"id": A["id"]})
check(not err and r["next"]["id"] == C["id"], "MCP complete_todo 回傳接著要做的步驟")
err, r = call("list_todos", {})
w = {t["title"]: t.get("waiting", False) for t in r["todos"]}
check(not w["檢查預報"] and w["印預報"], "完成前一步後，下一步不再等待")
api("DELETE", f"/api/todos/{C['id']}")
check(todo(B["id"])["afterId"] == A["id"], "刪掉中間一步，前後自動接起來")
_, _, D = api("POST", "/api/todos", {"title": "買紙"})
_, _, E = api("POST", "/api/todos", {"title": "裝訂", "afterId": D["id"]})
s, _, b = api("PATCH", f"/api/todos/{D['id']}", {"afterId": A["id"]})
check(s == 200 and b["afterId"] == A["id"] and todo(B["id"])["afterId"] == E["id"] and todo(E["id"])["afterId"] == D["id"],
      "連接已有待辦：帶著自己的後續步驟插進去（做預報 > 買紙 > 裝訂 > 印預報）")
s, _, b = api("PATCH", f"/api/todos/{D['id']}", {"afterId": None})
check(s == 200 and b["afterId"] is None and todo(E["id"])["afterId"] == D["id"], "afterId=null 解除連接，後續步驟仍跟著")
for t in (A, B, D, E):
    api("DELETE", f"/api/todos/{t['id']}")

# --- 裝置 token、D1 裡的 MCP 密鑰 ---
s, _, b = api("GET", "/api/info")
check(s == 200 and isinstance(b["version"], int), f"GET /api/info version={b['version']}")

DEVICE_TOKEN = "local-test-device-token"
d1("DELETE FROM devices; DELETE FROM settings;")
d1(f"INSERT INTO devices (id, name, tokenHash, createdAt) VALUES ('dev1', 'Test PC', "
   f"'{hashlib.sha256(DEVICE_TOKEN.encode()).hexdigest()}', '2026-01-01T00:00:00.000Z')")
dev = {"Authorization": f"Bearer {DEVICE_TOKEN}"}
s, _, _ = req("GET", BASE + "/api/todos", headers=dev)
check(s == 200, "裝置 token 可以讀取待辦")
s, _, b = req("GET", BASE + "/api/devices", headers=dev)
check(s == 200 and b["devices"][0]["current"] and b["devices"][0]["lastSeenAt"], "裝置清單標記目前裝置並更新 lastSeenAt")
s, _, b = api("GET", "/api/devices")
check(not b["devices"][0]["current"], "env token 不算任何一台裝置")

s, _, b = api("GET", "/api/connector")
check(s == 200 and b["url"].endswith("/mcp/local-dev-mcp-secret") and b["rotatable"] is False,
      "env 有 MCP_SECRET 時連接器網址用 env 的密鑰")
s, _, _ = api("POST", "/api/connector/rotate")
check(s == 409, "env 有 MCP_SECRET 時不能從 App 更換")

d1("INSERT INTO settings (key, value) VALUES ('mcp_secret', 'd1-mcp-secret')")
s, _, _ = req("POST", f"{BASE}/mcp/d1-mcp-secret", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
              {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"})
check(s == 200, "D1 裡的 MCP 密鑰也有效")

s, _, _ = req("DELETE", BASE + "/api/devices/dev1", headers=dev)
check(s == 204, "撤銷裝置 → 204")
s, _, _ = req("GET", BASE + "/api/todos", headers=dev)
check(s == 401, "撤銷後 token 失效")
s, _, _ = api("GET", "/api/nope")
check(s == 404, "未知的 /api 路徑 → 404")

# --- 標籤資料夾 ---
s, _, b = api("GET", "/api/folders")
check(s == 200 and b["folders"] == [], "還沒設定資料夾 → 空清單")
s, h, _ = api("GET", "/api/todos")
etag = h.get("ETag")
s, _, b = api("PUT", "/api/folders", {"folders": [
    {"name": "課程", "tags": ["#流體力學", "電子學", "流體力學"]},
    {"name": "專案", "tags": ["電子學", "robotarm"]},
    {"name": "空的", "tags": []},
]})
check(s == 200 and b["folders"] == [
    {"name": "課程", "tags": ["流體力學", "電子學"]},
    {"name": "專案", "tags": ["robotarm"]},
    {"name": "空的", "tags": []},
], "PUT /api/folders 去掉 #、同一個標籤只留第一個資料夾")
s, h, b = api("GET", "/api/todos", headers={"If-None-Match": etag})
check(s == 200 and b["folders"][0]["name"] == "課程", "改了資料夾 → 待辦清單的 ETag 失效並附上資料夾")
err, r = call("list_todos", {})
check(not err and r["folders"][1] == {"name": "專案", "tags": ["robotarm"]}, "MCP list_todos 回傳資料夾")
s, _, _ = api("PUT", "/api/folders", {"folders": [{"name": "A", "tags": []}, {"name": "A", "tags": []}]})
check(s == 400, "資料夾名稱重複 → 400")
s, _, _ = api("PUT", "/api/folders", {"folders": [{"name": " ", "tags": []}]})
check(s == 400, "資料夾名稱空白 → 400")
s, _, _ = api("PUT", "/api/folders", {})
check(s == 400, "沒有 folders → 400")
s, _, b = api("PUT", "/api/folders", {"folders": []})
check(s == 200 and b["folders"] == [], "清空資料夾")
d1("DELETE FROM settings;")

# --- 多個標籤、期限的時間（雲端版本 6） ---
s, _, t = api("POST", "/api/todos", {"title": "多標籤", "tags": ["#微積分", "考試", "微積分", " "], "due": "2030-01-02", "dueTime": "09:30"})
check(s == 201 and t["tags"] == ["微積分", "考試"] and t["tag"] == "微積分" and t["dueTime"] == "09:30", "新增：去掉 #、重複、空白的標籤，第一個標籤放在 tag")
s, _, b = api("POST", "/api/todos", {"title": "沒有期限", "dueTime": "10:00"})
check(s == 201 and b["dueTime"] is None, "沒有期限就不存時間")
s, _, b = api("POST", "/api/todos", {"title": "壞時間", "due": "2030-01-02", "dueTime": "25:00"})
check(s == 400, "時間格式錯誤 → 400")
s, _, b = api("POST", "/api/todos", {"title": "舊版 App", "tag": "電子學"})
check(s == 201 and b["tags"] == ["電子學"] and b["tag"] == "電子學", "舊版只送 tag → tags 也有")
old = b["id"]
s, _, b = api("PATCH", f"/api/todos/{t['id']}", {"due": "2030-01-03"})
check(b["due"] == "2030-01-03" and b["dueTime"] == "09:30", "只改日期時保留時間")
s, _, b = api("PATCH", f"/api/todos/{t['id']}", {"dueTime": None})
check(b["dueTime"] is None and b["due"] == "2030-01-03", "清掉時間 → 一整天")
s, _, b = api("PATCH", f"/api/todos/{t['id']}", {"due": None, "dueTime": "08:00"})
check(b["due"] is None and b["dueTime"] is None, "清掉期限時時間也清掉")
s, _, b = api("PATCH", f"/api/todos/{t['id']}", {"tags": ["考試"]})
check(b["tags"] == ["考試"] and b["tag"] == "考試", "PATCH tags 整份取代")
s, _, b = api("PATCH", f"/api/todos/{old}", {"tag": None})
check(b["tags"] == [] and b["tag"] is None, "舊版清除 tag → tags 也清空")
err, r = call("add_todo", {"title": "期中考", "tags": ["微積分", "考試"], "due": "2030-01-02", "due_time": "13:00"})
check(not err and r["todo"]["tags"] == ["微積分", "考試"] and r["todo"]["dueTime"] == "13:00", "MCP add_todo tags / due_time")
err, r = call("add_todo", {"title": "早上的", "tags": ["微積分"], "due": "2030-01-02", "due_time": "08:00"})
err, r = call("add_todo", {"title": "一整天", "tags": ["微積分"], "due": "2030-01-02"})
err, l = call("list_todos", {"tag": "考試"})
check(not err and sorted(x["title"] for x in l["todos"]) == ["多標籤", "期中考"], "tag 篩選找得到第二個標籤")
check("考試" in l["tags"] and "微積分" in l["tags"], f"tags 清單包含每一個標籤 {l['tags']}")
err, l = call("list_todos", {"tag": "微積分", "due_before": "2030-01-02", "due_after": "2030-01-02"})
check([x["title"] for x in l["todos"]] == ["早上的", "期中考", "一整天"], "同一天：有時間的照時間排、一整天的在後面")
err, r = call("update_todo", {"id": l["todos"][0]["id"], "due_time": None, "tags": []})
check(not err and r["dueTime"] is None and r["tags"] == [], "MCP update_todo 清掉時間和標籤")
day = api("GET", "/api/todos")[2]["today"]
call("add_todo", {"title": "今天已過", "due": day, "due_time": "00:00"})
call("add_todo", {"title": "今天一整天", "due": day})
err, l = call("list_todos", {"overdue": True})
titles = [x["title"] for x in l["todos"]]
check("今天已過" in titles and "今天一整天" not in titles, "今天時間已過的算逾期，一整天的不算")
for x in api("GET", "/api/todos")[2]["todos"]:
    api("DELETE", f"/api/todos/{x['id']}")

print("\nALL PASSED")
