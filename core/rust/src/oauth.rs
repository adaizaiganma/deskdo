//! 「使用 Cloudflare 登入」：OAuth 2.0 Authorization Code + PKCE（公開用戶端，沒有 client secret）。
//!
//! 開瀏覽器到 Cloudflare 的授權頁，使用者同意後 Cloudflare 會把瀏覽器導回
//! http://localhost:<REDIRECT_PORT>/callback，這裡用一個只接一次連線的小 HTTP 伺服器接收授權碼，
//! 再換成 access token。token 只交給設定精靈使用，不寫入磁碟。

use crate::{
    cloudflare::Account,
    setup::{self, SetupState},
};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const AUTHORIZE_URL: &str = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL: &str = "https://dash.cloudflare.com/oauth2/token";
/// 要和 Cloudflare OAuth client 設定的 redirect URI 完全一致
const REDIRECT_PORT: u16 = 47613;
/// 讀帳號、建立與更新 Worker（Workers Editor 只能改既有的 Worker，建立新的要 Admin）、建立與查詢 D1
const SCOPES: &str = "account-settings.read workers-scripts.admin d1.write";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// 換 token 時連不上網路，最多重試多久（見 exchange）
const EXCHANGE_RETRY: Duration = Duration::from_secs(3 * 60);
/// 手機上授權完成頁的「回到 Deskdo」（AndroidManifest.xml 裡 MainActivity 的 deskdo:// 連結）
#[cfg(mobile)]
const RETURN_URL: &str = "deskdo://setup";

fn redirect_uri() -> String {
    format!("http://localhost:{REDIRECT_PORT}/callback")
}

/// 開發版可以用 DESKDO_DEV_CF_TOKEN 直接提供 Cloudflare token，跳過瀏覽器登入（測試精靈用）
fn dev_token() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("DESKDO_DEV_CF_TOKEN").ok().filter(|s| !s.trim().is_empty())
    } else {
        None
    }
}

/// 精靈要不要顯示「使用 Cloudflare 登入」
pub fn available() -> bool {
    client_id().is_some() || dev_token().is_some()
}

/// 建置時用 DESKDO_CF_CLIENT_ID 指定；執行時的同名環境變數可以覆寫（開發用）
pub fn client_id() -> Option<String> {
    std::env::var("DESKDO_CF_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("DESKDO_CF_CLIENT_ID").map(String::from))
        .filter(|s| !s.trim().is_empty())
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_b64(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).expect("無法取得隨機數");
    b64(&b)
}

fn pkce_challenge(verifier: &str) -> String {
    b64(&Sha256::digest(verifier.as_bytes()))
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 從請求行 "GET /callback?code=…&state=… HTTP/1.1" 取出查詢參數
fn query_param(request_line: &str, key: &str) -> Option<String> {
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?')?;
    if path != "/callback" {
        return None;
    }
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| decode(v))
    })
}

#[tauri::command]
pub async fn setup_oauth(app: AppHandle) -> Result<Vec<Account>, String> {
    if let Some(token) = dev_token() {
        return setup::connect(&app, token).await;
    }
    let client_id = client_id().ok_or("這個版本沒有設定 Cloudflare 登入，請改用 API token")?;
    let verifier = random_b64(48);
    let state = random_b64(16);

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .await
        .map_err(|_| format!("無法使用連接埠 {REDIRECT_PORT}（可能被其他程式占用），請改用 API token"))?;
    // 有些瀏覽器會先用 IPv6 連 localhost
    let listener6 = TcpListener::bind(("::1", REDIRECT_PORT)).await.ok();

    let url = format!(
        "{AUTHORIZE_URL}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        encode(&client_id),
        encode(&redirect_uri()),
        encode(SCOPES),
        encode(&state),
        pkce_challenge(&verifier),
    );
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("無法開啟瀏覽器：{e}"))?;

    // 瀏覽器可能先開預先連線或要 /favicon.ico，所以一直接到真正的 /callback 為止
    let st = app.state::<SetupState>();
    let deadline = tokio::time::Instant::now() + LOGIN_TIMEOUT;
    let (mut stream, line) = loop {
        let accept6 = async {
            match &listener6 {
                Some(l) => l.accept().await,
                None => std::future::pending().await,
            }
        };
        let (mut stream, _) = tokio::select! {
            r = listener.accept() => r.map_err(|e| e.to_string())?,
            r = accept6 => r.map_err(|e| e.to_string())?,
            _ = st.cancel.notified() => return Err("已取消登入".into()),
            _ = tokio::time::sleep_until(deadline) => return Err("登入逾時，請再試一次".into()),
        };
        let line = read_request_line(&mut stream).await;
        if line.split_whitespace().nth(1).is_some_and(|t| t.starts_with("/callback?")) {
            break (stream, line);
        }
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
    };
    drop(listener);
    drop(listener6);

    let result = match (query_param(&line, "code"), query_param(&line, "state"), query_param(&line, "error")) {
        (_, _, Some(err)) => Err(if err == "access_denied" { "你取消了授權".to_string() } else { format!("Cloudflare 登入失敗：{err}") }),
        (Some(code), Some(s), _) if s == state => Ok(code),
        (Some(_), _, _) => Err("登入驗證失敗（state 不符），請再試一次".to_string()),
        _ => Err("沒有收到授權碼，請再試一次".to_string()),
    };
    respond(&mut stream, result.is_ok()).await;
    crate::show_main(&app);

    let code = result?;
    let token = exchange_retrying(&app, &client_id, &code, &verifier).await?;
    setup::connect(&app, token).await
}

/// 連不上 Cloudflare 時一直重試：Android 會切斷背景 App 的網路，
/// 使用者還在瀏覽器裡時換 token 一定失敗，要等 Deskdo 回到前景
async fn exchange_retrying(app: &AppHandle, client_id: &str, code: &str, verifier: &str) -> Result<String, String> {
    let st = app.state::<SetupState>();
    let deadline = tokio::time::Instant::now() + EXCHANGE_RETRY;
    loop {
        match exchange(app, client_id, code, verifier).await {
            Err(Exchange::Offline) if tokio::time::Instant::now() < deadline => {}
            Err(Exchange::Offline) => return Err("無法連線到 Cloudflare".into()),
            Err(Exchange::Failed(e)) => return Err(e),
            Ok(token) => return Ok(token),
        }
        tokio::select! {
            _ = st.cancel.notified() => return Err("已取消登入".into()),
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
    }
}

enum Exchange {
    /// 請求沒送出去（沒有網路、被系統擋住）
    Offline,
    Failed(String),
}

async fn read_request_line(stream: &mut TcpStream) -> String {
    let mut buf = vec![0u8; 8192];
    let mut len = 0;
    // 只需要第一行；讀到換行或逾時就停
    let _ = tokio::time::timeout(Duration::from_secs(5), async {
        while len < buf.len() {
            match stream.read(&mut buf[len..]).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    len += n;
                    if buf[..len].contains(&b'\n') {
                        break;
                    }
                }
            }
        }
    })
    .await;
    String::from_utf8_lossy(&buf[..len]).lines().next().unwrap_or("").to_string()
}

async fn respond(stream: &mut TcpStream, ok: bool) {
    let (title, body) = if ok {
        ("已連接 Cloudflare", if cfg!(mobile) { "已完成登入，回到 Deskdo 繼續設定。" } else { "已完成登入，可以關閉這個分頁，回到 Deskdo 繼續設定。" })
    } else {
        ("登入沒有完成", "請回到 Deskdo 再試一次。")
    };
    // 手機上 App 要回到前景才能連網（見 exchange），所以給一個直接回去的按鈕，也試著自動切回去
    #[cfg(mobile)]
    let back = format!(
        "<a class=\"btn\" href=\"{RETURN_URL}\">回到 Deskdo</a><script>location.href=\"{RETURN_URL}\"</script>"
    );
    #[cfg(desktop)]
    let back = "";
    let html = format!(
        "<!doctype html><html lang=\"zh-Hant\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">\
         <title>{title} · Deskdo</title>\
         <style>body{{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;\
         background:#f6f6f4;color:#222}}@media(prefers-color-scheme:dark){{body{{background:#1c1d22;color:#eee}}}}\
         main{{text-align:center;padding:24px}}h1{{font-size:22px;margin:0 0 8px}}p{{opacity:.75}}\
         .btn{{display:inline-block;margin-top:12px;padding:12px 28px;border-radius:999px;background:#2563eb;color:#fff;\
         text-decoration:none;font-weight:600}}</style>\
         <main><h1>{title}</h1><p>{body}</p>{back}</main></html>"
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn exchange(app: &AppHandle, client_id: &str, code: &str, verifier: &str) -> Result<String, Exchange> {
    let client = crate::store::shared(app).client.clone();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri()),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| Exchange::Offline)?;
    let status = resp.status();
    let data: serde_json::Value = resp.json().await.unwrap_or_default();
    match data["access_token"].as_str() {
        Some(t) if status.is_success() => Ok(t.to_string()),
        _ => Err(Exchange::Failed(format!(
            "Cloudflare 登入失敗：{}",
            data["error_description"].as_str().or(data["error"].as_str()).unwrap_or(status.as_str())
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 附錄 B
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn reads_callback_query() {
        let line = "GET /callback?code=ab%2Fc+d&state=xyz HTTP/1.1";
        assert_eq!(query_param(line, "code").as_deref(), Some("ab/c d"));
        assert_eq!(query_param(line, "state").as_deref(), Some("xyz"));
        assert_eq!(query_param(line, "error"), None);
        assert_eq!(query_param("GET /favicon.ico HTTP/1.1", "code"), None);
        assert_eq!(query_param("GET /other?code=1 HTTP/1.1", "code"), None);
    }
}
