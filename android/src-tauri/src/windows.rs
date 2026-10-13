//! 手機上只有一個全螢幕的主視窗（main），以及給前端讀寫的偏好設定。

use crate::{
    api, setup,
    store::{self, shared},
};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindowBuilder};

pub fn create_main(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("main.html".into())).build()?;
    Ok(())
}

/// 切到某一頁（例如從主畫面小工具或 Cloudflare 登入完成回來時）
pub fn show_main(app: &AppHandle, view: Option<&str>) {
    if let Some(v) = view {
        let _ = app.emit_to("main", "navigate", v);
    }
}

// ---- 偏好設定 ----

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    api_base: String,
    api_token: String,
    poll_seconds: u64,
    configured: bool,
    done_sync_days: u32,
    /// 雲端 Worker 的版本；null 表示還不知道
    cloud_version: Option<u32>,
    /// 這版 App 內建的 Worker 版本
    latest_cloud_version: u32,
    /// 這個版本有沒有設定「使用 Cloudflare 登入」（沒有時精靈只能貼 API token）
    oauth_available: bool,
    beta: bool,
    app_version: String,
    platform: &'static str,
}

fn prefs(app: &AppHandle) -> Prefs {
    let s = shared(app);
    let c = s.config();
    let cloud = s.cloud_version.load(Ordering::Relaxed);
    Prefs {
        configured: c.configured(),
        api_base: c.api_base,
        api_token: c.api_token,
        poll_seconds: c.poll_seconds,
        done_sync_days: store::DONE_SYNC_DAYS,
        cloud_version: (cloud > 0).then_some(cloud),
        latest_cloud_version: setup::WORKER_VERSION,
        oauth_available: crate::oauth::available(),
        beta: crate::config::BETA,
        app_version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
    }
}

pub fn emit_prefs(app: &AppHandle) {
    let _ = app.emit("prefs", prefs(app));
}

#[tauri::command]
pub fn get_prefs(app: AppHandle) -> Prefs {
    prefs(&app)
}

/// 儲存連線設定，然後測試連線；回傳伺服器上未完成的待辦數量
#[tauri::command]
pub async fn save_connection(
    app: AppHandle,
    api_base: String,
    api_token: String,
    poll_seconds: u64,
) -> Result<usize, String> {
    let s = shared(&app);
    let cfg = {
        let mut c = s.config.lock().unwrap();
        c.api_base = api_base.trim().to_string();
        c.api_token = api_token.trim().to_string();
        c.poll_seconds = poll_seconds.clamp(10, 600);
        c.save();
        c.clone()
    };
    s.cloud_version.store(0, Ordering::Relaxed);
    emit_prefs(&app);
    s.wake(true);
    if !cfg.configured() {
        return Err(deskdo_core::i18n::tr("請填寫 API 網址和 token", "Fill in the API URL and token").into());
    }
    let r = api::send(&s.client, &cfg, reqwest::Method::GET, "/api/todos?status=open", None, None).await;
    if let Some(e) = r.error {
        return Err(e);
    }
    Ok(r.data.as_ref().and_then(|d| d.get("todos")).and_then(|t| t.as_array()).map_or(0, Vec::len))
}

#[tauri::command]
pub fn open_main(app: AppHandle, view: Option<String>) {
    show_main(&app, view.as_deref());
}

/// 在主畫面小工具上點了哪一筆待辦（App 打開後展開它）；拿過就清掉
#[tauri::command]
pub async fn take_widget_todo(app: AppHandle) -> Option<String> {
    crate::mobile::take_open_todo(&app)
}
