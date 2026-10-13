//! Cloudflare REST API 客戶端：設定精靈用它在使用者自己的帳號建立 D1、上傳 Worker。
//! 憑證（OAuth access token 或使用者貼上的 API token）只放在記憶體裡。

use reqwest::{multipart, Client, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const API: &str = "https://api.cloudflare.com/client/v4";

pub struct Cf {
    client: Client,
    token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct Envelope {
    success: bool,
    #[serde(default)]
    errors: Vec<ApiError>,
    #[serde(default)]
    result: Value,
}

#[derive(Deserialize)]
struct ApiError {
    /// 權限錯誤之類的回應有時不附錯誤碼
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
}

/// API 回傳的錯誤；`code` 是 Cloudflare 的錯誤碼（沒有時為 0）
#[derive(Debug)]
pub struct CfError {
    pub status: u16,
    pub code: i64,
    pub message: String,
}

impl CfError {
    pub fn not_found(&self) -> bool {
        self.status == StatusCode::NOT_FOUND.as_u16()
    }
}

impl std::fmt::Display for CfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.status {
            0 => f.write_str(crate::i18n::tr("無法連線到 Cloudflare", "Can't reach Cloudflare")),
            401 | 403 => f.write_str(&crate::trf!("Cloudflare 權限不足：{}", "Cloudflare permission denied: {}", self.message)),
            _ if self.code == 0 => f.write_str(&crate::trf!("Cloudflare：{}", "Cloudflare: {}", self.message)),
            _ => f.write_str(&crate::trf!("Cloudflare：{}（{}）", "Cloudflare: {} ({})", self.message, self.code)),
        }
    }
}

impl From<CfError> for String {
    fn from(e: CfError) -> Self {
        e.to_string()
    }
}

type CfResult<T> = Result<T, CfError>;

fn transport(e: reqwest::Error) -> CfError {
    CfError { status: 0, code: 0, message: e.to_string() }
}

/// D1 /query 回傳的單一語句結果
#[derive(Deserialize)]
pub struct QueryResult {
    #[serde(default)]
    pub results: Vec<Value>,
}

impl Cf {
    pub fn new(client: Client, token: String) -> Self {
        Self { client, token }
    }

    async fn send<T: DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> CfResult<T> {
        let resp = req
            .bearer_auth(&self.token)
            .header(reqwest::header::USER_AGENT, concat!("Deskdo/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(transport)?;
        let status = resp.status().as_u16();
        let bytes = resp.bytes().await.map_err(transport)?;
        // 回應不是 JSON 時（例如閘道直接擋下），附上內容開頭方便判斷原因
        let unreadable = || {
            let text = String::from_utf8_lossy(&bytes);
            let snippet: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
            CfError { status, code: 0, message: format!("HTTP {status}：{snippet}") }
        };
        let env: Envelope = serde_json::from_slice(&bytes).map_err(|_| unreadable())?;
        if env.success {
            return serde_json::from_value(env.result).map_err(|_| unreadable());
        }
        let e = env.errors.into_iter().next();
        Err(CfError {
            status,
            code: e.as_ref().map_or(0, |e| e.code),
            message: e.map_or_else(|| format!("HTTP {status}"), |e| e.message),
        })
    }

    async fn call<T: DeserializeOwned>(&self, method: Method, path: &str, body: Option<Value>) -> CfResult<T> {
        let mut req = self.client.request(method, format!("{API}{path}"));
        if let Some(b) = body {
            req = req.json(&b);
        }
        self.send(req).await
    }

    pub async fn accounts(&self) -> CfResult<Vec<Account>> {
        self.call(Method::GET, "/accounts?per_page=50", None).await
    }

    /// 帳號的 workers.dev 子網域；還沒註冊時回傳 None
    pub async fn workers_subdomain(&self, account: &str) -> CfResult<Option<String>> {
        #[derive(Deserialize)]
        struct R {
            subdomain: Option<String>,
        }
        match self.call::<R>(Method::GET, &format!("/accounts/{account}/workers/subdomain"), None).await {
            Ok(r) => Ok(r.subdomain.filter(|s| !s.is_empty())),
            Err(e) if e.not_found() => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn create_workers_subdomain(&self, account: &str, name: &str) -> CfResult<String> {
        #[derive(Deserialize)]
        struct R {
            subdomain: String,
        }
        let path = format!("/accounts/{account}/workers/subdomain");
        let r: R = self.call(Method::PUT, &path, Some(json!({ "subdomain": name }))).await?;
        Ok(r.subdomain)
    }

    pub async fn find_d1(&self, account: &str, name: &str) -> CfResult<Option<String>> {
        #[derive(Deserialize)]
        struct Db {
            uuid: String,
            name: String,
        }
        let path = format!("/accounts/{account}/d1/database?name={}", urlencode(name));
        let dbs: Vec<Db> = self.call(Method::GET, &path, None).await?;
        Ok(dbs.into_iter().find(|d| d.name == name).map(|d| d.uuid))
    }

    /// 不指定區域：Cloudflare 會放在離發出請求的位置最近的地方
    pub async fn create_d1(&self, account: &str, name: &str) -> CfResult<String> {
        #[derive(Deserialize)]
        struct Db {
            uuid: String,
        }
        let path = format!("/accounts/{account}/d1/database");
        let db: Db = self.call(Method::POST, &path, Some(json!({ "name": name }))).await?;
        Ok(db.uuid)
    }

    /// 執行 SQL；可以一次多個語句（以分號分隔），回傳每個語句的結果
    pub async fn d1_query(&self, account: &str, db: &str, sql: &str, params: &[Value]) -> CfResult<Vec<QueryResult>> {
        let path = format!("/accounts/{account}/d1/database/{db}/query");
        self.call(Method::POST, &path, Some(json!({ "sql": sql, "params": params }))).await
    }

    /// 已部署腳本的設定（bindings 等）；腳本不存在時回傳 None
    pub async fn script_settings(&self, account: &str, script: &str) -> CfResult<Option<Value>> {
        let path = format!("/accounts/{account}/workers/scripts/{script}/settings");
        match self.call::<Value>(Method::GET, &path, None).await {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.not_found() || e.code == 10007 => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 上傳 Worker。`keep_bindings` 保留既有的 secret（舊版 setup.ps1 設定的 API_TOKEN、MCP_SECRET）
    pub async fn upload_script(&self, account: &str, script: &str, js: &'static [u8], metadata: Value) -> CfResult<()> {
        let form = multipart::Form::new()
            .part(
                "metadata",
                multipart::Part::text(metadata.to_string()).mime_str("application/json").map_err(transport)?,
            )
            .part(
                "index.js",
                multipart::Part::bytes(js).file_name("index.js").mime_str("application/javascript+module").map_err(transport)?,
            );
        let req = self
            .client
            .put(format!("{API}/accounts/{account}/workers/scripts/{script}"))
            .multipart(form);
        self.send::<Value>(req).await.map(|_| ())
    }

    pub async fn enable_workers_dev(&self, account: &str, script: &str) -> CfResult<()> {
        let path = format!("/accounts/{account}/workers/scripts/{script}/subdomain");
        self.call::<Value>(Method::POST, &path, Some(json!({ "enabled": true, "previews_enabled": false })))
            .await
            .map(|_| ())
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
