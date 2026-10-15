//! 讓桌面小工具像真正的桌面元件：永遠排在桌面（放桌面圖示的那個視窗）的正上方。
//!
//! - 桌面圖示通常在 Progman 裡；但換桌布的淡入動畫、桌布投影片、Wallpaper Engine 之類的程式
//!   會讓 Explorer 把圖示搬到另一個頂層 WorkerW。這時 Win+D 拉上來的是那個 WorkerW，
//!   若還跟著 Progman 排就會被它蓋住，所以每次都找出真正放圖示的視窗
//! - 平常桌面在 Z-order 最底層，所以小工具在所有視窗下面；被點擊時也不會跑到前面
//! - 按 Win+D 時 Windows 會把桌面拉到上層，小工具跟著排到桌面上面，所以不會被蓋住
//! - 設成工具視窗：不出現在工作列和 Alt+Tab
//!
//! tao 的 always_on_bottom 會把視窗硬塞到 HWND_BOTTOM，Win+D 時就被桌面蓋住，所以不使用。

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Accessibility::{SetWinEventHook, HWINEVENTHOOK},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

static WIDGET: AtomicIsize = AtomicIsize::new(0);
static DESKTOP: AtomicIsize = AtomicIsize::new(0);
/// 只有自己呼叫 SetWindowPos 重新排序時才允許改變 Z-order
static RESTACKING: AtomicBool = AtomicBool::new(false);

const SUBCLASS_ID: usize = 0x7d0;
/// 每秒檢查一次位置（保險，例如其他程式改了 Z-order）
const TIMER_CHECK: usize = 1;
/// 前景視窗切換後，等 Shell 動畫結束再排一次
const TIMER_SETTLE: usize = 2;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

unsafe fn has_icons(h: HWND) -> bool {
    !FindWindowExW(h, std::ptr::null_mut(), wide("SHELLDLL_DefView").as_ptr(), std::ptr::null()).is_null()
}

/// 放桌面圖示（SHELLDLL_DefView）的頂層視窗：Progman 或某個 WorkerW
unsafe fn desktop() -> HWND {
    let cached = DESKTOP.load(Ordering::Relaxed) as HWND;
    // 圖示可能隨時被搬走，Explorer 重新啟動後也會換成新的視窗
    if !cached.is_null() && has_icons(cached) {
        return cached;
    }
    let mut h = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
    if h.is_null() || !has_icons(h) {
        let worker = wide("WorkerW");
        let mut w = FindWindowExW(std::ptr::null_mut(), std::ptr::null_mut(), worker.as_ptr(), std::ptr::null());
        while !w.is_null() && !has_icons(w) {
            w = FindWindowExW(std::ptr::null_mut(), w, worker.as_ptr(), std::ptr::null());
        }
        if !w.is_null() {
            h = w;
        }
    }
    DESKTOP.store(h as isize, Ordering::Relaxed);
    h
}

fn is_topmost(h: HWND) -> bool {
    unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0 }
}

/// 把小工具排到桌面正上方；已經在那裡就什麼都不做
unsafe fn restack(h: HWND) {
    let pm = desktop();
    if pm.is_null() {
        return;
    }
    // 中間隔著看不見的視窗沒關係
    let mut above = GetWindow(pm, GW_HWNDPREV);
    while !above.is_null() && above != h && IsWindowVisible(above) == 0 {
        above = GetWindow(above, GW_HWNDPREV);
    }
    if above == h {
        return;
    }
    let prev = GetWindow(pm, GW_HWNDPREV);
    // 插在置頂視窗後面會讓自己也變成置頂，所以這時改用 HWND_TOP（非置頂視窗中的最上層）
    let after = if prev.is_null() || is_topmost(prev) { HWND_TOP } else { prev };
    RESTACKING.store(true, Ordering::Relaxed);
    SetWindowPos(h, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    RESTACKING.store(false, Ordering::Relaxed);
}

unsafe extern "system" fn subclass_proc(
    h: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            // 點擊啟用、ShowWindow 等都會想把視窗拉到最上層，一律擋下
            let pos = &mut *(lp as *mut WINDOWPOS);
            if !RESTACKING.load(Ordering::Relaxed) {
                pos.flags |= SWP_NOZORDER;
            }
        }
        WM_STYLECHANGING if wp as i32 == GWL_EXSTYLE => {
            // tao 每次顯示／隱藏都會重寫整組樣式，這裡把工具視窗樣式補回去
            let ss = &mut *(lp as *mut STYLESTRUCT);
            ss.styleNew = (ss.styleNew | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
        }
        WM_TIMER if wp == TIMER_CHECK || wp == TIMER_SETTLE => {
            if wp == TIMER_SETTLE {
                KillTimer(h, TIMER_SETTLE);
            }
            restack(h);
            return 0;
        }
        WM_NCDESTROY => {
            KillTimer(h, TIMER_CHECK);
            KillTimer(h, TIMER_SETTLE);
            RemoveWindowSubclass(h, Some(subclass_proc), SUBCLASS_ID);
            WIDGET.store(0, Ordering::Relaxed);
        }
        _ => {}
    }
    DefSubclassProc(h, msg, wp, lp)
}

/// 任何視窗變成前景時（包含 Win+D 讓桌面變成前景）重新排序
unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let h = WIDGET.load(Ordering::Relaxed) as HWND;
    if h.is_null() {
        return;
    }
    restack(h);
    SetTimer(h, TIMER_SETTLE, 300, None);
}

/// 在視窗第一次顯示前呼叫（需要在主執行緒）
pub fn attach(hwnd: isize) {
    let h = hwnd as HWND;
    WIDGET.store(hwnd, Ordering::Relaxed);
    unsafe {
        SetWindowSubclass(h, Some(subclass_proc), SUBCLASS_ID, 0);
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, ex); // 觸發 WM_STYLECHANGING 套用工具視窗樣式
        SetWindowPos(h, std::ptr::null_mut(), 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        SetTimer(h, TIMER_CHECK, 1000, None);
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            std::ptr::null_mut(),
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        restack(h);
    }
}

/// 顯示小工具後呼叫，避免它先出現在最上層一下
pub fn restack_now(hwnd: isize) {
    unsafe { restack(hwnd as HWND) }
}
