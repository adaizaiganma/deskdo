//! 系統匣圖示：圓角方塊加勾號，右下角顯示「今天到期＋逾期」的件數，有逾期時變紅。

use crate::{config::APP_TITLE, store::Snapshot, windows};
use std::sync::{Mutex, OnceLock};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tiny_skia::{FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};

const TRAY_ID: &str = "main";
const SIZE: u32 = 32;

pub struct TrayItems {
    pub widget: CheckMenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
    /// 「檢查更新」；下載好新版後變成「重新啟動以更新到 x.y.z」
    pub update: MenuItem<Wry>,
    badge: Mutex<Option<(u32, bool)>>,
}

pub fn create(app: &AppHandle, show_widget: bool, autostart: bool) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "開啟待辦事項", true, None::<&str>)?;
    let widget = CheckMenuItem::with_id(app, "widget", "桌面小工具", true, show_widget, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "立即同步", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "設定…", true, None::<&str>)?;
    let auto = CheckMenuItem::with_id(app, "autostart", "開機時啟動", true, autostart, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "檢查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &widget,
            &sync,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &auto,
            &update,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(render(None))
        .tooltip(APP_TITLE)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => windows::show_main(app, None),
            "widget" => {
                let visible = app.state::<TrayItems>().widget.is_checked().unwrap_or(true);
                windows::set_widget_visible(app.clone(), visible);
            }
            "sync" => crate::store::shared(app).wake(true),
            "settings" => windows::show_main(app, Some("settings")),
            "autostart" => {
                let on = app.state::<TrayItems>().autostart.is_checked().unwrap_or(false);
                let _ = windows::set_autostart(app.clone(), on);
            }
            "update" => crate::updater::tray_clicked(app),
            "quit" => windows::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                windows::show_main(tray.app_handle(), None);
            }
        })
        .build(app)?;

    // 開發版和測試版不自動更新，選單裡就不放這一項
    if cfg!(debug_assertions) || crate::config::BETA {
        let _ = menu.remove(&update);
    }
    app.manage(TrayItems { widget, autostart: auto, update, badge: Mutex::new(None) });
    Ok(())
}

pub fn update(app: &AppHandle, snap: &Snapshot) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let today = snap.today.as_str();
    // 前一步還沒完成的步驟還不能做，不算進去
    let open_ids: std::collections::HashSet<&str> = snap.todos.iter().filter(|t| !t.done).map(|t| t.id.as_str()).collect();
    let open: Vec<_> = snap
        .todos
        .iter()
        .filter(|t| !t.done && !t.after_id.as_deref().is_some_and(|p| open_ids.contains(p)))
        .collect();
    let overdue = open.iter().filter(|t| t.due.as_deref().is_some_and(|d| d < today)).count() as u32;
    let due_today = open.iter().filter(|t| t.due.as_deref() == Some(today)).count() as u32;

    let badge = Some((overdue + due_today, overdue > 0));
    let mut last = items.badge.lock().unwrap();
    if *last != badge {
        *last = badge;
        let _ = tray.set_icon(Some(render(badge)));
    }

    let mut tip = format!("{APP_TITLE}：{} 項未完成", open.len());
    if due_today > 0 {
        tip += &format!("\n今天到期 {due_today} 項");
    }
    if overdue > 0 {
        tip += &format!("\n逾期 {overdue} 項");
    }
    match snap.status {
        "offline" => tip += "\n（離線）",
        "error" => tip += &format!("\n（{}）", snap.message),
        _ => {}
    }
    let _ = tray.set_tooltip(Some(tip));
}

fn font() -> Option<&'static fontdue::Font> {
    static FONT: OnceLock<Option<fontdue::Font>> = OnceLock::new();
    FONT.get_or_init(|| {
        let dir = std::env::var_os("WINDIR").map(std::path::PathBuf::from).unwrap_or_else(|| "C:\\Windows".into());
        ["segoeuib.ttf", "arialbd.ttf"].iter().find_map(|name| {
            let bytes = std::fs::read(dir.join("Fonts").join(name)).ok()?;
            fontdue::Font::from_bytes(bytes, fontdue::FontSettings::default()).ok()
        })
    })
    .as_ref()
}

fn rounded_rect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.quad_to(x + w, y, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.quad_to(x + w, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.quad_to(x, y + h, x, y + h - r);
    pb.line_to(x, y + r);
    pb.quad_to(x, y, x + r, y);
    pb.close();
    pb.finish()
}

fn render(badge: Option<(u32, bool)>) -> Image<'static> {
    let s = SIZE as f32;
    let mut pm = Pixmap::new(SIZE, SIZE).expect("pixmap");
    let mut paint = Paint::default();
    paint.anti_alias = true;

    paint.set_color_rgba8(37, 99, 235, 255);
    if let Some(p) = rounded_rect(s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.22) {
        pm.fill_path(&p, &paint, FillRule::Winding, Transform::identity(), None);
    }

    let mut pb = PathBuilder::new();
    pb.move_to(s * 0.28, s * 0.52);
    pb.line_to(s * 0.44, s * 0.68);
    pb.line_to(s * 0.74, s * 0.34);
    if let Some(p) = pb.finish() {
        paint.set_color_rgba8(255, 255, 255, 255);
        let stroke = Stroke { width: s * 0.11, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Default::default() };
        pm.stroke_path(&p, &paint, &stroke, Transform::identity(), None);
    }

    if let Some((n, alert)) = badge.filter(|(n, _)| *n > 0) {
        let d = s * 0.62;
        let (cx, cy) = (s - d / 2.0, s - d / 2.0);
        if alert {
            paint.set_color_rgba8(226, 59, 59, 255);
        } else {
            paint.set_color_rgba8(30, 30, 30, 255);
        }
        if let Some(c) = PathBuilder::from_circle(cx, cy, d / 2.0) {
            pm.fill_path(&c, &paint, FillRule::Winding, Transform::identity(), None);
        }
        if let Some(font) = font() {
            let text = n.min(99).to_string();
            let px = d * if text.len() == 1 { 0.72 } else { 0.58 };
            draw_text(&mut pm, font, &text, px, cx, cy);
        }
    }

    // tiny-skia 是 premultiplied alpha，系統匣圖示要一般的 RGBA
    let rgba: Vec<u8> = pm
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    Image::new_owned(rgba, SIZE, SIZE)
}

/// 以 (cx, cy) 為中心畫白色文字
fn draw_text(pm: &mut Pixmap, font: &fontdue::Font, text: &str, px: f32, cx: f32, cy: f32) {
    let glyphs: Vec<_> = text.chars().map(|ch| font.rasterize(ch, px)).collect();
    let width: f32 = glyphs.iter().map(|(m, _)| m.advance_width).sum();
    let cap = glyphs.iter().map(|(m, _)| m.height as f32 + m.ymin as f32).fold(0.0, f32::max);
    let baseline = cy + cap / 2.0;
    let mut pen = cx - width / 2.0;
    let (w, h) = (pm.width() as i32, pm.height() as i32);
    let data = pm.data_mut();
    for (m, bitmap) in &glyphs {
        let left = (pen + m.xmin as f32).round() as i32;
        let top = (baseline - m.height as f32 - m.ymin as f32).round() as i32;
        for gy in 0..m.height {
            for gx in 0..m.width {
                let (x, y) = (left + gx as i32, top + gy as i32);
                if x < 0 || y < 0 || x >= w || y >= h {
                    continue;
                }
                let a = bitmap[gy * m.width + gx] as f32 / 255.0;
                let i = ((y * w + x) * 4) as usize;
                for c in 0..4 {
                    data[i + c] = (255.0 * a + data[i + c] as f32 * (1.0 - a)).round() as u8;
                }
            }
        }
        pen += m.advance_width;
    }
}
