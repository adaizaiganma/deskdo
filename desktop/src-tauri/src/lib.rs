//! Deskdo 電腦版（Windows）：系統匣、釘在桌面的小工具、主視窗。
//! 同步、設定檔、設定精靈在共用的 deskdo-core（../../core/rust），和 Android 版共用。

mod desktop_layer;
mod glass;
mod tray;
mod updater;
mod windows;

// 共用的模組，讓 crate::store 這些路徑照舊可以用
pub(crate) use deskdo_core::{api, config, oauth, setup, store};

use tauri::{AppHandle, RunEvent};

pub fn run() {
    let mut builder = tauri::Builder::default();
    // 已經有一個在執行時，改成叫它打開主視窗。
    // DESKDO_HOME（另一個設定目錄，開發測試用）視為獨立的執行個體，可以和正式版同時執行
    if std::env::var_os("DESKDO_HOME").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows::show_main(app, None)));
    }
    builder
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(updater::UpdateState::default())
        .manage(deskdo_core::Hooks {
            snapshot_changed: tray::update,
            prefs_changed: windows::emit_prefs,
            show_main: |app: &AppHandle| windows::show_main(app, None),
        })
        .invoke_handler(deskdo_core::combine(
            deskdo_core::handler(),
            tauri::generate_handler![
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
            ],
        ))
        .setup(|app| {
            deskdo_core::init(app.handle());

            let handle = app.handle().clone();
            {
                use tauri_plugin_autostart::ManagerExt;
                let cfg = store::shared(&handle).config();
                let autostart = handle.autolaunch().is_enabled().unwrap_or(false);
                tray::create(&handle, cfg.show_desktop_widget, autostart)?;
                windows::create_widget(&handle)?;
            }
            windows::create_main(&handle)?;
            windows::refresh_autostart_path(&handle);
            windows::show_main_if_new_version(&handle);
            store::emit(&handle);
            store::start_sync(handle.clone());
            updater::start(handle);
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
