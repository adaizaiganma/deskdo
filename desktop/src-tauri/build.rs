fn main() {
    // 和 core 一樣，測試版（DESKDO_CHANNEL=beta）要重新編譯
    println!("cargo:rerun-if-env-changed=DESKDO_CHANNEL");
    tauri_build::build()
}
