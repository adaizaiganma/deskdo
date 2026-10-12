import "./app.css";
import { mount } from "svelte";
import { disableContextMenu } from "./lib/contextmenu";
import { store } from "@deskdo/core/store.svelte";
import { theme } from "./lib/theme.svelte";
import Widget from "./windows/Widget.svelte";

disableContextMenu();
theme.init();
await store.init();
mount(Widget, { target: document.getElementById("app")! });
