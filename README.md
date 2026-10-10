# Deskdo

貼在 Windows 桌面上的毛玻璃待辦清單，同時可以透過 claude.ai 自訂連接器（網頁／手機）讀寫。

**一般使用者**：到宣傳頁（`site/`，網址見 [發布](#4-發布)）或 [GitHub Releases](../../releases/latest) 下載安裝檔。第一次開啟時，設定精靈會帶你登入 Cloudflare，自動在你自己的帳號建立雲端。使用說明在宣傳頁的 `/guide`。

```
                         使用者自己的 Cloudflare 帳號
claude.ai（網頁／手機）──MCP──┐
                              ├──> Worker「deskdo」──> D1「deskdo」
Deskdo（Windows）──REST────┘
       └── 設定精靈：用 Cloudflare API 部署上面這兩個（不需要 wrangler）
```

| 目錄 | 內容 |
|---|---|
| `worker/` | Cloudflare Worker（TypeScript）：`/mcp/<密鑰>` 給 claude.ai、`/api/*` 給桌面 App |
| `app/` | Deskdo 桌面 App（Tauri 2 + Svelte 5）：桌面小工具、主視窗、系統匣、設定精靈 |
| `site/` | 宣傳頁（純靜態，用 Workers static assets 部署） |

---

## 1. 架構重點

### 設定精靈（`app/src-tauri/src/setup.rs`、`cloudflare.rs`、`oauth.rs`）

- 建置時 `build.rs` 會把打包好的 Worker（`worker/dist/index.js`）、`worker/migrations/*.sql`、`WORKER_VERSION` 和 `wrangler.jsonc` 的相容性設定嵌進 exe。
- 精靈用 Cloudflare OAuth（Authorization Code + PKCE，公開用戶端）或使用者貼上的 API token 取得權限，憑證只放在記憶體。
- 部署步驟：workers.dev 子網域 → D1 → migrations（和 wrangler 相容的 `d1_migrations` 表）→ 登記這台電腦 → 上傳 Worker → 開啟網址 → 確認連線。每一步都可以重複執行，所以「重試」和第二台電腦加入都走同一條路。
- 雲端已經是相同或更新的 Worker 版本時不會重新上傳，避免舊版 App 把雲端降級。上傳時用 `keep_bindings` 保留既有的 secret。
- App 每 6 小時（以及換連線設定時）查 `/api/info`；雲端版本比內建的舊時，主視窗會提示「更新雲端」。

### 驗證

- **桌面 App**：每台電腦一把 token，存在 D1 的 `devices` 表（只存 SHA-256），可以在設定裡個別撤銷。
- **claude.ai**：網址 `/mcp/<密鑰>`，密鑰存在 D1 的 `settings` 表，可以在 App 裡更換。密鑰錯誤時回 404，不透露端點存在。
- **舊版部署相容**：env 的 `API_TOKEN`、`MCP_SECRET`（`setup.ps1` 設定的）仍然有效，而且會先比對，所以還沒套用 0002 migration 的資料庫也能運作。
- 密鑰比對使用固定時間比較（`crypto.subtle.timingSafeEqual`）。
- 注意：`wrangler tail` 和 Cloudflare 的請求日誌會顯示完整網址（含 MCP 密鑰）。

### REST API（`worker/src/api.ts`，全部需要 Bearer token）

| 端點 | 說明 |
|---|---|
| `GET /api/todos` | 支援 `If-None-Match`，沒變動時回 304；`?doneDays=N` 只回傳最近 N 天完成的（App 用 30） |
| `POST /api/todos`、`PATCH /api/todos/:id`、`DELETE /api/todos/:id` | 新增、修改（只改有傳的欄位）、刪除 |
| `GET /api/info` | Worker 版本 |
| `GET /api/connector`、`POST /api/connector/rotate` | claude.ai 連接器網址、更換 |
| `GET /api/devices`、`DELETE /api/devices/:id` | 已連線的電腦、撤銷 |

MCP 工具（`worker/src/mcp.ts`）：`list_todos`、`add_todo`（`source_ref` 去重）、`update_todo`、`complete_todo`、`delete_todo`。

---

## 2. 本機開發

```powershell
# Worker
cd worker
npm install
copy .dev.vars.example .dev.vars    # 第一次：本機用的測試密鑰
npm run db:migrate:local
npm run dev                         # http://127.0.0.1:8787
python tests\smoke_test.py          # 另開一個終端機；會清空本機資料庫
npm run typecheck

# 桌面 App
cd app
npm install
npm test                            # 快速新增解析
npm run check                       # Svelte／TypeScript 型別檢查
cd src-tauri; cargo test; cd ..     # 需要先 npm run build:worker
$env:DESKDO_HOME = "$env:TEMP\deskdo-dev"   # 另一個設定目錄，不影響正式設定
npx tauri dev                       # 會先打包 Worker；改前端會即時更新
```

開發版不會修改「開機時啟動」的路徑。設定了 `DESKDO_HOME` 的執行個體不受單一執行個體限制，可以和正式版同時開。

### 測試設定精靈

| 環境變數 | 用途 |
|---|---|
| `DESKDO_HOME` | 設定與快取目錄（測試精靈時指向空目錄） |
| `DESKDO_SCRIPT_NAME` | 新部署的 Worker／D1 名稱，預設 `deskdo`；測試用 `deskdo-test` |
| `DESKDO_DEV_CF_TOKEN` | 只在開發版有效：「使用 Cloudflare 登入」直接用這個 token，不開瀏覽器 |
| `DESKDO_CF_CLIENT_ID` | Cloudflare OAuth client ID（建置時讀取，執行時的同名變數可覆寫） |
| `WEBVIEW2_USER_DATA_FOLDER` | 正式版開著、又要給開發版加 WebView2 參數（例如 `--remote-debugging-port`）時，指到另一個目錄，否則 WebView2 會啟動失敗 |

`DESKDO_DEV_CF_TOKEN` 可以用 `npx wrangler login` 之後 wrangler 存的 OAuth token。測完記得到 Cloudflare 後台刪掉 `deskdo-test` 的 Worker 和 D1。

---

## 3. 改版注意事項

- **改了 Worker 的行為或新增 migration**：`worker/src/version.ts` 的 `WORKER_VERSION` +1。已安裝的 App 會依這個數字提示使用者更新雲端。
- **migration 只能新增**，不要修改已發布的檔案：App 和 wrangler 都靠檔名判斷有沒有套用過。
- **Worker 要向下相容**：新版 App 可能連到還沒更新的雲端（例如 `/api/info` 不存在時視為版本 1）。
- App 版本號在 `app/package.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/tauri.conf.json` 三處。

---

## 4. 發布

### Cloudflare OAuth client（一次性）

Cloudflare 後台 → 管理帳戶 → OAuth clients → 建立：

| 欄位 | 值 |
|---|---|
| 名稱、Logo | Deskdo、`app/app-icon.svg` |
| Client URL | 宣傳頁網址（網域要用 DNS TXT 驗證，才能設成 public） |
| Redirect URI | `http://localhost:47613/callback` |
| Scopes | `account-settings.read`、`workers-scripts.write`、`d1.write` |
| 驗證方式 | PKCE（公開用戶端，不需要 client secret） |

驗證完網域後把 visibility 改成 public（不可逆）。在那之前只有你自己的帳號能登入，適合測試。

### 安裝檔

```powershell
git tag v0.4.0
git push origin v0.4.0
```

`.github/workflows/release.yml` 會在 Windows 上建置並建立 GitHub Release 草稿，確認後按發布。需要先在 repo 的 Actions variables 設定 `DESKDO_CF_CLIENT_ID`。

本機建置：`cd app; $env:DESKDO_CF_CLIENT_ID = "<client id>"; npx tauri build`，輸出在 `app\src-tauri\target\release\bundle\nsis\`。

安裝檔沒有程式碼簽章，使用者會看到 SmartScreen 警告（宣傳頁的常見問題有說明）。

### 宣傳頁

```powershell
cd site
npx wrangler deploy
```

部署後在 Cloudflare 後台的 Worker →「設定 → 網域和路由」加上自訂網域。頁面裡的 `GITHUB_REPO` 要換成實際的 `帳號/repo`。

---

## 5. 自己用 wrangler 部署（進階）

不想用設定精靈的開發者，可以用舊的腳本部署（Worker 名稱 `todo-worker`、D1 名稱 `todo-db`）：

```powershell
cd worker
npx wrangler login
.\scripts\setup.ps1                 # 建立 D1、套用 migration、部署、產生密鑰並寫入 Deskdo 設定
.\scripts\setup.ps1 -RotateSecrets  # 更換兩把密鑰
```

之後修改程式用 `npm run deploy`，新增 migration 後執行 `npm run db:migrate:remote`。這種部署的密鑰在 env，App 裡的「更換網址」不能用，請用 `-RotateSecrets`。App 的「更新雲端」仍然可以使用（會保留 env 的密鑰）。

---

## 6. 已知限制

- 桌面小工具永遠排在桌面（Progman）正上方：平常在所有視窗下面，點它也不會跑到前面；按 Win+D 時會跟著桌面一起出現。它不會出現在工作列和 Alt+Tab。
- 毛玻璃用 `SetWindowCompositionAttribute` 的 Acrylic，非作用中時也保持效果；拖曳移動可能比較不順。Windows「透明效果」關閉時背景會變實心。
- 只支援 Windows。

## 資料格式

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 8 字元隨機 id |
| `title` | string | 1–200 字 |
| `done` / `doneAt` | bool / ISO 8601 | 完成狀態與完成時間（UTC） |
| `due` | `YYYY-MM-DD` \| null | 期限（Worker 的 `TIMEZONE`，精靈部署時取使用者電腦的時區） |
| `tag` | string \| null | 課名、專案 |
| `priority` | `high` \| `normal` | |
| `note` | string \| null | |
| `createdAt` / `updatedAt` | ISO 8601 | UTC |
| `source` | `manual` \| `claude` \| `email` | |
| `sourceRef` | string \| null | 外部 id（例如 Gmail message ID），有唯一索引 |
