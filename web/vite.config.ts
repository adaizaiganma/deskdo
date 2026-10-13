import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const desktop = JSON.parse(readFileSync(fileURLToPath(new URL("../desktop/package.json", import.meta.url)), "utf8"));
const publicDir = fileURLToPath(new URL("./public", import.meta.url));

/** 比這個大的檔案（opencc 的字典）用到才快取，不在安裝時就下載 */
const PRECACHE_LIMIT = 300 * 1024;

/**
 * 產生 sw.js：安裝時把網頁的檔案都存起來，離線也打得開（待辦資料由 web/backend.ts 存在 localStorage）。
 * 版本號取自所有檔案的雜湊，網頁一改 sw.js 就跟著變，瀏覽器才會換新、清掉舊的快取。
 */
function serviceWorker(): Plugin {
  return {
    name: "deskdo-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const hash = createHash("sha256");
      const files: string[] = [];
      for (const [name, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        const source = item.type === "chunk" ? item.code : item.source;
        hash.update(name).update(source);
        if (name !== "index.html" && source.length <= PRECACHE_LIMIT) files.push(name);
      }
      for (const name of readdirSync(publicDir).sort()) {
        hash.update(name).update(readFileSync(`${publicDir}/${name}`));
        files.push(name);
      }
      const version = hash.digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: swSource(version, files) });
    },
  };
}

function swSource(version: string, files: string[]): string {
  return `// 由 web/vite.config.ts 產生
const CACHE = "deskdo-${version}";
const PRECACHE = ${JSON.stringify(files)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", ...PRECACHE])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// 網頁本身（index.html）先用網路，連不上才用快取；其他檔案先用快取。API、配對不經過這裡。
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/app/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./")));
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((resp) => {
          if (resp.ok && url.pathname.startsWith("/app/assets/")) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        }),
    ),
  );
});
`;
}

// 網頁版：建置到 dist/，由 worker/scripts/embed-web.mjs 嵌進 Worker，在 /app 提供
export default defineConfig({
  base: "/app/",
  plugins: [svelte(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(desktop.version) },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    // 開發時 API 和配對轉給本機的 wrangler dev（worker 目錄的 npm run dev）
    proxy: { "/api": "http://127.0.0.1:8787", "/app/pair": "http://127.0.0.1:8787", "/app/logout": "http://127.0.0.1:8787" },
  },
  build: {
    target: "es2022",
    // 不需要 modulepreload 的 polyfill（會在 index.html 放一段 inline script，CSP 不允許）
    modulePreload: { polyfill: false },
  },
});
