/// <reference types="vitest/config" />
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

// 兩個頁面：main.html（系統匣開啟的主視窗）、widget.html（釘在桌面的小工具）
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "chrome120",
    rollupOptions: { input: { main: page("main"), widget: page("widget") } },
  },
  test: { include: ["src/**/*.test.ts"] },
});
