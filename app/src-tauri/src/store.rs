//! 待辦資料的本機狀態：輪詢、樂觀更新、失敗時復原。
//! 兩個視窗共用這一份資料；每次變動都會送出 "state" 事件。

use crate::{
    api::{self, ApiResult},
    config::{self, Cache, Config},
    tray,
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashSet,
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::Duration,
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
    pub tag: Option<String>,
    pub priority: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub source: String,
    pub source_ref: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub todos: Vec<Todo>,
    pub today: String,
    /// "syncing" | "ok" | "offline" | "error"
    pub status: &'static str,
    pub message: String,
    pub last_sync: Option<String>,
}

pub struct Inner {
    todos: Vec<Todo>,
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
}

impl Shared {
    pub fn new() -> Self {
        let cache = config::load_cache().unwrap_or_default();
        Self {
            inner: Mutex::new(Inner {
                todos: cache.todos,
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
            todos: self.todos.iter().filter(|t| !self.hidden.contains(&t.id)).cloned().collect(),
            today: self.today(),
            status: self.status,
            message: self.message.clone(),
            last_sync: self.last_sync.clone(),
        }
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
    tray::update(app, &snap);
    let _ = app.emit("state", &snap);
}

// ---- 同步 ----

pub fn start_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let s = shared(&app);
        loop {
            refresh(&app).await;
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
                    config::save_cache(&Cache { today: g.server_today.clone(), todos: g.todos.clone() });
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
pub async fn add_todo(app: AppHandle, fields: Map<String, Value>) -> Result<Todo, String> {
    let title = str_field(&fields, "title").ok_or("標題不能是空的")?;
    let s = shared(&app);
    let cfg = s.config();
    let tmp_id = format!("tmp-{:x}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
    let now = now_iso();
    let local = Todo {
        id: tmp_id.clone(),
        title,
        due: str_field(&fields, "due"),
        tag: str_field(&fields, "tag"),
        priority: str_field(&fields, "priority").unwrap_or_else(|| "normal".into()),
        note: str_field(&fields, "note"),
        created_at: now.clone(),
        updated_at: now,
        source: "manual".into(),
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
    finish(&app, fail, move |g| g.replace(&tmp_id, c2), move |g| g.replace(&id2, None))?;
    Ok(created.unwrap_or_default())
}

#[tauri::command]
pub async fn update_todo(app: AppHandle, id: String, patch: Map<String, Value>) -> Result<(), String> {
    const ALLOWED: [&str; 6] = ["title", "due", "tag", "priority", "note", "done"];
    let patch: Map<String, Value> = patch.into_iter().filter(|(k, _)| ALLOWED.contains(&k.as_str())).collect();
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
        *t = serde_json::from_value(v).map_err(|e| e.to_string())?;
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

    let (idx, todo) = {
        let mut g = s.inner.lock().unwrap();
        if !g.hidden.remove(&id) {
            return Ok(()); // 已復原
        }
        let Some(idx) = g.todos.iter().position(|t| t.id == id) else {
            return Ok(());
        };
        let t = g.todos.remove(idx);
        g.pending += 1;
        (idx, t)
    };
    emit(&app);

    let cfg = s.config();
    let path = format!("/api/todos/{id}");
    let r = api::send(&s.client, &cfg, Method::DELETE, &path, None, None).await;
    // 404：別處已經刪掉了，也算成功
    let fail = if r.status == 404 { None } else { failure(&r).map(|m| (r.offline(), m)) };
    finish(&app, fail, |_| {}, move |g| {
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
