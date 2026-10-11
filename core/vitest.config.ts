import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// .svelte.ts（用到 $state 的模組）要經過 svelte 編譯
export default defineConfig({
  plugins: [svelte()],
  test: { include: ["src/**/*.test.ts"] },
});
