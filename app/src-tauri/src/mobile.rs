//! 手機版和 Android 原生程式（Kotlin）之間的橋：資料變動時把清單交給主畫面小工具。
//!
//! 小工具（DeskdoWidget.kt）不一定在 App 執行時才更新（例如重新開機後），
//! 所以每次都把要顯示的待辦、連線設定整份寫給它，它自己存起來；
//! 在小工具上勾選完成時，它直接呼叫雲端的 API，App 下次回到前景時再同步。

use crate::store::{self, Folder, Snapshot, Todo};
use serde::Serialize;
use std::{collections::HashSet, sync::Mutex};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Wry,
};

/// 最多交給小工具幾筆（太多也捲不完，完整清單在 App 裡）
const WIDGET_LIMIT: usize = 300;

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
    folders: &'a [Folder],
    items: Vec<Item<'a>>,
}

#[derive(Serialize)]
struct Item<'a> {
    id: &'a str,
    title: &'a str,
    due: Option<&'a str>,
    tag: Option<&'a str>,
    priority: &'a str,
    /// 還沒完成的前一步的 id；有的話這一步還沒輪到（只在依標籤、資料夾篩選時顯示，淡色）
    after: Option<&'a str>,
    mail: bool,
    note: bool,
}

/// 小工具要的：所有還沒完成的，依期限排好（沒有期限的放最後，同一天高優先在前、低優先在後），
/// 分組由小工具自己做。每一筆附上它在等的前一步（還沒輪到的步驟只在篩選時顯示）
fn widget_items(todos: &[Todo]) -> Vec<Item<'_>> {
    let open: HashSet<&str> = todos.iter().filter(|t| !t.done).map(|t| t.id.as_str()).collect();
    let rank = |p: &str| match p {
        "high" => 0,
        "low" => 2,
        _ => 1,
    };
    let mut sorted: Vec<&Todo> = todos.iter().filter(|t| !t.done).collect();
    sorted.sort_by(|a, b| {
        (a.due.is_none(), a.due.as_deref(), rank(&a.priority), a.created_at.as_str()).cmp(&(
            b.due.is_none(),
            b.due.as_deref(),
            rank(&b.priority),
            b.created_at.as_str(),
        ))
    });
    sorted.truncate(WIDGET_LIMIT);
    sorted
        .into_iter()
        .map(|t| Item {
            id: &t.id,
            title: &t.title,
            due: t.due.as_deref(),
            tag: t.tag.as_deref(),
            priority: &t.priority,
            after: t.after_id.as_deref().filter(|a| open.contains(a)),
            mail: t.source == "email",
            note: t.note.as_deref().is_some_and(|n| !n.trim().is_empty()),
        })
        .collect()
}

/// 小工具上點了哪一筆待辦（WidgetPlugin.takeOpen）；要在非主執行緒呼叫，Kotlin 端在主執行緒執行
pub fn take_open_todo(app: &AppHandle) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Open {
        id: Option<String>,
    }
    let widget = app.try_state::<Widget>()?;
    widget.0.run_mobile_plugin::<Open>("takeOpen", ()).ok()?.id
}

pub fn update_widget(app: &AppHandle, snap: &Snapshot) {
    let Some(widget) = app.try_state::<Widget>() else { return };
    let cfg = store::shared(app).config();
    let data = WidgetData {
        api_base: &cfg.api_base,
        api_token: &cfg.api_token,
        today: &snap.today,
        configured: cfg.configured(),
        folders: &snap.folders,
        items: widget_items(&snap.todos),
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
