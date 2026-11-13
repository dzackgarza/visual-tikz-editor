import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// The standalone page; standalone/server.ts builds it with this config.
export default defineConfig({
  root: path.join(import.meta.dirname, "standalone"),
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Browser coverage (scripts/coverage.mjs) maps each chunk back to its sources.
    sourcemap: true,
    rollupOptions: {
      input: {
        app: path.join(import.meta.dirname, "standalone/index.html"),
      },
    },
    // The page loads once from 127.0.0.1; Vue, CodeMirror and Viewer.js in one
    // chunk cost no network round trips, so splitting them gains nothing.
    chunkSizeWarningLimit: 1024,
  },
});
