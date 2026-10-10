//! 設定檔與快取，存放在 %APPDATA%\Deskdo。

use crate::store::Todo;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fs, io, path::Path, path::PathBuf, sync::OnceLock};

/// 改名前（TodoWidget）的設定目錄名稱；第一次啟動時把設定搬過來
const LEGACY_DIR: &str = "TodoWidget";

pub fn config_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        // DESKDO_HOME 可覆寫設定目錄（測試用）
        if let Some(dir) = std::env::var_os("DESKDO_HOME").map(PathBuf::from) {
            let _ = fs::create_dir_all(&dir);
            return dir;
        }
        let base = std::env::var_os("APPDATA")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let dir = base.join("Deskdo");
        let _ = fs::create_dir_all(&dir);
        migrate_legacy(&base.join(LEGACY_DIR), &dir);
        dir
    })
    .clone()
}

/// 新目錄還沒有設定檔時，從舊目錄複製設定與快取（舊目錄保留不刪）
fn migrate_legacy(old: &Path, new: &Path) {
    if new.join("config.json").exists() {
        return;
    }
    for name in ["config.json", "cache.json"] {
        let _ = fs::copy(old.join(name), new.join(name));
    }
}

fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub api_base: String, // 例如 https://deskdo.xxx.workers.dev
    pub api_token: String,
    pub poll_seconds: u64,
    pub show_desktop_widget: bool,
    pub desktop_opacity: f64,
    /// 視窗位置與大小，實體像素 [x, y, w, h]
    pub widget_bounds: Option<[i32; 4]>,
    pub main_bounds: Option<[i32; 4]>,
    /// 保留不認得的欄位（例如更早版本的 desktop_geometry），存檔時原樣寫回
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_base: String::new(),
            api_token: String::new(),
            poll_seconds: 30,
            show_desktop_widget: true,
            desktop_opacity: 0.92,
            widget_bounds: None,
            main_bounds: None,
            extra: Map::new(),
        }
    }
}

impl Config {
    pub fn configured(&self) -> bool {
        !self.api_base.trim().is_empty() && !self.api_token.trim().is_empty()
    }

    pub fn load() -> Self {
        fs::read_to_string(config_dir().join("config.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) {
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = write_atomic(&config_dir().join("config.json"), &s);
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Cache {
    pub today: Option<String>,
    pub todos: Vec<Todo>,
}

pub fn load_cache() -> Option<Cache> {
    let s = fs::read_to_string(config_dir().join("cache.json")).ok()?;
    serde_json::from_str(&s).ok()
}

pub fn save_cache(cache: &Cache) {
    if let Ok(s) = serde_json::to_string(cache) {
        let _ = write_atomic(&config_dir().join("cache.json"), &s);
    }
}
