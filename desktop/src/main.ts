import "./app.css";
import { mount } from "svelte";
import { disableContextMenu } from "./lib/contextmenu";
import { store } from "@deskdo/core/store.svelte";
import Main from "./windows/Main.svelte";

// 停用 WebView 的右鍵選單（需要右鍵的元件自己處理）
disableContextMenu();
await store.init();
mount(Main, { target: document.getElementById("app")! });
