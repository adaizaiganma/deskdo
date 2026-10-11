import "./app.css";
import { mount } from "svelte";
import { store } from "@deskdo/core/store.svelte";
import Main from "./windows/Main.svelte";

// 手機版的樣式（app.css 和各元件裡的 html.mobile）；長按要能叫出系統的選取、貼上選單，所以不停用右鍵選單
document.documentElement.classList.add("mobile");
await store.init();
mount(Main, { target: document.getElementById("app")! });
