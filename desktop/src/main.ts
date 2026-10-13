// 字型放在這裡而不是 app.css：網頁版也用 app.css，但不帶字型檔（Worker 放不下）
import "@fontsource-variable/noto-sans-tc";
import "./app.css";
import { mount } from "svelte";
import { disableContextMenu } from "./lib/contextmenu";
import { store } from "@deskdo/core/store.svelte";
import { i18n } from "@deskdo/core/i18n.svelte";
import { theme } from "./lib/theme.svelte";
import Main from "./windows/Main.svelte";

// 停用 WebView 的右鍵選單（需要右鍵的元件自己處理）
disableContextMenu();
theme.init();
i18n.init();
await store.init();
mount(Main, { target: document.getElementById("app")! });
