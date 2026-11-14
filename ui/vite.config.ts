import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

// The UI reuses the library's parsing and ConfigSchema. Node built-ins they import are shimmed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
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
