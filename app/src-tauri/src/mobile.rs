//! 手機版和 Android 原生程式（Kotlin）之間的橋：資料變動時把清單交給主畫面小工具。
//!
//! 小工具（DeskdoWidget.kt）不一定在 App 執行時才更新（例如重新開機後），
//! 所以每次都把要顯示的待辦、連線設定整份寫給它，它自己存起來；
//! 在小工具上勾選完成時，它直接呼叫雲端的 API，App 下次回到前景時再同步。

use crate::store::{self, Snapshot, Todo};
use serde::Serialize;
use std::{collections::HashSet, sync::Mutex};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Wry,
};

/// 小工具最多顯示幾筆（太多也捲不完，完整清單在 App 裡）
const WIDGET_LIMIT: usize = 60;

struct Widget(PluginHandle<Wry>);

/// 上次送給小工具的內容；一樣就不再送
static LAST: Mutex<String> = Mutex::new(String::new());

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("deskdo")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("dev.deskdo.app", "WidgetPlugin")?;
                app.manage(Widget(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetData<'a> {
    api_base: &'a str,
    api_token: &'a str,
    today: &'a str,
    configured: bool,
    items: Vec<Item<'a>>,
}

#[derive(Serialize)]
struct Item<'a> {
    id: &'a str,
    title: &'a str,
    due: Option<&'a str>,
    tag: Option<&'a str>,
    priority: &'a str,
}

/// 小工具要顯示的：還沒完成、而且已經輪到的（前一步還沒完成的步驟先不顯示），
/// 依期限排（沒有期限的放最後），同一天高優先在前、低優先在後
fn widget_items(todos: &[Todo]) -> Vec<&Todo> {
    let open: HashSet<&str> = todos.iter().filter(|t| !t.done).map(|t| t.id.as_str()).collect();
    let rank = |p: &str| match p {
        "high" => 0,
        "low" => 2,
        _ => 1,
    };
    let mut items: Vec<&Todo> = todos
        .iter()
        .filter(|t| !t.done && !t.after_id.as_deref().is_some_and(|a| open.contains(a)))
        .collect();
    items.sort_by(|a, b| {
        (a.due.is_none(), a.due.as_deref(), rank(&a.priority), a.created_at.as_str()).cmp(&(
            b.due.is_none(),
            b.due.as_deref(),
            rank(&b.priority),
            b.created_at.as_str(),
        ))
    });
    items.truncate(WIDGET_LIMIT);
    items
}

pub fn update_widget(app: &AppHandle, snap: &Snapshot) {
    let Some(widget) = app.try_state::<Widget>() else { return };
    let cfg = store::shared(app).config();
    let data = WidgetData {
        api_base: &cfg.api_base,
        api_token: &cfg.api_token,
        today: &snap.today,
        configured: cfg.configured(),
        items: widget_items(&snap.todos)
            .into_iter()
            .map(|t| Item { id: &t.id, title: &t.title, due: t.due.as_deref(), tag: t.tag.as_deref(), priority: &t.priority })
            .collect(),
    };
    let Ok(json) = serde_json::to_string(&data) else { return };
    {
        let mut last = LAST.lock().unwrap();
        if *last == json {
            return;
        }
        *last = json.clone();
    }
    // 呼叫 Kotlin 會等它回覆，不要卡住同步的流程
    let handle = widget.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let payload: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
        let _ = handle.run_mobile_plugin::<serde_json::Value>("update", payload);
    });
}
