//! 除了 Tauri 本身的建置，還把 Worker（打包好的 JS）、migrations、版本號和相容性設定嵌進 exe，
//! 讓設定精靈不需要 wrangler 就能部署到使用者的 Cloudflare 帳號。

use std::{env, fs, path::PathBuf};

fn main() {
    embed_worker();
    tauri_build::build()
}

fn embed_worker() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let worker = manifest.join("../../worker").canonicalize().expect("找不到 worker 目錄");
    let bundle = worker.join("dist/index.js");
    let migrations_dir = worker.join("migrations");
    let version_ts = worker.join("src/version.ts");
    let wrangler = worker.join("wrangler.jsonc");

    for p in [&bundle, &migrations_dir, &version_ts, &wrangler] {
        println!("cargo:rerun-if-changed={}", p.display());
    }
    // 測試版：DESKDO_CHANNEL=beta 時打開 cfg(deskdo_beta)（見 config.rs 的 BETA）
    println!("cargo:rerun-if-env-changed=DESKDO_CHANNEL");
    println!("cargo:rustc-check-cfg=cfg(deskdo_beta)");
    if env::var("DESKDO_CHANNEL").as_deref() == Ok("beta") {
        println!("cargo:rustc-cfg=deskdo_beta");
    }
    // oauth.rs 用 option_env! 讀，換了要重新編譯
    println!("cargo:rerun-if-env-changed=DESKDO_CF_CLIENT_ID");
    if !bundle.exists() {
        panic!(
            "找不到 {}。請先打包 Worker：npm --prefix ../worker run bundle（npm run tauri dev/build 會自動執行）",
            bundle.display()
        );
    }

    let version_src = fs::read_to_string(&version_ts).unwrap();
    let version: u32 = version_src
        .lines()
        .find_map(|l| l.trim().strip_prefix("export const WORKER_VERSION = "))
        .and_then(|v| v.trim_end_matches(';').trim().parse().ok())
        .expect("worker/src/version.ts 裡找不到 WORKER_VERSION");

    let wrangler_src = fs::read_to_string(&wrangler).unwrap();
    let compat_date = json_string_after(&wrangler_src, "\"compatibility_date\"").expect("wrangler.jsonc 缺少 compatibility_date");
    let compat_flags: Vec<String> = wrangler_src
        .split("\"compatibility_flags\"")
        .nth(1)
        .and_then(|rest| rest.split_once('[').map(|(_, r)| r))
        .and_then(|rest| rest.split_once(']').map(|(l, _)| l))
        .map(|list| list.split(',').map(|f| f.trim().trim_matches('"').to_string()).filter(|f| !f.is_empty()).collect())
        .unwrap_or_default();

    let mut migrations: Vec<PathBuf> = fs::read_dir(&migrations_dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "sql"))
        .collect();
    migrations.sort();

    let mut out = String::new();
    out += &format!("pub const WORKER_JS: &[u8] = include_bytes!({:?});\n", bundle.display().to_string());
    out += &format!("pub const WORKER_VERSION: u32 = {version};\n");
    out += &format!("pub const COMPATIBILITY_DATE: &str = {compat_date:?};\n");
    out += &format!("pub const COMPATIBILITY_FLAGS: &[&str] = &{compat_flags:?};\n");
    out += "/// (檔名, SQL)，依檔名排序；檔名與 wrangler 的 d1_migrations 紀錄相容\n";
    out += "pub const MIGRATIONS: &[(&str, &str)] = &[\n";
    for m in &migrations {
        let name = m.file_name().unwrap().to_string_lossy();
        out += &format!("    ({name:?}, include_str!({:?})),\n", m.display().to_string());
    }
    out += "];\n";
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("embedded.rs"), out).unwrap();
}

/// 在 JSONC 文字中找 `key` 後面的第一個字串值
fn json_string_after(src: &str, key: &str) -> Option<String> {
    let rest = src.split(key).nth(1)?;
    let start = rest.find('"')? + 1;
    let end = start + rest[start..].find('"')?;
    Some(rest[start..end].to_string())
}
