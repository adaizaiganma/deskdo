//! 待辦資料的本機狀態：輪詢、樂觀更新、失敗時復原。
//! 兩個視窗共用這一份資料；每次變動都會送出 "state" 事件。

use crate::{
    api::{self, ApiResult},
    config::{self, Cache, Config},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU32},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

/// 刪除後可以「復原」的時間；過了才真的送出 DELETE
const DELETE_DELAY: Duration = Duration::from_secs(5);

/// 已完成的項目只同步最近這幾天的；更早的留在伺服器上（可以請 Claude 查詢）
pub const DONE_SYNC_DAYS: u32 = 30;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub done_at: Option<String>,
    pub due: Option<String>,
    /// 期限的時間 HH:MM；沒有就是一整天的待辦（雲端版本 6 起）
    pub due_time: Option<String>,
    /// 雲端版本 6 起可以有好幾個標籤；舊版雲端只有 tag
    pub tags: Vec<String>,
    /// 第一個標籤（舊版雲端只認得這個欄位）
    pub tag: Option<String>,
    pub priority: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub source: String,
    pub source_ref: Option<String>,
    /// 前一步的 id；前一步還沒完成時，這一筆先不顯示（雲端版本 5 起）
    pub after_id: Option<String>,
}

impl Todo {
    /// 舊版雲端沒有 tags 時用 tag 補上；tag 一律是第一個標籤，沒有期限就沒有時間
    fn normalized(mut self) -> Todo {
        if self.tags.is_empty() {
            self.tags.extend(self.tag.take());
        }
        self.tag = self.tags.first().cloned();
        if self.due.is_none() {
            self.due_time = None;
        }
        self
    }
}

/// 新增、修改時 tags 和 tag 一起送：新版雲端看 tags，舊版雲端只看 tag
fn pair_tags(fields: &mut Map<String, Value>) {
    if let Some(tags) = fields.get("tags").and_then(Value::as_array) {
        let first = tags.iter().find_map(Value::as_str).map(|s| Value::String(s.into())).unwrap_or(Value::Null);
        fields.insert("tag".into(), first);
    } else if let Some(tag) = fields.get("tag").cloned() {
        let tags = match tag.as_str().map(str::trim).filter(|s| !s.is_empty()) {
            Some(t) => vec![Value::String(t.into())],
            None => vec![],
        };
        fields.insert("tags".into(), Value::Array(tags));
    }
}

/// 標籤資料夾（只影響顯示；順序就是顯示順序）
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Folder {
    pub name: String,
    pub tags: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub todos: Vec<Todo>,
    pub folders: Vec<Folder>,
    pub today: String,
    /// "syncing" | "ok" | "offline" | "error"
    pub status: &'static str,
    pub message: String,
    pub last_sync: Option<String>,
}

pub struct Inner {
    todos: Vec<Todo>,
    folders: Vec<Folder>,
    server_today: Option<String>,
    status: &'static str,
    message: String,
    last_sync: Option<String>,
    etag: Option<String>,
    pending: u32, // 進行中的修改請求數
    fetching: bool,
    refetch_after: bool,
    force_next: bool,
    /// 已按刪除、還在等待復原期限的項目
    hidden: HashSet<String>,
}

pub struct Shared {
    pub inner: Mutex<Inner>,
    pub config: Mutex<Config>,
    pub client: reqwest::Client,
    wake: Notify,
    pub fx_main: AtomicBool,
    /// 雲端 Worker 的版本；0 表示還不知道
    pub cloud_version: AtomicU32,
}

impl Shared {
    pub fn new() -> Self {
        let cache = config::load_cache().unwrap_or_default();
        Self {
            inner: Mutex::new(Inner {
                todos: cache.todos,
                folders: cache.folders,
                server_today: cache.today,
                status: "syncing",
                message: String::new(),
                last_sync: None,
                etag: None,
                pending: 0,
                fetching: false,
                refetch_after: false,
                force_next: false,
                hidden: HashSet::new(),
            }),
            config: Mutex::new(Config::load()),
            client: reqwest::Client::new(),
            wake: Notify::new(),
            fx_main: AtomicBool::new(false),
            cloud_version: AtomicU32::new(0),
        }
    }

    pub fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    /// 立即同步一次；force 會忽略 ETag 重新下載
    pub fn wake(&self, force: bool) {
        let mut g = self.inner.lock().unwrap();
        if force {
            g.force_next = true;
            g.etag = None;
        }
        drop(g);
        self.wake.notify_one();
    }
}

pub fn shared(app: &AppHandle) -> Arc<Shared> {
    app.state::<Arc<Shared>>().inner().clone()
}

fn local_today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Inner {
    /// 伺服器的「今天」（Asia/Taipei）和本機日期取較晚者
    fn today(&self) -> String {
        let local = local_today();
        match &self.server_today {
            Some(s) if s.len() == 10 && *s > local => s.clone(),
            _ => local,
        }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            todos: self.visible_todos(),
            folders: self.folders.clone(),
            today: self.today(),
            status: self.status,
            message: self.message.clone(),
            last_sync: self.last_sync.clone(),
        }
    }

    /// 去掉等待刪除的項目；接在它們後面的步驟改接到它們的前一步（和雲端真的刪除後一樣）
    fn visible_todos(&self) -> Vec<Todo> {
        let after_of = |id: &str| self.todos.iter().find(|t| t.id == id).and_then(|t| t.after_id.clone());
        self.todos
            .iter()
            .filter(|t| !self.hidden.contains(&t.id))
            .map(|t| {
                let mut t = t.clone().normalized();
                let mut guard = 0;
                while let Some(prev) = t.after_id.clone().filter(|p| self.hidden.contains(p)) {
                    t.after_id = after_of(&prev);
                    guard += 1;
                    if guard > self.hidden.len() {
                        break;
                    }
                }
                t
            })
            .collect()
    }

    fn replace(&mut self, id: &str, new: Option<Todo>) {
        if let Some(i) = self.todos.iter().position(|t| t.id == id) {
            match new {
                Some(t) => self.todos[i] = t,
                None => {
                    self.todos.remove(i);
                }
            }
        }
    }
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    shared(app).inner.lock().unwrap().snapshot()
}

pub fn emit(app: &AppHandle) {
    let snap = snapshot(app);
    crate::snapshot_changed(app, &snap);
    let _ = app.emit("state", &snap);
}

// ---- 同步 ----

/// 多久檢查一次雲端 Worker 有沒有新版本
const VERSION_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

pub fn start_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let s = shared(&app);
        let mut version_checked: Option<(Instant, String)> = None;
        loop {
            refresh(&app).await;
            // 啟動時、換了連線設定（網址或 token）時、之後每 6 小時檢查一次
            let cfg = s.config();
            let conn = format!("{}\n{}", cfg.api_base, cfg.api_token);
            if version_checked.as_ref().is_none_or(|(t, c)| *c != conn || t.elapsed() > VERSION_CHECK_INTERVAL) {
                crate::setup::check_cloud_version(&app).await;
                version_checked = Some((Instant::now(), conn));
            }
            let secs = s.config().poll_seconds.max(10);
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(secs)) => {}
                _ = s.wake.notified() => {}
            }
        }
    });
}

async fn refresh(app: &AppHandle) {
    let s = shared(app);
    let cfg = s.config();
    let etag = {
        let mut g = s.inner.lock().unwrap();
        if !cfg.configured() {
            g.status = "error";
            g.message = "尚未設定 API".into();
            drop(g);
            emit(app);
            return;
        }
        if g.pending > 0 {
            // 修改還沒完成時抓到的資料可能是舊的，等修改完成後再抓
            g.refetch_after = true;
            return;
        }
        if g.fetching {
            return;
        }
        g.fetching = true;
        let force = std::mem::take(&mut g.force_next);
        let etag = if force { None } else { g.etag.clone() };
        let show_syncing = g.status != "ok";
        if show_syncing {
            g.status = "syncing";
        }
        drop(g);
        if show_syncing {
            emit(app);
        }
        etag
    };

    let path = format!("/api/todos?doneDays={DONE_SYNC_DAYS}");
    let r = api::send(&s.client, &cfg, Method::GET, &path, None, etag.as_deref()).await;
    {
        let mut g = s.inner.lock().unwrap();
        g.fetching = false;
        if let Some(err) = &r.error {
            g.status = if r.offline() { "offline" } else { "error" };
            g.message = err.clone();
        } else {
            g.last_sync = Some(chrono::Local::now().format("%H:%M").to_string());
            if r.status == 200 && g.pending == 0 {
                if let Some(data) = &r.data {
                    g.etag = r.etag.clone();
                    g.server_today = data.get("today").and_then(Value::as_str).map(String::from);
                    g.todos = data
                        .get("todos")
                        .cloned()
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default();
                    // 雲端版本 4 起才有資料夾；舊版沒有這個欄位就當作沒有資料夾
                    g.folders = data
                        .get("folders")
                        .cloned()
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default();
                    config::save_cache(&Cache {
                        today: g.server_today.clone(),
                        todos: g.todos.clone(),
                        folders: g.folders.clone(),
                    });
                }
            }
            g.status = "ok";
            g.message.clear();
        }
    }
    emit(app);
}

// ---- 修改（先更新畫面，失敗再復原） ----

fn failure(r: &ApiResult) -> Option<String> {
    r.error.as_ref().map(|e| if r.offline() { "離線中，修改未儲存".to_string() } else { e.clone() })
}

/// 修改請求完成後呼叫。成功時套用伺服器回傳的資料，失敗時復原並回傳錯誤訊息。
fn finish(
    app: &AppHandle,
    fail: Option<(bool, String)>,
    on_ok: impl FnOnce(&mut Inner),
    undo: impl FnOnce(&mut Inner),
) -> Result<(), String> {
    let s = shared(app);
    let ok = fail.is_none();
    let refetch = {
        let mut g = s.inner.lock().unwrap();
        g.pending = g.pending.saturating_sub(1);
        match &fail {
            None => on_ok(&mut g),
            Some((offline, msg)) => {
                undo(&mut g);
                g.status = if *offline { "offline" } else { "error" };
                g.message = msg.clone();
            }
        }
        g.etag = None; // 確保下一次輪詢拿到最新資料
        let need = g.pending == 0 && (g.refetch_after || ok);
        if need {
            g.refetch_after = false;
        }
        need
    };
    emit(app);
    if refetch {
        s.wake(false);
    }
    match fail {
        None => Ok(()),
        Some((_, msg)) => Err(msg),
    }
}

fn str_field(fields: &Map<String, Value>, key: &str) -> Option<String> {
    fields.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

#[tauri::command]
pub fn get_state(app: AppHandle) -> Snapshot {
    snapshot(&app)
}

#[tauri::command]
pub fn refresh_now(app: AppHandle) {
    shared(&app).wake(true);
}

#[tauri::command]
pub async fn add_todo(app: AppHandle, mut fields: Map<String, Value>) -> Result<Todo, String> {
    let title = str_field(&fields, "title").ok_or("標題不能是空的")?;
    pair_tags(&mut fields);
    let s = shared(&app);
    let cfg = s.config();
    let tmp_id = format!("tmp-{:x}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
    let now = now_iso();
    let local = Todo {
        id: tmp_id.clone(),
        title,
        due: str_field(&fields, "due"),
        due_time: str_field(&fields, "dueTime"),
        tags: fields
            .get("tags")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default(),
        priority: str_field(&fields, "priority").unwrap_or_else(|| "normal".into()),
        note: str_field(&fields, "note"),
        created_at: now.clone(),
        updated_at: now,
        source: "manual".into(),
        after_id: str_field(&fields, "afterId"),
        ..Default::default()
    };
    {
        let mut g = s.inner.lock().unwrap();
        g.todos.push(local);
        g.pending += 1;
    }
    emit(&app);

    let body = Value::Object(fields);
    let r = api::send(&s.client, &cfg, Method::POST, "/api/todos", Some(&body), None).await;
    let created: Option<Todo> = r.data.clone().and_then(|v| serde_json::from_value(v).ok());
    let fail = match (&created, failure(&r)) {
        (_, Some(msg)) => Some((r.offline(), msg)),
        (None, None) => Some((false, "伺服器回應格式錯誤".to_string())),
        _ => None,
    };
    let id2 = tmp_id.clone();
    let c2 = created.clone();
    finish(
        &app,
        fail,
        move |g| {
            // 前一步原本就有下一步時，雲端會把新的這筆插在中間；本機先跟著改，下一次同步再確認
            if let Some(c) = &c2 {
                if let Some(prev) = &c.after_id {
                    for t in g.todos.iter_mut().filter(|t| t.after_id.as_ref() == Some(prev) && t.id != tmp_id) {
                        t.after_id = Some(c.id.clone());
                    }
                }
            }
            g.replace(&tmp_id, c2)
        },
        move |g| g.replace(&id2, None),
    )?;
    Ok(created.unwrap_or_default())
}

#[tauri::command]
pub async fn update_todo(app: AppHandle, id: String, patch: Map<String, Value>) -> Result<(), String> {
    const ALLOWED: [&str; 9] = ["title", "due", "dueTime", "tags", "tag", "priority", "note", "done", "afterId"];
    let mut patch: Map<String, Value> = patch.into_iter().filter(|(k, _)| ALLOWED.contains(&k.as_str())).collect();
    pair_tags(&mut patch);
    if id.starts_with("tmp-") || patch.is_empty() {
        return Ok(());
    }
    let s = shared(&app);
    let cfg = s.config();
    let old = {
        let mut g = s.inner.lock().unwrap();
        let t = g.todos.iter_mut().find(|t| t.id == id).ok_or("找不到這筆待辦")?;
        let old = t.clone();
        let mut v = serde_json::to_value(&*t).map_err(|e| e.to_string())?;
        for (k, val) in &patch {
            v[k.as_str()] = val.clone();
        }
        if let Some(done) = patch.get("done").and_then(Value::as_bool) {
            v["doneAt"] = if done { Value::String(now_iso()) } else { Value::Null };
        }
        *t = serde_json::from_value::<Todo>(v).map_err(|e| e.to_string())?.normalized();
        g.pending += 1;
        old
    };
    emit(&app);

    let body = Value::Object(patch);
    let path = format!("/api/todos/{id}");
    let r = api::send(&s.client, &cfg, Method::PATCH, &path, Some(&body), None).await;
    let server: Option<Todo> = r.data.clone().and_then(|v| serde_json::from_value(v).ok());
    let fail = failure(&r).map(|m| (r.offline(), m));
    let id2 = id.clone();
    finish(
        &app,
        fail,
        move |g| {
            if let Some(t) = server {
                g.replace(&id, Some(t));
            }
        },
        move |g| g.replace(&id2, Some(old)),
    )
}

/// 整份取代標籤資料夾
#[tauri::command]
pub async fn set_folders(app: AppHandle, folders: Vec<Folder>) -> Result<(), String> {
    let s = shared(&app);
    let cfg = s.config();
    let old = {
        let mut g = s.inner.lock().unwrap();
        g.pending += 1;
        std::mem::replace(&mut g.folders, folders.clone())
    };
    emit(&app);

    let body = serde_json::json!({ "folders": folders });
    let r = api::send(&s.client, &cfg, Method::PUT, "/api/folders", Some(&body), None).await;
    let server: Option<Vec<Folder>> = r.data.as_ref().and_then(|v| v.get("folders")).cloned().and_then(|v| serde_json::from_value(v).ok());
    let fail = failure(&r).map(|m| (r.offline(), m));
    finish(
        &app,
        fail,
        move |g| {
            if let Some(f) = server {
                g.folders = f;
            }
        },
        move |g| g.folders = old,
    )
}

/// 先從畫面上隱藏；DELETE_DELAY 之內呼叫 undo_delete 就不會真的刪除
#[tauri::command]
pub async fn delete_todo(app: AppHandle, id: String) -> Result<(), String> {
    if id.starts_with("tmp-") {
        return Ok(());
    }
    let s = shared(&app);
    s.inner.lock().unwrap().hidden.insert(id.clone());
    emit(&app);

    tokio::time::sleep(DELETE_DELAY).await;

    let (idx, todo, relinked) = {
        let mut g = s.inner.lock().unwrap();
        if !g.hidden.remove(&id) {
            return Ok(()); // 已復原
        }
        let Some(idx) = g.todos.iter().position(|t| t.id == id) else {
            return Ok(());
        };
        let t = g.todos.remove(idx);
        // 刪掉中間一步時，雲端會把前後接起來；本機先跟著改，失敗時再改回來
        let mut relinked = Vec::new();
        for next in g.todos.iter_mut().filter(|n| n.after_id.as_ref() == Some(&t.id)) {
            next.after_id = t.after_id.clone();
            relinked.push(next.id.clone());
        }
        g.pending += 1;
        (idx, t, relinked)
    };
    emit(&app);

    let cfg = s.config();
    let path = format!("/api/todos/{id}");
    let r = api::send(&s.client, &cfg, Method::DELETE, &path, None, None).await;
    // 404：別處已經刪掉了，也算成功
    let fail = if r.status == 404 { None } else { failure(&r).map(|m| (r.offline(), m)) };
    finish(&app, fail, |_| {}, move |g| {
        for next in g.todos.iter_mut().filter(|n| relinked.contains(&n.id)) {
            next.after_id = Some(todo.id.clone());
        }
        let i = idx.min(g.todos.len());
        g.todos.insert(i, todo);
    })
}

#[tauri::command]
pub fn undo_delete(app: AppHandle, id: String) {
    shared(&app).inner.lock().unwrap().hidden.remove(&id);
    emit(&app);
}

/// 結束程式前，把還在等待復原期限的刪除送出去
pub async fn flush_deletes(app: &AppHandle) {
    let s = shared(app);
    let ids: Vec<String> = s.inner.lock().unwrap().hidden.drain().collect();
    let cfg = s.config();
    for id in ids {
        let path = format!("/api/todos/{id}");
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            api::send(&s.client, &cfg, Method::DELETE, &path, None, None),
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn todo(v: Value) -> Todo {
        serde_json::from_value::<Todo>(v).unwrap().normalized()
    }

    #[test]
    fn old_cloud_tag_becomes_tags() {
        let t = todo(json!({ "id": "a", "tag": "微積分", "due": null, "dueTime": "09:00" }));
        assert_eq!(t.tags, ["微積分"]);
        assert_eq!(t.tag.as_deref(), Some("微積分"));
        assert_eq!(t.due_time, None);
    }

    #[test]
    fn tag_is_first_of_tags() {
        let t = todo(json!({ "id": "a", "tags": ["考試", "微積分"], "tag": "微積分", "due": "2030-01-02", "dueTime": "09:00" }));
        assert_eq!(t.tag.as_deref(), Some("考試"));
        assert_eq!(t.due_time.as_deref(), Some("09:00"));
    }

    #[test]
    fn pair_tags_fills_the_other_field() {
        let mut m = json!({ "tags": ["a", "b"] }).as_object().unwrap().clone();
        pair_tags(&mut m);
        assert_eq!(m["tag"], json!("a"));
        let mut m = json!({ "tags": [] }).as_object().unwrap().clone();
        pair_tags(&mut m);
        assert_eq!(m["tag"], Value::Null);
        let mut m = json!({ "tag": "x" }).as_object().unwrap().clone();
        pair_tags(&mut m);
        assert_eq!(m["tags"], json!(["x"]));
        let mut m = json!({ "tag": null }).as_object().unwrap().clone();
        pair_tags(&mut m);
        assert_eq!(m["tags"], json!([]));
        let mut m = json!({ "title": "t" }).as_object().unwrap().clone();
        pair_tags(&mut m);
        assert!(!m.contains_key("tags") && !m.contains_key("tag"));
    }
}
