import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { playgroundServer } from "./server/playground-server";

export default defineConfig({
  plugins: [react(), vue(), svelte(), playgroundServer()],
  // The SDK is linked from ../../javascript, which has its own copies of these for its build.
  resolve: { dedupe: ["react", "react-dom", "vue", "svelte"] },
  // The SDK's Svelte components ship as source, so Vite compiles them instead of pre-bundling.
  optimizeDeps: { exclude: ["@calmlens/sdk"] },
  build: { target: "es2022" },
  esbuild: { target: "es2022" },
});
