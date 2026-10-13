// 介面在 upstream/mobile（@deskdo/mobile，和網頁版共用）；字型只有 App 帶，網頁版用系統內建的
import "@fontsource-variable/noto-sans-tc";
import "@deskdo/mobile/app.css";
import { mount } from "svelte";
import { i18n } from "@deskdo/core/i18n.svelte";
import { store } from "@deskdo/core/store.svelte";
import Main from "@deskdo/mobile/windows/Main.svelte";

// 系統導覽列的高度：網頁畫到導覽列底下，底部的東西要讓開（MainActivity.kt，之後有變化會直接改這個變數）
const insets = (window as { DeskdoInsets?: { navInset(): number } }).DeskdoInsets;
const nav = insets?.navInset() ?? 0;
if (nav) document.documentElement.style.setProperty("--nav-inset", `${nav}px`);

i18n.init();
await store.init();
mount(Main, { target: document.getElementById("app")! });
