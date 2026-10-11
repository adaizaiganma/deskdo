//! Deskdo：桌面版（Windows，系統匣＋釘在桌面的小工具）和 Android 版共用這份程式。
//! 平台差異用 Tauri 的 `desktop` / `mobile` cfg 分開。

mod api;
mod cloudflare;
mod config;
#[cfg(windows)]
mod desktop_layer;
#[cfg(windows)]
mod glass;
#[cfg(mobile)]
mod mobile;
mod oauth;
mod setup;
mod store;
#[cfg(desktop)]
mod tray;
mod updater;
mod windows;

use std::sync::Arc;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // 已經有一個在執行時，改成叫它打開主視窗。
        // DESKDO_HOME（另一個設定目錄，開發測試用）視為獨立的執行個體，可以和正式版同時執行
        if std::env::var_os("DESKDO_HOME").is_none() {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows::show_main(app, None)));
        }
        builder = builder
            .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }
    #[cfg(mobile)]
    {
        builder = builder.plugin(mobile::init());
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .manage(setup::SetupState::default())
        .manage(updater::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
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
            updater::get_update,
            updater::check_update,
            updater::install_update,
            windows::get_prefs,
            windows::save_connection,
            windows::set_widget_visible,
            windows::set_widget_opacity,
            windows::set_autostart,
            windows::widget_ready,
            windows::set_widget_theme,
            windows::get_effects,
            windows::open_main,
            windows::quit_app,
        ])
        .setup(|app| {
            // 手機上設定檔放在 App 自己的資料目錄（桌面版是 %APPDATA%\Deskdo），要在讀設定之前決定
            #[cfg(mobile)]
            config::init_dir(app.path().app_data_dir()?);
            app.manage(Arc::new(store::Shared::new()));

            let handle = app.handle().clone();
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                let cfg = store::shared(&handle).config();
                let autostart = handle.autolaunch().is_enabled().unwrap_or(false);
                tray::create(&handle, cfg.show_desktop_widget, autostart)?;
                windows::create_widget(&handle)?;
            }
            windows::create_main(&handle)?;
            #[cfg(desktop)]
            windows::refresh_autostart_path(&handle);
            store::emit(&handle);
            store::start_sync(handle.clone());
            updater::start(handle);
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .build(tauri::generate_context!())
        .expect("無法啟動待辦事項")
        .run(|_app, event| match event {
            // 桌面版：視窗都收起來時不要結束，留在系統匣
            RunEvent::ExitRequested { api, code, .. } if code.is_none() && cfg!(desktop) => api.prevent_exit(),
            // 手機版回到前景時馬上同步（可能剛在小工具上勾了完成）
            #[cfg(mobile)]
            RunEvent::Resumed => store::shared(_app).wake(true),
            _ => {}
        });
}
