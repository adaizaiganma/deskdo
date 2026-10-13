import "@deskdo/mobile/app.css";
import "./web.css";
import { useBackend } from "@deskdo/core/backend";
import { i18n } from "@deskdo/core/i18n.svelte";
import { store } from "@deskdo/core/store.svelte";
import { WebBackend } from "@deskdo/core/web/backend";
import { mount } from "svelte";
import App from "./App.svelte";

// 資料不經過 Rust：直接呼叫同一個網址的雲端 API
const backend = new WebBackend({ appVersion: __APP_VERSION__ });
useBackend(backend);
i18n.init();
await store.init();
backend.start();
mount(App, { target: document.getElementById("app")! });

// 離線也打得開（加到主畫面之後尤其需要）
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
