// 正式版不要跳出主控台視窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod cloudflare;
mod config;
#[cfg(windows)]
mod desktop_layer;
#[cfg(windows)]
mod glass;
mod setup;
mod store;
mod tray;
mod windows;

use std::sync::Arc;
use tauri::RunEvent;
use tauri_plugin_autostart::ManagerExt;

fn main() {
    tauri::Builder::default()
        // 已經有一個在執行時，改成叫它打開主視窗
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows::show_main(app, None)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(store::Shared::new()))
        .manage(setup::SetupState::default())
        .invoke_handler(tauri::generate_handler![
            store::get_state,
            store::refresh_now,
            store::add_todo,
            store::update_todo,
            store::delete_todo,
            store::undo_delete,
            setup::setup_token,
            setup::setup_cancel,
            setup::setup_inspect,
            setup::setup_run,
            setup::get_connector,
            setup::rotate_connector,
            setup::list_devices,
            setup::revoke_device,
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
            let handle = app.handle().clone();
            let cfg = store::shared(&handle).config();
            let autostart = handle.autolaunch().is_enabled().unwrap_or(false);
            tray::create(&handle, cfg.show_desktop_widget, autostart)?;
            windows::create_widget(&handle)?;
            windows::create_main(&handle)?;
            windows::refresh_autostart_path(&handle);
            store::emit(&handle);
            store::start_sync(handle);
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .build(tauri::generate_context!())
        .expect("無法啟動待辦事項")
        .run(|_app, event| {
            // 視窗都收起來時不要結束，留在系統匣
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
