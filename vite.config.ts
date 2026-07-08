import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Build three separate entry points for the Chrome extension:
 *   - background.js  (service worker)
 *   - content.js     (content script)
 *   - popup/popup.html (popup page — keeps its own CSS/JS)
 *
 * No CRXJS needed — plain Vite multi-entry works perfectly.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content:    resolve(__dirname, "src/content.ts"),
        popup:      resolve(__dirname, "src/popup/popup.html"),
      },
      output: {
        // Keep filenames predictable (no hashes) so manifest.json can reference them
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
    // Don't minify for easier debugging in dev
    minify: false,
    // Target modern Chrome
    target: "chrome120",
  },
});
