import "./web.css";
import { useBackend } from "@deskdo/core/backend";
import { i18n } from "@deskdo/core/i18n.svelte";
import { store } from "@deskdo/core/store.svelte";
import { WebBackend } from "@deskdo/core/web/backend";
import { theme } from "deskdo/lib/theme.svelte";
import { mount } from "svelte";
import App from "./App.svelte";

// 資料不經過 Rust：直接呼叫同一個網址的雲端 API
const backend = new WebBackend({ appVersion: __APP_VERSION__ });
useBackend(backend);
// 電腦版介面的深色、淺色（手機版介面跟隨系統）；瀏覽器沒有毛玻璃，一開始就用實心背景
theme.init();
document.documentElement.classList.add("no-effects");
i18n.init();
await store.init();
backend.start();
// 全域樣式（手機版或電腦版的 app.css）由 App.svelte 依螢幕寬度載入
mount(App, { target: document.getElementById("app")! });

// 離線也打得開（加到主畫面之後尤其需要）
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
