// 把網頁版（../web/dist，`npm run build -w web` 建置）嵌進 Worker：產生 src/web.generated.ts，由 src/web.ts 在 /app 提供。
// 還沒建置網頁版時產生空的清單（wrangler dev、typecheck 照樣能跑，/app 會說沒有網頁版）；
// 加上 --require 時找不到就失敗，避免發佈出沒有網頁版的雲端。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "../web/dist");
const out = join(root, "src/web.generated.ts");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const TEXT = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt"]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const assets = {};
if (existsSync(join(dist, "index.html"))) {
  for (const file of walk(dist)) {
    const ext = extname(file).toLowerCase();
    const type = TYPES[ext];
    if (!type) throw new Error(`不知道怎麼提供這種檔案：${file}`);
    const data = readFileSync(file);
    const etag = `"${createHash("sha256").update(data).digest("base64url").slice(0, 16)}"`;
    const rel = relative(dist, file).split("\\").join("/");
    assets[rel] = TEXT.has(ext) ? { type, etag, body: data.toString("utf8") } : { type, etag, body: data.toString("base64"), base64: true };
  }
} else if (process.argv.includes("--require")) {
  console.error(`找不到網頁版的建置結果（${dist}）：先在 repo 根目錄執行 npm run build -w web`);
  process.exit(1);
} else {
  console.warn("embed-web: 還沒建置網頁版，/app 會是空的");
}

const header = "// 由 scripts/embed-web.mjs 產生，不要手動修改，也不要提交\n";
const type = "export const ASSETS: Record<string, { type: string; etag: string; body: string; base64?: true }> = ";
writeFileSync(out, header + type + JSON.stringify(assets) + ";\n");
const size = Object.values(assets).reduce((n, a) => n + a.body.length, 0);
console.log(`embed-web: ${Object.keys(assets).length} 個檔案，${(size / 1024).toFixed(0)} KB`);
