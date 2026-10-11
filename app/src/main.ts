import "./app.css";
import { mount } from "svelte";
import { disableContextMenu } from "./lib/contextmenu";
import { mobile } from "./lib/platform";
import { store } from "./lib/store.svelte";
import Main from "./windows/Main.svelte";

// 手機上長按要能叫出系統的選取、貼上選單；桌面版停用 WebView 的右鍵選單
if (mobile) document.documentElement.classList.add("mobile");
else disableContextMenu();
await store.init();
mount(Main, { target: document.getElementById("app")! });
