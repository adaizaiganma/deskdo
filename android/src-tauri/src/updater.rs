//! App 更新：Android 沒有 Tauri 的自動更新，改成查 GitHub 最新 Release 有沒有比較新的 APK，
//! 使用者按「更新」時用瀏覽器下載，系統會接著問要不要安裝（簽章相同才能覆蓋安裝）。
//! 只有正式版會自動檢查。

use crate::config;
use deskdo_core::{i18n::tr, trf};
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

const LATEST_RELEASE: &str = "https://api.github.com/repos/adaizaiganma/deskdo-android/releases/latest";
/// 啟動後等一下再檢查，避免和第一次同步搶網路
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
    /// GitHub Release 的說明文字
    notes: Option<String>,
}

struct Found {
    info: UpdateInfo,
    url: String,
}

#[derive(Default)]
pub struct UpdateState {
    ready: Mutex<Option<Found>>,
    /// 避免手動檢查和定期檢查同時進行
    checking: Mutex<()>,
}

fn enabled() -> bool {
    !cfg!(debug_assertions) && !config::BETA
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

/// "v0.5.1" → (0, 5, 1)；看不懂的版本號當成 0
fn version_tuple(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches('v').split(['.', '-', '+']).map(|p| p.parse().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

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
        .map_err(|e| trf!("無法檢查更新：{e}", "Can't check for updates: {e}"))?;
    if !res.status().is_success() {
        return Err(trf!("無法檢查更新（HTTP {}）", "Can't check for updates (HTTP {})", res.status().as_u16()));
    }
    let release: serde_json::Value = res.json().await.map_err(|e| trf!("無法檢查更新：{e}", "Can't check for updates: {e}"))?;
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
    let Some(url) = apk else { return Ok(None) };
    let info = UpdateInfo {
        version: tag.trim_start_matches('v').to_string(),
        notes: release["body"].as_str().map(str::to_string).filter(|s| !s.trim().is_empty()),
    };
    *st.ready.lock().await = Some(Found { info: info.clone(), url: url.to_string() });
    let _ = app.emit("update", &info);
    Ok(Some(info))
}

#[tauri::command]
pub async fn get_update(app: AppHandle) -> Option<UpdateInfo> {
    app.state::<UpdateState>().ready.lock().await.as_ref().map(|u| u.info.clone())
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    if !enabled() {
        return Err(tr("開發版和測試版不會自動更新", "Dev and beta builds don't update automatically").into());
    }
    check(&app).await
}

/// 用瀏覽器下載新版 APK，下載完系統會問要不要安裝
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let url = app.state::<UpdateState>().ready.lock().await.as_ref().map(|u| u.url.clone());
    let Some(url) = url else {
        return Err(tr("沒有可安裝的更新", "There's no update to install").into());
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| trf!("無法開啟下載網址：{e}", "Can't open the download link: {e}"))
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
