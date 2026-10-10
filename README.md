# Deskdo

貼在 Windows 桌面上的毛玻璃待辦清單，同時可以透過 claude.ai 自訂連接器（網頁／手機）讀寫。

```
claude.ai（網頁／手機）──MCP──┐
                              ├──> Cloudflare Worker ──> D1 (SQLite)
Deskdo（Windows）──REST────┘
```

| 目錄 | 內容 |
|---|---|
| `worker/` | Cloudflare Worker（TypeScript）：`/mcp/<密鑰>` 給 claude.ai、`/api/todos` 給桌面 App |
| `app/` | Deskdo 桌面 App（Tauri 2 + Svelte 5）：釘在桌面的小工具 + 系統匣開啟的主視窗 |

---

## 1. 部署 Worker（第一次約 5 分鐘）

需要一個 Cloudflare 帳號（免費方案，不用綁卡）。

```powershell
cd worker
npx wrangler login          # 開瀏覽器登入 Cloudflare 並授權
.\scripts\setup.ps1         # 建立 D1、套用 migration、部署、產生密鑰
```

`setup.ps1` 做的事：

1. 建立 D1 資料庫 `todo-db`（亞太區），把 `database_id` 寫進 `wrangler.jsonc`
2. 套用 `migrations/`
3. `wrangler deploy`（第一次會請你註冊 `xxx.workers.dev` 子網域），之後請你貼上網址
4. 產生兩把 256-bit 隨機密鑰並用 `wrangler secret put` 設定
   - `MCP_SECRET`：放在 claude.ai 連接器網址裡
   - `API_TOKEN`：Deskdo 的 Bearer token，**自動寫入** `%APPDATA%\Deskdo\config.json`
5. 印出 claude.ai 連接器網址（**只會顯示這一次**，請存到密碼管理器）

之後修改程式只要 `npm run deploy`；新增 migration 後執行 `npm run db:migrate:remote`。

### 更換密鑰（網址外洩時）

```powershell
.\scripts\setup.ps1 -RotateSecrets
```

舊網址與舊 token 立即失效。之後到 claude.ai 把連接器網址換成新的，並重新開啟桌面小工具。

---

## 2. 連接 claude.ai

1. claude.ai →「設定」→「連接器」→「新增自訂連接器」
2. 名稱：`待辦清單`；網址：`https://todo-worker.xxx.workers.dev/mcp/<MCP_SECRET>`
3. 不需要填 OAuth 設定（這個連接器不使用 OAuth，驗證靠網址裡的密鑰）
4. 手機版 Claude App 會自動同步同一組連接器

可用的工具：

| 工具 | 說明 |
|---|---|
| `list_todos` | 篩選：`status`（open/done/all，預設 open）、`tag`、`priority`、`due_before`、`due_after`、`overdue`、`no_due`、`query`；回傳內容附 `today` 和目前使用中的所有 `tags` |
| `add_todo` | 帶 `source_ref` 時會去重：同一個 ref 已存在就不新增，回傳既有那筆並標記 `created: false` |
| `update_todo` | 只修改有傳的欄位；`due`/`tag`/`note` 傳 `null` 會清除 |
| `complete_todo` | `done: false` 可以取消完成 |
| `delete_todo` | 永久刪除 |

### Gmail 每日排程提示詞範例

在 claude.ai 建立排程任務（每天早上），同時啟用 Gmail 和「待辦清單」連接器：

```
請檢查我過去 24 小時收到的 Gmail（略過電子報、廣告與自動通知），
找出需要我採取行動的信件，例如作業、繳費、回覆、報名、期限。

每一件事都用 add_todo 新增：
- title：一句話、動詞開頭的繁體中文，例如「回覆王教授專題進度」
- due：信中有期限就填（YYYY-MM-DD），沒有就不填
- tag：能判斷課名或專案就填，請沿用 list_todos 回傳的既有 tags
- priority：期限在 3 天內或寄件者是老師／學校行政時設為 high
- note：寄件者、主旨，以及一句摘要
- source："email"，source_ref：該封信的 Gmail message ID（用來避免重複新增）

最後列出今天新增了哪些項目，以及目前逾期的待辦（list_todos overdue=true）。
```

---

## 3. 桌面 App

### 安裝

```powershell
cd app
npm install
npx tauri build
```

輸出：

- `app\src-tauri\target\release\bundle\nsis\Deskdo_<版本>_x64-setup.exe`：安裝檔（約 6 MB），裝在目前使用者底下，不需要系統管理員權限
- `app\src-tauri\target\release\deskdo.exe`：免安裝的單一 exe（約 8 MB）

設定檔是 `%APPDATA%\Deskdo\config.json`，`setup.ps1` 寫入的網址和 token 會直接讀到。

**從 0.2.x（舊名 TodoWidget）升級**：先在舊版系統匣選「結束」，再安裝 Deskdo。第一次啟動會自動從 `%APPDATA%\TodoWidget` 複製設定和快取，舊的「TodoWidget」開機啟動項目也會換成 Deskdo。確認沒問題後，到「Windows 設定 → 應用程式」解除安裝 TodoWidget。

### 開機自動啟動

系統匣選單或主視窗「設定」裡的「開機時啟動」。這個選項會寫入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，不需要系統管理員權限。
如果搬移了 exe 的位置，新位置的 exe 啟動一次就會自動更新路徑。

### 使用方式

- **系統匣圖示**：左鍵開啟主視窗，右鍵開選單。圖示上的數字是「今天到期＋逾期」的件數，有逾期時會變紅。
- **主視窗**：左側有「今天／即將到來／全部／沒有期限／已完成」和各標籤。`Ctrl+N` 新增、`Ctrl+F` 搜尋。關閉視窗只會收回系統匣；要完全結束請用系統匣選單的「結束」。
- **桌面小工具**：拖曳標題列移動，拖曳邊緣調整大小，位置會記住。它永遠待在其他視窗下面。上方的標籤可以篩選；右上角 `⋯` 可以開主視窗、同步、設定或隱藏。
- 待辦依期限分組：逾期、今天、明天、接下來 7 天、之後、沒有期限。
- **勾選**完成；**點一下**或按**右鍵**項目就在原地展開編輯（標題、期限、標籤、優先度、備註），改完自動儲存。其他地方的右鍵不會跳出瀏覽器選單；輸入框請用 Ctrl+X／C／V 剪下、複製、貼上。
- 完成和刪除都不會跳確認視窗，而是在底部顯示「復原」；刪除在 5 秒後才真的送出。
- **快速新增**：在輸入框打字後按 Enter（中文輸入法選字時按 Enter 不會送出）。輸入時會即時顯示解析出的期限、標籤和優先度。可以加上這些標記：

  ```
  交作業三 #微積分 @週五 !
  ```

  | 標記 | 意義 |
  |---|---|
  | `#標籤` | 標籤（課名等） |
  | `@今天` `@明天` `@後天` `@週一`…`@週日` `@下週三` `@10/15` `@2026-10-15` | 期限 |
  | `!` | 高優先 |

- 每 30 秒同步一次（可以在設定裡改）。資料沒有變動時伺服器回 304，幾乎不耗 D1 額度。兩個視窗共用同一份資料，不會重複輪詢。
- 離線時會顯示上次的快取；離線時做的修改會復原並提示，不會悄悄遺失。
- 已完成的項目只同步最近 30 天的（主視窗「已完成」頁），桌面小工具只顯示今天完成的。更早的紀錄仍保存在雲端，可以請 Claude 用 `list_todos status=done` 查詢。

### 已知限制

- 桌面小工具永遠排在桌面（Progman）正上方：平常在所有視窗下面，點它也不會跑到前面；按 **Win+D** 時會跟著桌面一起出現。它不會出現在工作列和 Alt+Tab。
- 毛玻璃用的是 `SetWindowCompositionAttribute` 的 Acrylic，非作用中時也會保持效果。設定裡的「毛玻璃濃度」控制色調深淺，調到 0% 時幾乎只剩模糊的桌布。
  拖曳移動時可能比較不順，這是 Windows 本身的限制。Windows「設定 → 個人化 → 色彩 → 透明效果」關閉時，背景會變成實心。

---

## 4. 安全性說明

- claude.ai 自訂連接器只支援「不需驗證」或 OAuth，無法自訂 header。所以 MCP 端點用網址裡的 256-bit 密鑰保護；密鑰錯誤時回 404，不會透露端點存在。
- REST API 用另一把獨立的 Bearer token，兩把可以分別更換。
- 密鑰比對使用固定時間比較（`crypto.subtle.timingSafeEqual`）。
- 注意：`wrangler tail` 和 Cloudflare 的請求日誌會顯示完整網址（含密鑰）。不要把這些日誌分享給別人。
- 之後如果想改用 OAuth，可以用 `@cloudflare/workers-oauth-provider` 包住 `/mcp`，其他部分不用改。

---

## 5. 本機開發與測試

```powershell
# Worker
cd worker
npm install
copy .dev.vars.example .dev.vars        # 第一次：本機用的測試密鑰
npm run db:migrate:local
npm run dev                         # http://127.0.0.1:8787，密鑰在 .dev.vars
python tests\smoke_test.py          # 另開一個終端機；會清空本機資料庫
npm run typecheck

# 桌面 App
cd app
npm test                                        # 快速新增解析、日期分組
npm run check                                   # Svelte／TypeScript 型別檢查
$env:DESKDO_HOME = "$env:TEMP\deskdo-dev"       # 用另一個設定目錄，不影響正式設定
npx tauri dev                                   # 改前端會即時更新
```

開發版不會修改「開機時啟動」的路徑，避免蓋掉正式版的設定。

### 資料格式

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 8 字元隨機 id |
| `title` | string | 1–200 字 |
| `done` / `doneAt` | bool / ISO 8601 | 完成狀態與完成時間（UTC） |
| `due` | `YYYY-MM-DD` \| null | 期限（Asia/Taipei） |
| `tag` | string \| null | 課名、專案 |
| `priority` | `high` \| `normal` | |
| `note` | string \| null | |
| `createdAt` / `updatedAt` | ISO 8601 | UTC |
| `source` | `manual` \| `claude` \| `email` | |
| `sourceRef` | string \| null | 外部 id（例如 Gmail message ID），有唯一索引 |
