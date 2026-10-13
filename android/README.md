# Deskdo Android

Deskdo 的 Android 版：待辦清單 App，加上手機主畫面的小工具。資料存在你自己的 Cloudflare 帳號，和電腦版同步，也可以透過 MCP 連接器讓 Claude 等 AI 助理讀寫。

**一般使用者**：到 [Releases](https://github.com/adaizaiganma/deskdo/releases/latest) 下載 `Deskdo_*_arm64.apk` 安裝。第一次開啟時，設定精靈會帶你登入 Cloudflare；已經在電腦上設定過的話，用同一個帳號登入就會把這支手機加入。

1.0.0 以前 Android 版在另一個 repo（adaizaiganma/deskdo-android），歷史紀錄已經併進這裡。

## 結構

| 目錄 | 內容 |
|---|---|
| `src/` | App 的進入點；介面在 `../mobile`（`@deskdo/mobile`，和網頁版共用） |
| `src-tauri/` | Tauri 2 App：主視窗、偏好設定、APK 更新檢查（`updater.rs`）、和主畫面小工具之間的橋（`mobile.rs`） |
| `src-tauri/gen/android/` | Android 專案；主畫面小工具是 Kotlin（`DeskdoWidget.kt`、`WidgetPlugin.kt`、`WidgetStore.kt`） |

前端用 `@deskdo/core/...`、`@deskdo/mobile/...` 匯入共用的程式（根目錄的 npm workspace），Rust 依賴 `../core/rust`（crate `deskdo-core`）。設定精靈部署的雲端是 `../worker`。

## 開發

在 repo 根目錄：

```powershell
npm ci --prefix worker
npm ci
```

在 `android/`：

```powershell
npm run build:worker        # 打包 Worker（含網頁版），設定精靈會把它嵌進 App
npm run check               # Svelte／TypeScript 型別檢查
npm test
cd src-tauri; cargo test    # 在電腦上也能編譯（Android 專用的呼叫用 cfg(mobile) 隔開）
npx tauri android dev       # 需要 Android SDK、NDK
```

## 發布

和電腦版一起發布，見根目錄 README 的「發布」：推送 `v*` 標籤後，`.github/workflows/release.yml` 會把 APK 放進和電腦版同一個 Release。版本號和電腦版一樣。

### 簽名金鑰

APK 用作者的金鑰簽名：`~\.tauri\deskdo-android.jks`（PKCS12，別名 `deskdo`），密碼在 `deskdo-android.jks.password`。repo 的 Actions secrets `ANDROID_KEYSTORE_BASE64`（.jks 轉 base64）、`ANDROID_KEYSTORE_PASSWORD` 放的是同一把。**請備份**：換了金鑰，已安裝的 App 就不能直接更新，只能解除安裝再重裝。`release.yml` 會比對憑證的 SHA-256，不是這一把就不發布。App 的 identifier 是 `dev.deskdo.app`，不要改。

本機打包：`src-tauri/gen/android/keystore.properties`（不進 repo）寫 `storeFile=` 和 `passwordFile=`，Gradle 就會用它簽 release 版。Windows 沒開「開發人員模式」時 `tauri android build` 建不了 symlink，要自己把 `.so` 複製到 `jniLibs` 再跑 Gradle。

### 更新

App 會檢查 adaizaiganma/deskdo 的 `releases/latest` 有沒有比較新的 `.apk`，有的話在主畫面提示，按了用瀏覽器下載安裝。

- 0.7.0–0.10.x 查的是 adaizaiganma/deskdo-android 的 Release：那個 repo 要保留，而且 1.0.0 的 APK 要在那邊也發布一份，舊版才更新得到 1.0.0，之後就改查這裡。
- 0.6.0 和更早的版本查的是這個 repo（0.7.0 到 0.11.1 的 Release 只有電腦版，這些 App 一直找不到新的 APK）。1.0.0 的 Release 有 APK，所以它們也會直接收到更新。
