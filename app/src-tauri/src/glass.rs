//! 桌面小工具的毛玻璃背景。
//!
//! 不用 window-vibrancy 的 apply_acrylic：在 Windows 11 上它走系統 Acrylic（DWMSBT_TRANSIENTWINDOW），
//! 會忽略色調、色調很濃，而且視窗不是作用中時會變成實心——桌面小工具幾乎都不是作用中，所以幾乎看不到桌布。
//! 這裡直接用 SetWindowCompositionAttribute 的 Acrylic：非作用中也保持毛玻璃，色調濃淡可以自己控制。

use std::ffi::c_void;
use windows_sys::Win32::{
    Foundation::{BOOL, HWND},
    Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND},
    System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
};

const WCA_ACCENT_POLICY: u32 = 19;
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    gradient_color: u32, // 0xAABBGGRR
    animation_id: u32,
}

#[repr(C)]
struct CompositionData {
    attribute: u32,
    data: *mut c_void,
    size: usize,
}

type SetWca = unsafe extern "system" fn(HWND, *mut CompositionData) -> BOOL;

fn set_wca() -> Option<SetWca> {
    unsafe {
        let user32 = GetModuleHandleW(windows_sys::w!("user32.dll"));
        if user32.is_null() {
            return None;
        }
        let f = GetProcAddress(user32, windows_sys::s!("SetWindowCompositionAttribute"))?;
        Some(std::mem::transmute::<unsafe extern "system" fn() -> isize, SetWca>(f))
    }
}

/// 套用毛玻璃；opacity 0–1 是色調的濃度（0 = 幾乎只有模糊的桌布）。回傳是否成功。
pub fn apply(hwnd: isize, dark: bool, opacity: f64) -> bool {
    let Some(f) = set_wca() else { return false };
    let (r, g, b) = if dark { (28u32, 29, 34) } else { (246u32, 246, 244) };
    // 色調 alpha 為 0 時部分 Windows 版本會整個不模糊，所以保留一點
    let a = (8.0 + opacity.clamp(0.0, 1.0) * 232.0).round() as u32;
    let mut policy = AccentPolicy {
        state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
        flags: 0,
        gradient_color: (a << 24) | (b << 16) | (g << 8) | r,
        animation_id: 0,
    };
    let mut data = CompositionData {
        attribute: WCA_ACCENT_POLICY,
        data: &mut policy as *mut _ as *mut c_void,
        size: std::mem::size_of::<AccentPolicy>(),
    };
    unsafe {
        let ok = f(hwnd as HWND, &mut data) != 0;
        // Windows 11 圓角（Windows 10 沒有這個屬性，失敗也沒關係）
        let corner = DWMWCP_ROUND;
        DwmSetWindowAttribute(
            hwnd as HWND,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner as *const _ as *const c_void,
            std::mem::size_of_val(&corner) as u32,
        );
        ok
    }
}
