import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), vue(), svelte()],
  build: {
    rollupOptions: {
      input: { react: "react.html", vue: "vue.html", svelte: "svelte.html", html: "index.html" },
    },
  },
});
