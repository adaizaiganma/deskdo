//! App 自動更新：從 GitHub Releases 的 latest.json 檢查新版，背景下載好，使用者按一下就安裝並重新啟動。
//!
//! 更新檔用作者的私鑰簽章（tauri.conf.json 的 plugins.updater.pubkey 驗證），簽章不符就不會安裝。
//! 只有正式版會自動檢查：開發版和測試版（Deskdo Beta）另外建置、手動安裝。

use crate::{config, store, tray::TrayItems};
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// 啟動後等一下再檢查，避免和第一次同步搶網路
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
    /// GitHub Release 的說明文字
    notes: Option<String>,
}

/// 已經下載好、等使用者按「更新」的新版
#[derive(Default)]
pub struct UpdateState {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// 避免手動檢查和定期檢查同時下載
    checking: Mutex<()>,
}

fn enabled() -> bool {
    !cfg!(debug_assertions) && !config::BETA
}

fn info(u: &Update) -> UpdateInfo {
    UpdateInfo { version: u.version.clone(), notes: u.body.clone().filter(|s| !s.trim().is_empty()) }
}

pub fn start(app: AppHandle) {
    if !enabled() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            // 網路斷線等暫時性錯誤就等下一輪
            let _ = check(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// 檢查並下載新版；回傳已下載好的新版（沒有新版時為 None）
async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let st = app.state::<UpdateState>();
    let _guard = st.checking.lock().await;
    if let Some((u, _)) = st.ready.lock().await.as_ref() {
        return Ok(Some(info(u)));
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| format!("無法檢查更新：{e}"))? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| format!("下載更新失敗：{e}"))?;
    let found = info(&update);
    *st.ready.lock().await = Some((update, bytes));

    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.update.set_text(format!("重新啟動以更新到 {}", found.version));
    }
    let _ = app.emit("update", &found);
    Ok(Some(found))
}

#[tauri::command]
pub async fn get_update(app: AppHandle) -> Option<UpdateInfo> {
    app.state::<UpdateState>().ready.lock().await.as_ref().map(|(u, _)| info(u))
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    if !enabled() {
        return Err("開發版和測試版不會自動更新".into());
    }
    check(&app).await
}

/// 安裝已下載的新版。Windows 上安裝程式會結束 Deskdo，裝完再自動開啟
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let ready = app.state::<UpdateState>().ready.lock().await.take();
    let Some((update, bytes)) = ready else {
        return Err("沒有可安裝的更新".into());
    };
    // 和「結束」一樣，先把還在等待復原期限的刪除送出去
    store::flush_deletes(&app).await;
    update.install(bytes).map_err(|e| format!("安裝更新失敗：{e}"))
}

/// 系統匣選單的「檢查更新」：已經下載好就直接安裝，否則立即檢查
pub fn tray_clicked(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if get_update(app.clone()).await.is_some() {
            let _ = install_update(app).await;
            return;
        }
        let items = app.try_state::<TrayItems>();
        if let Some(i) = &items {
            let _ = i.update.set_text("正在檢查更新…");
        }
        let text = match check_update(app.clone()).await {
            Ok(Some(u)) => format!("重新啟動以更新到 {}", u.version),
            Ok(None) => "已是最新版本".to_string(),
            Err(e) => e,
        };
        if let Some(i) = &items {
            let _ = i.update.set_text(text);
        }
    });
}
