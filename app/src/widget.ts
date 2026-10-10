import "./app.css";
import { mount } from "svelte";
import { disableContextMenu } from "./lib/contextmenu";
import { store } from "./lib/store.svelte";
import Widget from "./windows/Widget.svelte";

disableContextMenu();
await store.init();
mount(Widget, { target: document.getElementById("app")! });
