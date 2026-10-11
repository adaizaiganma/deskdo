//! 設定精靈：在使用者自己的 Cloudflare 帳號部署 Deskdo 雲端（Worker + D1），或更新既有的部署。
//!
//! 每個步驟都可以重複執行：已經存在的資源直接沿用，所以失敗後按「重試」或第二台電腦再跑一次都沒問題。
//! 第二台電腦跑精靈時，只會在 D1 新增一台裝置的 token，不會動到資料。

use crate::{
    api,
    cloudflare::{Account, Cf, CfError},
    config::Config,
    store::shared,
    windows,
};
use base64::Engine;
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/embedded.rs"));
}
pub use embedded::WORKER_VERSION;

/// 新部署的 Worker 與 D1 名稱；DESKDO_SCRIPT_NAME 可以覆寫（測試用）
fn default_script_name() -> String {
    let default = if crate::config::BETA { "deskdo-beta" } else { "deskdo" };
    std::env::var("DESKDO_SCRIPT_NAME").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| default.into())
}

/// 精靈進行中的 Cloudflare 憑證；只放在記憶體，完成或取消就清掉
#[derive(Default)]
pub struct SetupState {
    token: Mutex<Option<String>>,
    /// 這次設定已經登記的電腦（資料庫 id, token）。按「重試」時沿用，不會重複登記
    device: Mutex<Option<(String, String)>>,
    /// 取消等待中的 OAuth 登入
    pub(crate) cancel: tokio::sync::Notify,
}

impl SetupState {
    async fn clear(&self) {
        *self.token.lock().await = None;
        *self.device.lock().await = None;
    }
}

async fn cf(app: &AppHandle) -> Result<Cf, String> {
    let token = app.state::<SetupState>().token.lock().await.clone().ok_or("請先連接 Cloudflare 帳號")?;
    Ok(Cf::new(shared(app).client.clone(), token))
}

// ---- 部署目標 ----

enum Target {
    /// 第一次設定（或另一台電腦加入既有的部署）
    New { script: String },
    /// 已經設定過：更新目前連線的那個 Worker（名稱與子網域從 api_base 解析）
    Update { script: String, subdomain: String },
}

impl Target {
    fn from_config(cfg: &Config) -> Result<Self, String> {
        if !cfg.configured() {
            return Ok(Target::New { script: default_script_name() });
        }
        let (script, subdomain) = parse_workers_dev(&cfg.api_base)
            .ok_or("目前的 API 網址不是 workers.dev 網址，無法自動更新；請改用 wrangler 部署")?;
        Ok(Target::Update { script, subdomain })
    }

    fn script(&self) -> &str {
        match self {
            Target::New { script } | Target::Update { script, .. } => script,
        }
    }
}

/// https://<script>.<subdomain>.workers.dev → (script, subdomain)
fn parse_workers_dev(api_base: &str) -> Option<(String, String)> {
    let host = api_base.trim().trim_end_matches('/').strip_prefix("https://")?;
    let rest = host.strip_suffix(".workers.dev")?;
    let (script, sub) = rest.split_once('.')?;
    (!script.is_empty() && !sub.is_empty() && !sub.contains('.')).then(|| (script.to_string(), sub.to_string()))
}

/// 從帳號名稱（通常是「email's Account」）推測一個子網域名稱；推不出來時用 deskdo-xxxx
fn suggest_subdomain(account_name: &str) -> String {
    let name = account_name.trim().trim_end_matches("'s Account");
    let base = name.split('@').next().unwrap_or("").to_lowercase();
    let mut s = String::new();
    for c in base.chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if !s.ends_with('-') {
            s.push('-');
        }
    }
    let s: String = s.trim_matches('-').chars().take(30).collect();
    let s = s.trim_end_matches('-').to_string();
    if s.len() < 3 { format!("deskdo-{}", &new_id()[..4]) } else { s }
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("無法取得隨機數");
    b
}

/// 32 bytes 的 URL-safe base64（和 Worker 端 newSecret 相同格式）
fn new_secret() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

fn new_id() -> String {
    const ALPHABET: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";
    random_bytes::<8>().iter().map(|b| ALPHABET[(*b % 32) as usize] as char).collect()
}

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn system_timezone() -> String {
    iana_time_zone::get_timezone().unwrap_or_else(|_| "Asia/Taipei".into())
}

fn binding<'a>(settings: &'a Value, kind: &str, name: &str) -> Option<&'a Value> {
    settings.get("bindings")?.as_array()?.iter().find(|b| b["type"] == kind && b["name"] == name)
}

// ---- 進度回報 ----

#[derive(Clone, Serialize)]
struct Progress {
    step: &'static str,
    /// "running" | "done" | "skip" | "error"
    state: &'static str,
    detail: String,
}

fn progress(app: &AppHandle, step: &'static str, state: &'static str, detail: impl Into<String>) {
    let _ = app.emit("setup-progress", Progress { step, state, detail: detail.into() });
}

/// 執行一個步驟；失敗時回報錯誤並中止
async fn step<T, F>(app: &AppHandle, id: &'static str, fut: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    progress(app, id, "running", "");
    let r = fut.await;
    if let Err(e) = &r {
        progress(app, id, "error", e.clone());
    }
    r
}

fn cf_err(e: CfError) -> String {
    e.to_string()
}

// ---- 指令 ----

/// 用使用者貼上的 API token 連接；回傳可以選擇的帳號
#[tauri::command]
pub async fn setup_token(app: AppHandle, token: String) -> Result<Vec<Account>, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("請貼上 API token".into());
    }
    connect(&app, token).await
}

pub async fn connect(app: &AppHandle, token: String) -> Result<Vec<Account>, String> {
    let accounts = Cf::new(shared(app).client.clone(), token.clone()).accounts().await.map_err(|e| {
        if e.status == 401 || e.status == 403 {
            "無法使用這個憑證，請確認權限包含 Account Settings: Read、Workers Scripts: Edit、D1: Edit".to_string()
        } else {
            e.to_string()
        }
    })?;
    if accounts.is_empty() {
        return Err("這個憑證看不到任何 Cloudflare 帳號".into());
    }
    *app.state::<SetupState>().token.lock().await = Some(token);
    Ok(accounts)
}

#[tauri::command]
pub async fn setup_cancel(app: AppHandle) {
    let st = app.state::<SetupState>();
    st.cancel.notify_waiters();
    st.clear().await;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    /// 帳號已經註冊的 workers.dev 子網域；None 表示要請使用者取一個
    subdomain: Option<String>,
    suggested_subdomain: String,
    /// 這個帳號已經有 Deskdo 雲端（另一台電腦設定過）
    existing: bool,
    /// "new" | "update"
    mode: &'static str,
    script: String,
}

/// 選好帳號後，先看看帳號裡有什麼，讓精靈決定要問使用者哪些事
#[tauri::command]
pub async fn setup_inspect(app: AppHandle, account: Account) -> Result<Inspection, String> {
    let cf = cf(&app).await?;
    let target = Target::from_config(&shared(&app).config())?;
    let subdomain = cf.workers_subdomain(&account.id).await.map_err(cf_err)?;
    let existing = cf.script_settings(&account.id, target.script()).await.map_err(cf_err)?.is_some();
    Ok(Inspection {
        subdomain,
        suggested_subdomain: suggest_subdomain(&account.name),
        existing,
        mode: if matches!(target, Target::Update { .. }) { "update" } else { "new" },
        script: target.script().to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupDone {
    api_base: String,
    /// 新網址可能要等 DNS 生效；false 時 App 會在背景持續重試
    reachable: bool,
    /// claude.ai 連接器網址（更新模式不回傳）
    connector_url: Option<String>,
}

#[tauri::command]
pub async fn setup_run(app: AppHandle, account_id: String, subdomain: Option<String>) -> Result<SetupDone, String> {
    let cf = cf(&app).await?;
    let r = provision(&app, &cf, &account_id, subdomain).await;
    if r.is_ok() {
        app.state::<SetupState>().clear().await;
    }
    r
}

async fn provision(app: &AppHandle, cf: &Cf, account: &str, wanted_sub: Option<String>) -> Result<SetupDone, String> {
    let s = shared(app);
    let cfg = s.config();
    let target = Target::from_config(&cfg)?;
    let script = target.script().to_string();

    // 1. workers.dev 子網域
    let sub = step(app, "subdomain", async {
        let sub = match cf.workers_subdomain(account).await.map_err(cf_err)? {
            Some(sub) => sub,
            None => {
                let name = wanted_sub.as_deref().map(str::trim).filter(|n| !n.is_empty()).ok_or("請輸入 workers.dev 子網域名稱")?;
                cf.create_workers_subdomain(account, name).await.map_err(|e| {
                    if e.status == 409 || e.message.to_lowercase().contains("taken") {
                        format!("「{name}」已經被別人使用，請換一個名稱")
                    } else {
                        e.to_string()
                    }
                })?
            }
        };
        if let Target::Update { subdomain, .. } = &target {
            if *subdomain != sub {
                return Err("登入的 Cloudflare 帳號和目前連線的雲端不是同一個".into());
            }
        }
        progress(app, "subdomain", "done", format!("{sub}.workers.dev"));
        Ok(sub)
    })
    .await?;
    let api_base = format!("https://{script}.{sub}.workers.dev");

    // 2. D1 資料庫（更新模式從現有的 binding 取得）
    let existing = cf.script_settings(account, &script).await.map_err(cf_err)?;
    let db = step(app, "database", async {
        let db = match (&target, &existing) {
            (Target::Update { .. }, Some(set)) => binding(set, "d1", "DB")
                .and_then(|b| b["id"].as_str().or(b["database_id"].as_str()))
                .map(String::from)
                .ok_or("找不到 Worker 的 D1 資料庫設定")?,
            (Target::Update { .. }, None) => return Err(format!("這個 Cloudflare 帳號裡找不到 {script}")),
            (Target::New { .. }, _) => match cf.find_d1(account, &script).await.map_err(cf_err)? {
                Some(id) => id,
                None => cf.create_d1(account, &script).await.map_err(cf_err)?,
            },
        };
        progress(app, "database", "done", "");
        Ok(db)
    })
    .await?;

    // 3. 建立／更新資料表
    step(app, "migrate", async {
        let n = migrate(cf, account, &db).await.map_err(cf_err)?;
        progress(app, "migrate", "done", if n == 0 { "已是最新".to_string() } else { format!("套用 {n} 個更新") });
        Ok(())
    })
    .await?;

    // 4. 這台電腦的 token（更新模式沿用目前的 token）
    let token = match &target {
        Target::Update { .. } => {
            progress(app, "device", "skip", "");
            cfg.api_token.clone()
        }
        Target::New { .. } => {
            step(app, "device", async {
                let st = app.state::<SetupState>();
                let mut registered = st.device.lock().await;
                let token = match registered.as_ref() {
                    Some((d, t)) if *d == db => t.clone(),
                    _ => {
                        let t = add_device(cf, account, &db).await.map_err(cf_err)?;
                        *registered = Some((db.clone(), t.clone()));
                        t
                    }
                };
                progress(app, "device", "done", device_name());
                Ok(token)
            })
            .await?
        }
    };
    let conn = Config { api_base: api_base.clone(), api_token: token.clone(), ..Config::default() };

    // 5. 上傳 Worker（雲端已經是同版或更新的版本就跳過，避免舊版 App 把雲端降級）
    step(app, "upload", async {
        let deployed = if existing.is_some() { cloud_version(&s.client, &conn).await } else { None };
        if deployed.is_some_and(|v| v >= WORKER_VERSION) {
            progress(app, "upload", "done", "已是最新版本");
            return Ok(());
        }
        let tz = existing
            .as_ref()
            .and_then(|set| binding(set, "plain_text", "TIMEZONE"))
            .and_then(|b| b["text"].as_str())
            .map(String::from)
            .unwrap_or_else(system_timezone);
        let metadata = json!({
            "main_module": "index.js",
            "compatibility_date": embedded::COMPATIBILITY_DATE,
            "compatibility_flags": embedded::COMPATIBILITY_FLAGS,
            "bindings": [
                { "type": "d1", "name": "DB", "id": db },
                { "type": "plain_text", "name": "TIMEZONE", "text": tz },
            ],
            "keep_bindings": ["secret_text"],
        });
        cf.upload_script(account, &script, embedded::WORKER_JS, metadata).await.map_err(cf_err)?;
        progress(app, "upload", "done", format!("版本 {WORKER_VERSION}"));
        Ok(())
    })
    .await?;

    // 6. 開啟 workers.dev 網址
    step(app, "route", async {
        cf.enable_workers_dev(account, &script).await.map_err(cf_err)?;
        progress(app, "route", "done", api_base.clone());
        Ok(())
    })
    .await?;

    if let Target::New { .. } = target {
        let mut c = s.config.lock().unwrap();
        c.api_base = api_base.clone();
        c.api_token = token.clone();
        c.save();
    }
    windows::emit_prefs(app);

    // 7. 等新網址生效（新註冊的子網域 DNS 可能要一兩分鐘）
    progress(app, "verify", "running", "");
    let deadline = Instant::now() + Duration::from_secs(150);
    let mut version = None;
    while Instant::now() < deadline {
        version = cloud_version(&s.client, &conn).await;
        // 剛上傳的新版本可能要幾秒才會在各地生效
        if version.is_some_and(|v| v >= WORKER_VERSION) {
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    let version = version.filter(|v| *v >= WORKER_VERSION);
    let reachable = version.is_some();
    if reachable {
        s.cloud_version.store(version.unwrap_or(0), Ordering::Relaxed);
        progress(app, "verify", "done", "");
    } else {
        progress(app, "verify", "skip", "網址還在生效中，Deskdo 會在背景自動重試");
    }
    windows::emit_prefs(app);
    s.wake(true);

    // 先問 Worker（env 有 MCP_SECRET 的舊部署要用那一把），問不到就直接從 D1 讀
    let connector_url = match target {
        Target::Update { .. } => None,
        Target::New { .. } => {
            let fetched = if reachable { fetch_connector(&s.client, &conn).await.ok().map(|c| c.0) } else { None };
            match fetched {
                Some(url) => Some(url),
                None => stored_mcp_secret(cf, account, &db).await.ok().flatten().map(|sec| format!("{api_base}/mcp/{sec}")),
            }
        }
    };
    Ok(SetupDone { api_base, reachable, connector_url })
}

/// 套用還沒套用的 migration，回傳套用了幾個。紀錄表和 wrangler 的 d1_migrations 相容
async fn migrate(cf: &Cf, account: &str, db: &str) -> Result<usize, CfError> {
    let r = cf
        .d1_query(
            account,
            db,
            "CREATE TABLE IF NOT EXISTS d1_migrations(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
            ); SELECT name FROM d1_migrations",
            &[],
        )
        .await?;
    let applied: HashSet<String> = r
        .last()
        .map(|q| q.results.iter().filter_map(|row| row["name"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let mut n = 0;
    for (name, sql) in embedded::MIGRATIONS {
        if applied.contains(*name) {
            continue;
        }
        cf.d1_query(account, db, &migration_batch(name, sql), &[]).await?;
        n += 1;
    }
    Ok(n)
}

/// migration 的 SQL 加上「記錄已套用」的語句。
/// Windows 上 git 可能把 .sql 轉成 CRLF；結尾的 `;\r\n` 再接一個分號會變成只有 `\r` 的空語句，
/// D1 會回 7500「SQL code did not contain a statement」，所以先統一換行、去掉結尾的分號。
fn migration_batch(name: &str, sql: &str) -> String {
    let body = sql.replace("\r\n", "\n");
    let body = body.trim_end().trim_end_matches(';').trim_end();
    format!("{body};\nINSERT INTO d1_migrations (name) VALUES ('{}');", name.replace('\'', "''"))
}

fn device_name() -> String {
    #[cfg(target_os = "android")]
    {
        // 例如「Google Pixel 8」
        let prop = |k: &str| {
            std::process::Command::new("getprop")
                .arg(k)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let model = prop("ro.product.model");
        let maker = prop("ro.product.manufacturer").map(|m| {
            let mut c = m.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        });
        return match (maker, model) {
            (Some(m), Some(d)) if d.to_lowercase().starts_with(&m.to_lowercase()) => d,
            (Some(m), Some(d)) => format!("{m} {d}"),
            (_, Some(d)) => d,
            _ => "Android 手機".into(),
        };
    }
    #[allow(unreachable_code)]
    std::env::var("COMPUTERNAME").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "Windows 電腦".into())
}

/// 在 D1 新增這台電腦，回傳它的 token；同時確保有 MCP 密鑰
async fn add_device(cf: &Cf, account: &str, db: &str) -> Result<String, CfError> {
    let token = new_secret();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    cf.d1_query(
        account,
        db,
        "INSERT INTO devices (id, name, tokenHash, createdAt) VALUES (?, ?, ?, ?)",
        &[json!(new_id()), json!(device_name()), json!(sha256_hex(&token)), json!(now)],
    )
    .await?;
    cf.d1_query(account, db, "INSERT OR IGNORE INTO settings (key, value) VALUES ('mcp_secret', ?)", &[json!(new_secret())])
        .await?;
    Ok(token)
}

async fn stored_mcp_secret(cf: &Cf, account: &str, db: &str) -> Result<Option<String>, CfError> {
    let r = cf.d1_query(account, db, "SELECT value FROM settings WHERE key = 'mcp_secret'", &[]).await?;
    Ok(r.first().and_then(|q| q.results.first()).and_then(|row| row["value"].as_str()).map(String::from))
}

// ---- 雲端版本 ----

/// 雲端 Worker 的版本；沒有 /api/info（第一版）時回傳 1，連不上時回傳 None
pub async fn cloud_version(client: &reqwest::Client, cfg: &Config) -> Option<u32> {
    let r = api::send(client, cfg, Method::GET, "/api/info", None, None).await;
    match r.status {
        200 => r.data.and_then(|d| d["version"].as_u64()).map(|v| v as u32),
        // 第一版 Worker 對未知路徑回 JSON 的 404。新網址剛開通時 Cloudflare 會先回自己的 HTML 404，
        // 那表示 Worker 還沒生效，不能當成第一版
        404 if r.data.as_ref().is_some_and(|d| d.get("error").is_some()) => Some(1),
        _ => None,
    }
}

/// 定期檢查雲端版本（由同步迴圈呼叫）；有變化時通知前端
pub async fn check_cloud_version(app: &AppHandle) {
    let s = shared(app);
    let cfg = s.config();
    if !cfg.configured() {
        return;
    }
    if let Some(v) = cloud_version(&s.client, &cfg).await {
        if s.cloud_version.swap(v, Ordering::Relaxed) != v {
            windows::emit_prefs(app);
        }
    }
}

// ---- 連接器與裝置（設定頁用，透過 Worker 的 REST API） ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connector {
    url: String,
    rotatable: bool,
}

async fn fetch_connector(client: &reqwest::Client, cfg: &Config) -> Result<(String, bool), String> {
    let r = api::send(client, cfg, Method::GET, "/api/connector", None, None).await;
    connector_from(r)
}

fn connector_from(r: api::ApiResult) -> Result<(String, bool), String> {
    if let Some(e) = r.error {
        return Err(if r.status == 404 { "雲端版本太舊，請先更新雲端".into() } else { e });
    }
    let d = r.data.unwrap_or_default();
    let url = d["url"].as_str().ok_or("伺服器回應格式錯誤")?.to_string();
    Ok((url, d["rotatable"].as_bool().unwrap_or(false)))
}

#[tauri::command]
pub async fn get_connector(app: AppHandle) -> Result<Connector, String> {
    let s = shared(&app);
    let (url, rotatable) = fetch_connector(&s.client, &s.config()).await?;
    Ok(Connector { url, rotatable })
}

#[tauri::command]
pub async fn rotate_connector(app: AppHandle) -> Result<Connector, String> {
    let s = shared(&app);
    let r = api::send(&s.client, &s.config(), Method::POST, "/api/connector/rotate", None, None).await;
    let (url, rotatable) = connector_from(r)?;
    Ok(Connector { url, rotatable })
}

#[tauri::command]
pub async fn list_devices(app: AppHandle) -> Result<Value, String> {
    let s = shared(&app);
    let r = api::send(&s.client, &s.config(), Method::GET, "/api/devices", None, None).await;
    if let Some(e) = r.error {
        return Err(if r.status == 404 { "雲端版本太舊，請先更新雲端".into() } else { e });
    }
    Ok(r.data.and_then(|mut d| d.get_mut("devices").map(Value::take)).unwrap_or(json!([])))
}

#[tauri::command]
pub async fn revoke_device(app: AppHandle, id: String) -> Result<(), String> {
    let s = shared(&app);
    let path = format!("/api/devices/{id}");
    let r = api::send(&s.client, &s.config(), Method::DELETE, &path, None, None).await;
    match r.error {
        Some(e) if r.status != 404 => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_workers_dev_url() {
        assert_eq!(
            parse_workers_dev("https://todo-worker.ziyu2005-teh.workers.dev/"),
            Some(("todo-worker".into(), "ziyu2005-teh".into()))
        );
        assert_eq!(parse_workers_dev("https://todo.example.com"), None);
        assert_eq!(parse_workers_dev("http://a.b.workers.dev"), None);
        assert_eq!(parse_workers_dev("https://a.b.c.workers.dev"), None);
    }

    #[test]
    fn suggests_subdomain_from_account_name() {
        assert_eq!(suggest_subdomain("Ziyu2005.teh@gmail.com's Account"), "ziyu2005-teh");
        assert_eq!(suggest_subdomain("Team Alpha"), "team-alpha");
        assert!(suggest_subdomain("王小明's Account").starts_with("deskdo-"));
    }

    #[test]
    fn migrations_are_sorted_and_named_like_wrangler() {
        let names: Vec<_> = embedded::MIGRATIONS.iter().map(|(n, _)| *n).collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
        assert_eq!(names[0], "0001_init.sql");
    }

    #[test]
    fn migration_batch_has_no_empty_statements() {
        let expected = "CREATE TABLE t (a);\nINSERT INTO d1_migrations (name) VALUES ('0003_x.sql');";
        for sql in ["CREATE TABLE t (a);\r\n", "CREATE TABLE t (a);\n\n", "CREATE TABLE t (a)", "CREATE TABLE t (a);;\r\n"] {
            assert_eq!(migration_batch("0003_x.sql", sql), expected);
        }
        assert!(migration_batch("it's.sql", "SELECT 1").ends_with("VALUES ('it''s.sql');"));
        for (name, sql) in embedded::MIGRATIONS {
            let batch = migration_batch(name, sql);
            assert!(!batch.contains('\r') && !batch.contains(";\n;"), "{name}");
        }
    }

    #[test]
    fn secrets_are_url_safe() {
        let s = new_secret();
        assert_eq!(s.len(), 43);
        assert!(s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(sha256_hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
