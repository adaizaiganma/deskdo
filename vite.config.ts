/// <reference types="vitest/config" />
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

// 只有一個頁面：main.html（手機上的主畫面；主畫面小工具是 Kotlin 寫的，見 src-tauri/gen/android）
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "chrome120",
    rollupOptions: { input: { main: page("main") } },
  },
  test: { include: ["src/**/*.test.ts"] },
});
