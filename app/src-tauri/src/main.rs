// 正式版不要跳出主控台視窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deskdo_lib::run()
}
