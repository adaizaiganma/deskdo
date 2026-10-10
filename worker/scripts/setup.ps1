# 一鍵部署：建立 D1、套用 migration、部署 Worker、產生並設定密鑰。
# 用法（在 worker 目錄）：
#   npx wrangler login              # 第一次需要，會開瀏覽器登入 Cloudflare
#   .\scripts\setup.ps1             # 部署；第一次會順便產生密鑰
#   .\scripts\setup.ps1 -RotateSecrets   # 重新產生兩把密鑰（舊的立即失效）
param([switch]$RotateSecrets)

# 不用 "Stop"：Windows PowerShell 5.1 會把 wrangler 寫到 stderr 的警告當成錯誤中斷。
# 每個步驟改為檢查 $LASTEXITCODE。
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
$config = "wrangler.jsonc"
$placeholder = "00000000-0000-0000-0000-000000000000"

function New-Secret([int]$bytes = 32) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    # URL-safe base64，可以直接放在網址路徑裡
    return [Convert]::ToBase64String($b).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

# 不需要互動的 wrangler 指令一律用非互動模式執行，避免輸出被擷取時看不到提問而卡住
function Invoke-Quiet {
    $wranglerArgs = $args  # try 區塊內的 $args 是空的，要先存起來
    $env:CI = "1"
    try { npx wrangler @wranglerArgs } finally { Remove-Item Env:CI -ErrorAction SilentlyContinue }
}

Write-Host "== 檢查登入狀態"
$env:CI = "1"
npx wrangler whoami
$code = $LASTEXITCODE
Remove-Item Env:CI
if ($code -ne 0) { throw "請先執行 npx wrangler login" }

# 1. D1 資料庫
$text = Get-Content $config -Raw -Encoding utf8
if ($text.Contains($placeholder)) {
    Write-Host "== 建立 D1 資料庫 todo-db"
    Invoke-Quiet d1 create todo-db --location apac --update-config=false
    if ($LASTEXITCODE -ne 0) { Write-Host "（建立失敗，可能已存在，改為查詢既有資料庫）" }
    $dbs = Invoke-Quiet d1 list --json | Out-String | ConvertFrom-Json
    $db = $dbs | Where-Object { $_.name -eq "todo-db" } | Select-Object -First 1
    if (-not $db) { throw "找不到 todo-db" }
    $text = $text.Replace($placeholder, $db.uuid)
    [IO.File]::WriteAllText((Resolve-Path $config), $text, (New-Object Text.UTF8Encoding $false))
    Write-Host "已將 database_id = $($db.uuid) 寫入 $config"
}

Write-Host "== 套用 migration"
Invoke-Quiet d1 migrations apply todo-db --remote
if ($LASTEXITCODE -ne 0) { throw "migration 失敗" }

# 2. 部署
Write-Host "== 部署 Worker"
# 不擷取輸出：第一次部署時 wrangler 可能會互動式詢問要註冊的 workers.dev 子網域
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "部署失敗" }
do {
    $url = (Read-Host "請貼上上面顯示的網址（https://todo-worker.xxx.workers.dev）").Trim().TrimEnd("/")
} until ($url -match "^https://[a-z0-9.-]+\.workers\.dev$")

# 3. 密鑰
Write-Host "== 檢查密鑰"
$existing = Invoke-Quiet secret list 2>$null | Out-String
$hasSecrets = $existing.Contains("MCP_SECRET") -and $existing.Contains("API_TOKEN")
if ($hasSecrets -and -not $RotateSecrets) {
    Write-Host ""
    Write-Host "密鑰已存在，未變更（要重新產生請加 -RotateSecrets）。"
    Write-Host "Worker 網址：$url"
    exit 0
}

Write-Host "== 設定密鑰"
$mcpSecret = New-Secret 32
$apiToken = New-Secret 32
# 用管線把密鑰送進 stdin（函式不會轉送管線輸入，所以這裡直接呼叫 npx）
$env:CI = "1"
$mcpSecret | npx wrangler secret put MCP_SECRET
$ok1 = $LASTEXITCODE -eq 0
$apiToken | npx wrangler secret put API_TOKEN
$ok2 = $LASTEXITCODE -eq 0
Remove-Item Env:CI
if (-not ($ok1 -and $ok2)) { throw "設定密鑰失敗" }

# 把 API 網址與 token 寫進 Deskdo 的設定檔（保留其他設定）
$widgetDir = Join-Path $env:APPDATA "Deskdo"
New-Item -ItemType Directory -Force $widgetDir | Out-Null
$widgetCfgPath = Join-Path $widgetDir "config.json"
$widgetCfg = @{}
if (Test-Path $widgetCfgPath) {
    (Get-Content $widgetCfgPath -Raw -Encoding utf8 | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $widgetCfg[$_.Name] = $_.Value }
}
$widgetCfg["api_base"] = $url
$widgetCfg["api_token"] = $apiToken
[IO.File]::WriteAllText($widgetCfgPath, ($widgetCfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "================ 完成 ================"
Write-Host "claude.ai 自訂連接器網址（請當作密碼保管，只會顯示這一次）："
Write-Host ""
Write-Host "    $url/mcp/$mcpSecret"
Write-Host ""
Write-Host "Deskdo 的網址與 token 已寫入 $widgetCfgPath"
Write-Host "若 Deskdo 正在執行，請從系統匣選「結束」後重新開啟。"
