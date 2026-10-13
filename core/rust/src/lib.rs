//! Deskdo 的核心：電腦版和 Android 版共用。
//!
//! - `store`：待辦清單、和雲端同步、離線時的快取
//! - `config`：設定檔
//! - `setup`、`oauth`、`cloudflare`：設定精靈（在使用者自己的 Cloudflare 帳號部署 Worker + D1）
//! - `api`：呼叫雲端 Worker 的 REST API
//! - `i18n`：介面語言（中文／英文），前端告訴這邊用哪一種
//!
//! 介面相關的事（系統匣、桌面或主畫面小工具、主視窗）由 App 透過 [`Hooks`] 提供。

pub mod api;
pub mod cloudflare;
pub mod config;
pub mod i18n;
pub mod oauth;
pub mod setup;
pub mod store;

use tauri::{ipc::Invoke, AppHandle, Manager, Runtime, Wry};

/// App 在 setup 時用 `app.manage(Hooks { .. })` 註冊；沒有註冊時什麼都不做（測試）
pub struct Hooks {
    /// 待辦清單變了（系統匣的數字、主畫面小工具）
    pub snapshot_changed: fn(&AppHandle, &store::Snapshot),
    /// 設定或雲端版本變了，前端要重新讀 get_prefs
    pub prefs_changed: fn(&AppHandle),
    /// 把主視窗叫到前面（Cloudflare 登入完成時）
    pub show_main: fn(&AppHandle),
    /// 介面語言換了（系統匣的文字、主畫面小工具）
    pub language_changed: fn(&AppHandle),
}

pub(crate) fn snapshot_changed(app: &AppHandle, snap: &store::Snapshot) {
    if let Some(h) = app.try_state::<Hooks>() {
        (h.snapshot_changed)(app, snap);
    }
}

pub(crate) fn prefs_changed(app: &AppHandle) {
    if let Some(h) = app.try_state::<Hooks>() {
        (h.prefs_changed)(app);
    }
}

pub(crate) fn language_changed(app: &AppHandle) {
    if let Some(h) = app.try_state::<Hooks>() {
        (h.language_changed)(app);
    }
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(h) = app.try_state::<Hooks>() {
        (h.show_main)(app);
    }
}

/// 這個 crate 提供的指令；App 的 invoke handler 遇到這些名稱時交給 [`handler`]
pub const COMMANDS: &[&str] = &[
    "get_state",
    "refresh_now",
    "add_todo",
    "update_todo",
    "delete_todo",
    "undo_delete",
    "set_folders",
    "setup_token",
    "setup_oauth",
    "setup_cancel",
    "setup_inspect",
    "setup_run",
    "get_connector",
    "rotate_connector",
    "list_devices",
    "revoke_device",
    "create_pairing",
    "set_language",
];

pub fn handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        store::get_state,
        store::refresh_now,
        store::add_todo,
        store::update_todo,
        store::delete_todo,
        store::undo_delete,
        store::set_folders,
        setup::setup_token,
        oauth::setup_oauth,
        setup::setup_cancel,
        setup::setup_inspect,
        setup::setup_run,
        setup::get_connector,
        setup::rotate_connector,
        setup::list_devices,
        setup::revoke_device,
        setup::create_pairing,
        i18n::set_language,
    ]
}

/// 把 core 的指令和 App 自己的指令合成一個 invoke handler
pub fn combine<R: Runtime>(
    core: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
    app: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        if COMMANDS.contains(&invoke.message.command()) {
            core(invoke)
        } else {
            app(invoke)
        }
    }
}

/// 在 App 的 setup 裡呼叫（手機版要先 `config::init_dir`）：建立共用狀態
pub fn init(app: &AppHandle) {
    i18n::load();
    app.manage(std::sync::Arc::new(store::Shared::new()));
    app.manage(setup::SetupState::default());
}
