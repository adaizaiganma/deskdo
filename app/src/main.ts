import "./app.css";
import { mount } from "svelte";
import { disableContextMenu } from "./lib/contextmenu";
import { store } from "./lib/store.svelte";
import Main from "./windows/Main.svelte";

disableContextMenu();
await store.init();
mount(Main, { target: document.getElementById("app")! });
