import { fileURLToPath } from "node:url";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.config.ts";

// The panel reuses the UI's Sync screen, which imports library code that needs the UI's Node shims.
const shim = (name: string) => fileURLToPath(new URL(`../ui/src/shims/${name}.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        panel: fileURLToPath(new URL("./src/panel.html", import.meta.url)),
        fullApp: fileURLToPath(new URL("./src/full-app.html", import.meta.url)),
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "node:fs/promises": shim("fs"),
      "node:path": shim("path"),
      "node:os": shim("os"),
      "csv-parse/sync": "csv-parse/browser/esm/sync",
    },
  },
  define: { "process.env": "{}" },
  server: { fs: { allow: [".."] } },
});
