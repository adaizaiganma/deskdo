//! 兩個視窗：釘在桌面的小工具（widget），以及從系統匣開啟的主視窗（main）。

use crate::{
    api, setup,
    store::{self, shared},
    tray::TrayItems,
};
use serde::Serialize;
use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

pub fn create_widget(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("widget.html".into()))
        .title("待辦事項")
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .skip_taskbar(true)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .min_inner_size(260.0, 320.0)
        .inner_size(340.0, 540.0)
        .visible(false)
        .build()?;

    if !restore_bounds(&w, shared(app).config().widget_bounds) {
        // 預設放在主螢幕右上角
        if let Ok(Some(m)) = w.primary_monitor() {
            let k = m.scale_factor();
            let (mw, mh) = ((340.0 * k) as i32, (540.0 * k) as i32);
            let (p, s) = (m.position(), m.size());
            let margin = (24.0 * k) as i32;
            let _ = w.set_position(PhysicalPosition::new(p.x + s.width as i32 - mw - margin, p.y + margin));
            let _ = w.set_size(PhysicalSize::new(mw as u32, mh as u32));
        }
    }
    // 貼在桌面上：Z-order 管理見 desktop_layer.rs。前端載入完成後呼叫 widget_ready 才顯示
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        crate::desktop_layer::attach(h.0 as isize);
    }
    // 視窗出現前先套用毛玻璃（主題由前端載入後的 set_widget_theme 更新）
    apply_widget_backdrop(app);
    Ok(())
}

pub fn create_main(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("main.html".into()))
        .title("待辦事項")
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .inner_size(960.0, 660.0)
        .min_inner_size(640.0, 460.0)
        .center()
        .visible(false)
        .build()?;
    restore_bounds(&w, shared(app).config().main_bounds);
    #[cfg(windows)]
    {
        let ok = window_vibrancy::apply_mica(&w, None).is_ok();
        shared(app).fx_main.store(ok, Ordering::Relaxed);
    }
    Ok(())
}

fn restore_bounds(w: &WebviewWindow, bounds: Option<[i32; 4]>) -> bool {
    let Some([x, y, bw, bh]) = bounds else { return false };
    if bw < 100 || bh < 100 {
        return false;
    }
    // 確認至少有一部分在某個螢幕上（例如外接螢幕拔掉後）
    let visible = w.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        x < p.x + s.width as i32 && x + bw > p.x && y < p.y + s.height as i32 && y + bh > p.y
    });
    if visible {
        let _ = w.set_position(PhysicalPosition::new(x, y));
        let _ = w.set_size(PhysicalSize::new(bw as u32, bh as u32));
    }
    visible
}

static WIDGET_DARK: AtomicBool = AtomicBool::new(true);

/// 依目前主題與不透明度設定套用毛玻璃；回傳是否支援
fn apply_widget_backdrop(app: &AppHandle) -> bool {
    #[cfg(windows)]
    if let Some(w) = app.get_webview_window("widget") {
        if let Ok(h) = w.hwnd() {
            let opacity = shared(app).config().desktop_opacity;
            return crate::glass::apply(h.0 as isize, WIDGET_DARK.load(Ordering::Relaxed), opacity);
        }
    }
    let _ = app;
    false
}

pub fn show_main(app: &AppHandle, view: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(v) = view {
            let _ = app.emit_to("main", "navigate", v);
        }
    }
}

pub fn quit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        store::flush_deletes(&app).await;
        app.exit(0);
    });
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // 關閉 = 收到系統匣；要結束請用系統匣選單
            api.prevent_close();
            if window.label() == "widget" {
                set_widget_visible(window.app_handle().clone(), false);
            } else {
                let _ = window.hide();
            }
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => schedule_save_bounds(window),
        _ => {}
    }
}

static BOUNDS_GEN: [AtomicU64; 2] = [AtomicU64::new(0), AtomicU64::new(0)];

/// 拖曳或調整大小停下來 600ms 後才存檔
fn schedule_save_bounds(window: &Window) {
    let idx = match window.label() {
        "widget" => 0,
        "main" => 1,
        _ => return,
    };
    let gen = BOUNDS_GEN[idx].fetch_add(1, Ordering::SeqCst) + 1;
    let w = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        if BOUNDS_GEN[idx].load(Ordering::SeqCst) != gen {
            return;
        }
        let hidden = !w.is_visible().unwrap_or(false);
        if hidden || w.is_minimized().unwrap_or(false) || w.is_maximized().unwrap_or(false) {
            return;
        }
        let (Ok(p), Ok(s)) = (w.outer_position(), w.inner_size()) else { return };
        let bounds = Some([p.x, p.y, s.width as i32, s.height as i32]);
        let sh = shared(w.app_handle());
        let mut c = sh.config.lock().unwrap();
        if idx == 0 {
            c.widget_bounds = bounds;
        } else {
            c.main_bounds = bounds;
        }
        c.save();
    });
}

pub fn refresh_autostart_path(app: &AppHandle) {
    // 若已啟用，更新成目前執行檔的路徑（程式被搬移位置時）
    // 開發版不要動，否則會把正式的開機啟動路徑換成 target\debug 裡的 exe
    if cfg!(debug_assertions) {
        return;
    }
    let al = app.autolaunch();
    // 改名前的開機啟動項目叫 TodoWidget：移除它，並改用新名稱啟用
    if remove_legacy_autostart() || al.is_enabled().unwrap_or(false) {
        let _ = al.enable();
    }
}

/// 刪除 HKCU\...\Run 裡改名前的「TodoWidget」；原本存在時回傳 true
fn remove_legacy_autostart() -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::{
            w,
            Win32::System::Registry::{RegDeleteKeyValueW, HKEY_CURRENT_USER},
        };
        return RegDeleteKeyValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Run"),
            w!("TodoWidget"),
        ) == 0;
    }
    #[allow(unreachable_code)]
    false
}

// ---- 偏好設定 ----

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    api_base: String,
    api_token: String,
    poll_seconds: u64,
    show_desktop_widget: bool,
    desktop_opacity: f64,
    autostart: bool,
    configured: bool,
    done_sync_days: u32,
    /// 雲端 Worker 的版本；null 表示還不知道
    cloud_version: Option<u32>,
    /// 這版 App 內建的 Worker 版本
    latest_cloud_version: u32,
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
        show_desktop_widget: c.show_desktop_widget,
        desktop_opacity: c.desktop_opacity,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        done_sync_days: store::DONE_SYNC_DAYS,
        cloud_version: (cloud > 0).then_some(cloud),
        latest_cloud_version: setup::WORKER_VERSION,
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
        return Err("請填寫 API 網址和 token".into());
    }
    let r = api::send(&s.client, &cfg, reqwest::Method::GET, "/api/todos?status=open", None, None).await;
    if let Some(e) = r.error {
        return Err(e);
    }
    Ok(r.data.as_ref().and_then(|d| d.get("todos")).and_then(|t| t.as_array()).map_or(0, Vec::len))
}

#[tauri::command]
pub fn set_widget_visible(app: AppHandle, visible: bool) {
    {
        let s = shared(&app);
        let mut c = s.config.lock().unwrap();
        c.show_desktop_widget = visible;
        c.save();
    }
    if let Some(w) = app.get_webview_window("widget") {
        let _ = if visible { w.show() } else { w.hide() };
        if visible {
            restack_widget(&w);
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.widget.set_checked(visible);
    }
    emit_prefs(&app);
}

#[tauri::command]
pub fn set_widget_opacity(app: AppHandle, opacity: f64) {
    {
        let s = shared(&app);
        let mut c = s.config.lock().unwrap();
        c.desktop_opacity = opacity.clamp(0.0, 1.0);
        c.save();
    }
    apply_widget_backdrop(&app);
    emit_prefs(&app);
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    let now = al.is_enabled().unwrap_or(false);
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.autostart.set_checked(now);
    }
    emit_prefs(&app);
    r.map_err(|e| format!("無法修改開機啟動設定：{e}"))
}

/// 桌面小工具載入完成；依設定決定要不要顯示（避免先閃一個空白視窗）
#[tauri::command]
pub fn widget_ready(app: AppHandle) {
    if shared(&app).config().show_desktop_widget {
        if let Some(w) = app.get_webview_window("widget") {
            let _ = w.show();
            restack_widget(&w);
        }
    }
}

/// 主題變更時重新套用毛玻璃的底色；回傳是否支援毛玻璃
#[tauri::command]
pub fn set_widget_theme(app: AppHandle, dark: bool) -> bool {
    WIDGET_DARK.store(dark, Ordering::Relaxed);
    apply_widget_backdrop(&app)
}

/// 主視窗是否套用了 Mica（Windows 10 不支援時前端改用實心背景）
#[tauri::command]
pub fn get_effects(window: Window) -> bool {
    shared(window.app_handle()).fx_main.load(Ordering::Relaxed)
}

fn restack_widget(w: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        crate::desktop_layer::restack_now(h.0 as isize);
    }
    let _ = w;
}

#[tauri::command]
pub fn open_main(app: AppHandle, view: Option<String>) {
    show_main(&app, view.as_deref());
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    quit(&app);
}
