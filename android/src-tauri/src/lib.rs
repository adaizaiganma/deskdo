//! Deskdo Android 版：全螢幕的主畫面，以及手機主畫面上的小工具（Kotlin，見 gen/android）。
//! 同步、設定檔、設定精靈在共用的 deskdo-core（core/rust），和電腦版共用。

mod mobile;
mod updater;
mod windows;

// 共用的模組，讓 crate::store 這些路徑照舊可以用
pub(crate) use deskdo_core::{api, config, oauth, setup, store};

use tauri::{AppHandle, Manager};
#[cfg(mobile)]
use tauri::RunEvent;

// 在電腦上也能 cargo check／test（main.rs），所以 Android 專用的部分用 cfg(mobile)
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(mobile::init())
        .plugin(tauri_plugin_opener::init())
        .manage(updater::UpdateState::default())
        .manage(deskdo_core::Hooks {
            snapshot_changed: mobile::update_widget,
            prefs_changed: windows::emit_prefs,
            show_main: |app: &AppHandle| windows::show_main(app, None),
            language_changed: mobile::refresh_widget,
        })
        .invoke_handler(deskdo_core::combine(
            deskdo_core::handler(),
            tauri::generate_handler![
                updater::get_update,
                updater::check_update,
                updater::install_update,
                windows::get_prefs,
                windows::save_connection,
                windows::open_main,
                windows::take_widget_todo,
            ],
        ))
        .setup(|app| {
            // 設定檔放在 App 自己的資料目錄，要在讀設定之前決定
            config::init_dir(app.path().app_data_dir()?);
            deskdo_core::init(app.handle());

            let handle = app.handle().clone();
            windows::create_main(&handle)?;
            store::emit(&handle);
            store::start_sync(handle.clone());
            updater::start(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Deskdo")
        .run(|_app, _event| {
            // 回到前景時馬上同步（可能剛在小工具上勾了完成）
            #[cfg(mobile)]
            if let RunEvent::Resumed = _event {
                store::shared(_app).wake(true);
            }
        });
}
