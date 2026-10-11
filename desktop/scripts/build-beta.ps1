# 建置測試版 Deskdo Beta：和正式版分開安裝、分開設定，雲端名稱是 deskdo-beta，兩個可以同時使用。
# 用法（在 app 目錄）：
#   $env:DESKDO_CF_CLIENT_ID = "<Cloudflare OAuth client ID>"   # 沒設定時精靈只能用 API token
#   .\scripts\build-beta.ps1
# 輸出：src-tauri\target\release\bundle\nsis\Deskdo Beta_<版本>_x64-setup.exe
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not $env:DESKDO_CF_CLIENT_ID) { Write-Warning "沒有設定 DESKDO_CF_CLIENT_ID，測試版不會有「使用 Cloudflare 登入」" }
$env:DESKDO_CHANNEL = "beta"
try {
    npx tauri build --config src-tauri/tauri.beta.conf.json
} finally {
    Remove-Item Env:DESKDO_CHANNEL -ErrorAction SilentlyContinue
}
