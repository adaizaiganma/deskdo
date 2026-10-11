//! Worker 的 REST API 客戶端。

use crate::config::Config;
use reqwest::{header, Client, Method};
use serde_json::Value;
use std::time::Duration;

pub struct ApiResult {
    /// 0 表示沒有連上伺服器
    pub status: u16,
    pub data: Option<Value>,
    /// None 表示成功（2xx 或 304）
    pub error: Option<String>,
    pub etag: Option<String>,
}

impl ApiResult {
    pub fn offline(&self) -> bool {
        self.status == 0
    }
}

pub async fn send(
    client: &Client,
    cfg: &Config,
    method: Method,
    path: &str,
    body: Option<&Value>,
    etag: Option<&str>,
) -> ApiResult {
    let url = format!("{}{}", cfg.api_base.trim().trim_end_matches('/'), path);
    let mut req = client
        .request(method, url)
        .bearer_auth(cfg.api_token.trim())
        .header(header::USER_AGENT, concat!("Deskdo/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15));
    if let Some(b) = body {
        req = req.header(header::CONTENT_TYPE, "application/json").body(b.to_string());
    }
    if let Some(e) = etag {
        req = req.header(header::IF_NONE_MATCH, e);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_builder() {
                "API 網址格式不正確"
            } else if e.is_timeout() {
                "連線逾時"
            } else {
                "無法連線到伺服器"
            };
            return ApiResult { status: 0, data: None, error: Some(msg.into()), etag: None };
        }
    };

    let status = resp.status().as_u16();
    let etag = resp.headers().get(header::ETAG).and_then(|v| v.to_str().ok()).map(String::from);
    let data: Option<Value> = resp.bytes().await.ok().and_then(|b| serde_json::from_slice(&b).ok());

    let error = if status == 401 {
        Some("驗證失敗，請檢查 API token".to_string())
    } else if status >= 400 {
        let msg = data.as_ref().and_then(|d| d.get("error")).and_then(Value::as_str);
        let issues: Vec<&str> = data
            .as_ref()
            .and_then(|d| d.get("issues"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let mut s = format!("HTTP {status}");
        if let Some(m) = msg {
            s += &format!("：{m}");
        }
        if !issues.is_empty() {
            s += &format!("（{}）", issues.join("；"));
        }
        Some(s)
    } else {
        None
    };
    ApiResult { status, data, error, etag }
}
