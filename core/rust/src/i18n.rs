//! 介面語言：前端（i18n.svelte.ts）啟動時和切換時呼叫 `set_language` 告訴這邊，
//! 系統匣、錯誤訊息、手機主畫面小工具跟著用。存在設定目錄的 `language`，下次啟動時系統匣一開始就是對的語言。

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static EN: AtomicBool = AtomicBool::new(false);

const FILE: &str = "language";

/// 啟動時讀上次的語言（在建立系統匣之前呼叫）
pub fn load() {
    let saved = std::fs::read_to_string(crate::config::config_dir().join(FILE)).unwrap_or_default();
    EN.store(saved.trim() == "en", Ordering::Relaxed);
}

/// 現在是不是英文
pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// 依目前的語言選一個
pub fn tr(zh: &'static str, en: &'static str) -> &'static str {
    if self::en() {
        en
    } else {
        zh
    }
}

/// 要帶參數的訊息：`trf!("找不到 {x}", "Can't find {x}")`
#[macro_export]
macro_rules! trf {
    ($zh:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::en() { format!($en $(, $arg)*) } else { format!($zh $(, $arg)*) }
    };
}

#[tauri::command]
pub fn set_language(app: AppHandle, lang: String) {
    let en = lang == "en";
    if EN.swap(en, Ordering::Relaxed) == en {
        return;
    }
    let _ = std::fs::write(crate::config::config_dir().join(FILE), if en { "en" } else { "zh" });
    crate::language_changed(&app);
}
