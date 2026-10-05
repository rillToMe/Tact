import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

/**
 * The dev server port.
 *
 * Not Vite's default 5173: that is what every other Vite project on the machine
 * uses, so a second one starting up would either fail or, worse, have Tauri
 * attach to the wrong app's page.
 *
 * `strictPort` matters as much as the number. Without it Vite would quietly move
 * to the next free port when this one is busy, and Tauri would sit waiting on a
 * URL nothing is serving. Failing loudly is the useful behaviour.
 *
 * Must match `build.devUrl` in `src-tauri/tauri.conf.json`.
 */
const DEV_PORT = 58080;

/**
 * The port `vite preview` serves the production build on.
 *
 * Separate from the dev port so both can run at once - checking the built output
 * against the dev server is a normal thing to want, and sharing one port would
 * make it impossible.
 */
const PREVIEW_PORT = 61234;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
  preview: {
    port: PREVIEW_PORT,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        settings: resolve(import.meta.dirname, "settings.html"),
      },
    },
  },
});