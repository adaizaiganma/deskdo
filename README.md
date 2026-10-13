# Deskdo

貼在 Windows 桌面上的毛玻璃待辦清單。Android 版（含主畫面小工具）在另一個 repo：[adaizaiganma/deskdo-android](https://github.com/adaizaiganma/deskdo-android)。可以單獨使用，也可以透過 MCP 自訂連接器讓 Claude、ChatGPT 等 AI 助理讀寫。

**一般使用者**：到宣傳頁（`site/`，網址見 [發布](#4-發布)）或 [GitHub Releases](../../releases/latest) 下載安裝檔 `Deskdo_*_x64-setup.exe`（Android 版到 [deskdo-android 的 Releases](https://github.com/adaizaiganma/deskdo-android/releases/latest) 下載 APK）。第一次開啟時，設定精靈會帶你登入 Cloudflare，自動在你自己的帳號建立雲端。使用說明在宣傳頁的 `/guide`。

```
                         使用者自己的 Cloudflare 帳號
AI 助理（選用）──────────MCP──┐
                              ├──> Worker「deskdo」──> D1「deskdo」
Deskdo（Windows）──REST────┘
       └── 設定精靈：用 Cloudflare API 部署上面這兩個（不需要 wrangler）
```

| 目錄 | 內容 |
|---|---|
| `worker/` | Cloudflare Worker（TypeScript）：`/mcp/<密鑰>` 給 AI 助理（任何支援遠端 MCP 的工具）、`/api/*` 給 App 和網頁版、`/app` 是網頁版 |
| `desktop/` | Deskdo 電腦版（Tauri 2 + Svelte 5）：桌面小工具、主視窗、系統匣 |
| `core/` | 電腦版和 Android 版共用的核心：`core/src`（前端的 `@deskdo/core`：同步、資料格式、日期、快速新增的解析、倒數日；`backend.ts` 決定資料從 Rust 來還是網頁版的 `web/backend.ts`）、`core/rust`（Rust crate `deskdo-core`：同步、設定檔、設定精靈、OAuth） |
| `mobile/` | 手機版介面（`@deskdo/mobile`）：Android 版和網頁版共用 |
| `web/` | 網頁版（給 iPhone、iPad 等沒有 App 的裝置）：建置後由 `worker/scripts/embed-web.mjs` 嵌進 Worker，在使用者自己雲端的 `/app` 提供，用電腦版產生的配對碼登入。窄螢幕用 `mobile/` 的手機版介面，寬螢幕（電腦、平板）用 `desktop/` 的電腦版主視窗（`web/src/layout.ts`） |
| `site/` | 宣傳頁（純靜態，用 Workers static assets 部署） |

---

## 1. 架構重點

### 設定精靈（`core/rust/src/setup.rs`、`cloudflare.rs`、`oauth.rs`）

- 建置時 `core/rust/build.rs` 會把打包好的 Worker（`worker/dist/index.js`）、`worker/migrations/*.sql`、`WORKER_VERSION` 和 `wrangler.jsonc` 的相容性設定嵌進 exe。
- 精靈用 Cloudflare OAuth（Authorization Code + PKCE，公開用戶端）或使用者貼上的 API token 取得權限，憑證只放在記憶體。
- 部署步驟：workers.dev 子網域 → D1 → migrations（和 wrangler 相容的 `d1_migrations` 表）→ 登記這台電腦 → 上傳 Worker → 開啟網址 → 確認連線。每一步都可以重複執行，所以「重試」和第二台電腦加入都走同一條路。
- 雲端已經是相同或更新的 Worker 版本時不會重新上傳，避免舊版 App 把雲端降級。上傳時用 `keep_bindings` 保留既有的 secret。
- App 每 6 小時（以及換連線設定時）查 `/api/info`；雲端版本比內建的舊時，主視窗會提示「更新雲端」。

### 驗證

- **桌面 App**：每台電腦一把 token，存在 D1 的 `devices` 表（只存 SHA-256），可以在設定裡個別撤銷。
- **網頁版**（`/app`）：在已連線的 App 按「產生配對碼」（`POST /api/pairing`，6 位數、5 分鐘、錯 5 次作廢，存在 `settings` 的 `pairing`），網頁版送到 `POST /app/pair` 換到自己的裝置 token，放在 `__Host-deskdo` cookie（HttpOnly、Secure、SameSite=Strict）。用 cookie 的請求一定要帶 `X-Deskdo-Web: 1`，擋掉跨站偽造的請求。網頁和 API 同一個網址，不需要 CORS。
- **AI 助理**：網址 `/mcp/<密鑰>`（Streamable HTTP，無狀態；不需要 OAuth），密鑰存在 D1 的 `settings` 表，可以在 App 裡更換。密鑰錯誤時回 404，不透露端點存在。
- **舊版部署相容**：env 的 `API_TOKEN`、`MCP_SECRET`（`setup.ps1` 設定的）仍然有效，而且會先比對，所以還沒套用 0002 migration 的資料庫也能運作。
- 密鑰比對使用固定時間比較（`crypto.subtle.timingSafeEqual`）。
- 注意：`wrangler tail` 和 Cloudflare 的請求日誌會顯示完整網址（含 MCP 密鑰）。

### REST API（`worker/src/api.ts`，全部需要 Bearer token，或網頁版的 cookie）

| 端點 | 說明 |
|---|---|
| `GET /api/todos` | 支援 `If-None-Match`，沒變動時回 304；`?doneDays=N` 只回傳最近 N 天完成的（App 用 30） |
| `POST /api/todos`、`PATCH /api/todos/:id`、`DELETE /api/todos/:id` | 新增、修改（只改有傳的欄位）、刪除。`afterId` 把待辦接在另一筆後面（見下方「接續的步驟」） |
| `GET /api/folders`、`PUT /api/folders` | 標籤資料夾（整份取代；`GET /api/todos` 也會附上 `folders`）。存在 D1 `settings` 的 `tag_folders`，只影響顯示 |
| `GET /api/info` | Worker 版本 |
| `GET /api/connector`、`POST /api/connector/rotate` | AI 連接器網址、更換 |
| `GET /api/devices`、`DELETE /api/devices/:id` | 已連線的電腦、撤銷 |
| `POST /api/pairing` | 產生網頁版的配對碼（Worker v7） |

**接續的步驟**（Worker v5，`todos.afterId`）：`afterId` 指向前一步，前一步還沒完成時，App 不顯示這一筆，也不算進數量。每筆最多一個前一步和一個下一步，由 Worker 維護：

- 接到已經有下一步的待辦後面時，會插在中間。
- 連接已有的待辦時，它後面的步驟會一起移過去；會繞成圈時回 400。
- 刪掉中間一步時，前後自動接起來。

MCP 工具（`worker/src/mcp.ts`）：`list_todos`（也回傳 `tags`、`folders`，還沒輪到的步驟標 `waiting`）、`add_todo`（`source_ref` 去重）、`update_todo`、`complete_todo`、`delete_todo`。

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

# 電腦版（core 和 desktop 是同一個 npm workspace，在根目錄安裝）
npm install
cd core; npm test; cd ..            # 共用的邏輯（快速新增解析、日期…）
cd desktop
npm test
npm run check                       # Svelte／TypeScript 型別檢查
cd src-tauri; cargo test -p deskdo -p deskdo-core; cd ..   # 需要先 npm run build:worker
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

### 測試版（Deskdo Beta）

給還沒發布的改動做實機測試，可以和正式版同時安裝：

```powershell
cd desktop
$env:DESKDO_CF_CLIENT_ID = "<client id>"
.\scripts\build-beta.ps1     # 輸出 Deskdo Beta_<版本>_x64-setup.exe
```

測試版用自己的 identifier（`dev.deskdo.beta`）、設定目錄（`%APPDATA%\Deskdo Beta`）和雲端（`deskdo-beta`），標題列標示「測試版」，不會自動更新。

---

## 3. 改版注意事項

- **改了 Worker 的行為或新增 migration**：`worker/src/version.ts` 的 `WORKER_VERSION` +1。已安裝的 App 會依這個數字提示使用者更新雲端。
- **migration 只能新增**，不要修改已發布的檔案：App 和 wrangler 都靠檔名判斷有沒有套用過。
- **Worker 要向下相容**：新版 App 可能連到還沒更新的雲端（例如 `/api/info` 不存在時視為版本 1）。
- App 版本號在 `desktop/package.json`、`desktop/src-tauri/Cargo.toml`、`desktop/src-tauri/tauri.conf.json` 三處。
- **改了 `core/` 或 `mobile/`**：Android 版透過 git submodule（`upstream/`）使用這個 repo，要在 deskdo-android 更新 submodule 才會用到。改的時候注意兩邊都還能編譯。
- **電腦版主視窗也在網頁版裡**：`desktop/src/windows/Main.svelte` 和它用到的元件要能在瀏覽器執行：透過 `@deskdo/core/backend` 呼叫指令（網頁版不支援的指令會失敗），視窗相關的（標題列、桌面小工具、開機啟動）看 `store.prefs.web` 隱藏，右鍵選單在 iPad 上是長按（`web/src/longpress.ts`），只靠滑鼠移上去才出現的按鈕在觸控螢幕要一直顯示（`@media (hover: none)`）。
- **網頁版會嵌進 Worker**：`desktop` 的 `npm run build:worker` 會先建置 `web/` 再打包 Worker（`worker` 的 `npm run bundle` 找不到 `web/dist` 時會失敗）。網頁版不帶字型檔（Worker 壓縮後要在 3 MB 以內），用系統內建的字型。

---

## 4. 發布

### Cloudflare OAuth client（一次性）

Cloudflare 後台 → 管理帳戶 → OAuth clients → 建立：

| 欄位 | 值 |
|---|---|
| 名稱、Logo | Deskdo、`desktop/app-icon.svg` |
| Client URL | 宣傳頁網址（網域要用 DNS TXT 驗證，才能設成 public） |
| Redirect URI | `http://localhost:47613/callback` |
| Scopes | Account Settings Read、Workers Admin、D1 Write（`account-settings.read`、`workers-scripts.admin`、`d1.write`），全部設為必要。Workers Editor 只能修改既有的 Worker，建立新的會回 403「No access to the specified resource」，所以要用 Admin |
| 驗證方式 | PKCE（公開用戶端，不需要 client secret） |

驗證完網域後把 visibility 改成 public（不可逆）。在那之前只有你自己的帳號能登入，適合測試。

### 安裝檔

```powershell
git tag v0.6.0
git push origin v0.6.0
```

`.github/workflows/release.yml` 會在 Windows 上建置安裝檔，放進 GitHub Release 草稿，確認後按發布。需要先在 repo 的 Actions 設定 variable `DESKDO_CF_CLIENT_ID` 和兩個自動更新的簽章 secret（見下一節）。

本機建置：`cd desktop; $env:DESKDO_CF_CLIENT_ID = "<client id>"; npx tauri build`，輸出在 `desktop\src-tauri\target\release\bundle\nsis\`。因為會一起產生自動更新檔，本機建置也需要簽章私鑰：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~\.tauri\deskdo-updater.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content ~\.tauri\deskdo-updater.key.password -Raw
```

安裝檔沒有程式碼簽章，使用者會看到 SmartScreen 警告（宣傳頁的常見問題有說明）。

### Android

在另一個 repo：[adaizaiganma/deskdo-android](https://github.com/adaizaiganma/deskdo-android)，有自己的版本號和 Release。

### 自動更新

**發布 Release 就等於推送更新。** 已安裝的正式版會讀 `https://github.com/adaizaiganma/deskdo/releases/latest/download/latest.json`（由 tauri-action 產生），在背景下載新版，使用者按「重新啟動並更新」（主視窗提示、小工具 `⋯` 選單、系統匣選單或設定頁）就會安裝並重新開啟。草稿和 pre-release 不會被當成最新版。

- App 啟動 20 秒後檢查一次，之後每 6 小時一次；設定頁也可以手動「檢查更新」。開發版和測試版（Deskdo Beta）不自動更新。
- 更新檔用作者的私鑰簽章，App 用 `tauri.conf.json` 裡的公鑰驗證，簽章不符就不安裝。
- 私鑰：`~\.tauri\deskdo-updater.key`，密碼在 `deskdo-updater.key.password`。同樣的內容存在 repo 的 Actions secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。**請備份到密碼管理器**：私鑰遺失後，已安裝的 App 就收不到更新，只能請使用者手動重裝。
- 雲端 Worker 不會跟著自動更新：新版 App 內建較新的 Worker 時，主視窗會出現「雲端有新版本」，使用者登入 Cloudflare 後更新。

### 宣傳頁

```powershell
cd site
npx wrangler deploy
```

部署後在 Cloudflare 後台的 Worker →「設定 → 網域和路由」加上自訂網域。

---

## 5. 自己用 wrangler 部署（進階）

`worker/wrangler.jsonc` 的 Worker 和 D1 名稱都是 `deskdo`，和設定精靈建立的相同，`database_id` 是作者帳號裡的資料庫。

**已經用設定精靈建好雲端**（建議）：把 `database_id` 換成自己帳號裡 `deskdo` 的 uuid（`npx wrangler d1 list`），之後修改程式用 `npm run deploy`，新增 migration 後執行 `npm run db:migrate:remote`。驗證用的 token 和 MCP 密鑰都在 D1，不需要 `wrangler secret`。

**完全不用設定精靈**：用舊的腳本，它會建立 D1、部署，並把密鑰設在 env：

```powershell
cd worker
npx wrangler login
.\scripts\setup.ps1                 # 建立 D1、套用 migration、部署、產生密鑰並寫入 Deskdo 設定
.\scripts\setup.ps1 -RotateSecrets  # 更換兩把密鑰
```

這種部署的密鑰在 env，App 裡的「更換網址」不能用，請用 `-RotateSecrets`；也沒有個別電腦的紀錄，另一台電腦要手動填網址和 token。

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
