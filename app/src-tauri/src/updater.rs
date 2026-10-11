//! App 自動更新：從 GitHub Releases 的 latest.json 檢查新版，背景下載好，使用者按一下就安裝並重新啟動。
//!
//! 更新檔用作者的私鑰簽章（tauri.conf.json 的 plugins.updater.pubkey 驗證），簽章不符就不會安裝。
//! 只有正式版會自動檢查：開發版和測試版（Deskdo Beta）另外建置、手動安裝。
//!
//! Android 沒有 Tauri 的自動更新：改成查 GitHub 最新 Release 有沒有比較新的 APK，
//! 使用者按「更新」時用瀏覽器下載，系統會接著問要不要安裝（簽章相同才能覆蓋安裝）。

use crate::config;
#[cfg(desktop)]
use crate::{store, tray::TrayItems};
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(desktop)]
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
#[cfg(desktop)]
#[derive(Default)]
pub struct UpdateState {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// 避免手動檢查和定期檢查同時下載
    checking: Mutex<()>,
}

fn enabled() -> bool {
    !cfg!(debug_assertions) && !config::BETA
}

#[cfg(desktop)]
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
#[cfg(desktop)]
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
    #[cfg(desktop)]
    return app.state::<UpdateState>().ready.lock().await.as_ref().map(|(u, _)| info(u));
    #[cfg(mobile)]
    return app.state::<UpdateState>().ready.lock().await.as_ref().map(|u| u.info.clone());
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    if !enabled() {
        return Err("開發版和測試版不會自動更新".into());
    }
    check(&app).await
}

/// 安裝已下載的新版。Windows 上安裝程式會結束 Deskdo，裝完再自動開啟
#[cfg(desktop)]
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
#[cfg(desktop)]
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

// ---- Android：查 GitHub Releases 的 APK ----

#[cfg(mobile)]
const LATEST_RELEASE: &str = "https://api.github.com/repos/adaizaiganma/deskdo/releases/latest";

#[cfg(mobile)]
struct MobileUpdate {
    info: UpdateInfo,
    url: String,
}

#[cfg(mobile)]
#[derive(Default)]
pub struct UpdateState {
    ready: Mutex<Option<MobileUpdate>>,
    checking: Mutex<()>,
}

/// "v0.5.1" → (0, 5, 1)；看不懂的版本號當成 0
#[cfg(any(mobile, test))]
fn version_tuple(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches('v').split(['.', '-', '+']).map(|p| p.parse().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

#[cfg(mobile)]
async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let st = app.state::<UpdateState>();
    let _guard = st.checking.lock().await;
    if let Some(u) = st.ready.lock().await.as_ref() {
        return Ok(Some(u.info.clone()));
    }
    let client = &crate::store::shared(app).client;
    let res = client
        .get(LATEST_RELEASE)
        .header("User-Agent", "Deskdo")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("無法檢查更新：{e}"))?;
    if !res.status().is_success() {
        return Err(format!("無法檢查更新（HTTP {}）", res.status().as_u16()));
    }
    let release: serde_json::Value = res.json().await.map_err(|e| format!("無法檢查更新：{e}"))?;
    let tag = release["tag_name"].as_str().unwrap_or_default();
    let current = app.package_info().version.to_string();
    if version_tuple(tag) <= version_tuple(&current) {
        return Ok(None);
    }
    let apk = release["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(".apk")))
        .and_then(|a| a["browser_download_url"].as_str());
    // 這一版還沒有 APK（例如只發了電腦版）就當作沒有更新
    let Some(url) = apk else { return Ok(None) };
    let info = UpdateInfo {
        version: tag.trim_start_matches('v').to_string(),
        notes: release["body"].as_str().map(str::to_string).filter(|s| !s.trim().is_empty()),
    };
    *st.ready.lock().await = Some(MobileUpdate { info: info.clone(), url: url.to_string() });
    let _ = app.emit("update", &info);
    Ok(Some(info))
}

/// 用瀏覽器下載新版 APK，下載完系統會問要不要安裝
#[cfg(mobile)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = app.state::<UpdateState>().ready.lock().await.as_ref().map(|u| u.url.clone());
    let Some(url) = url else {
        return Err("沒有可安裝的更新".into());
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("無法開啟下載網址：{e}"))
}

#[cfg(test)]
mod tests {
    use super::version_tuple;

    #[test]
    fn compares_versions() {
        assert!(version_tuple("v0.5.1") > version_tuple("0.5.0"));
        assert!(version_tuple("v0.10.0") > version_tuple("0.9.9"));
        assert_eq!(version_tuple("v0.5.0"), version_tuple("0.5.0"));
        assert_eq!(version_tuple("junk"), (0, 0, 0));
    }
}
