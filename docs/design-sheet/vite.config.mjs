import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Builds only the sheet's React islands into docs/design-sheet/dist.
// - publicDir: false keeps the application's public/ assets out of the output.
// - An empty PostCSS config stops Vite from loading the app's Tailwind
//   PostCSS setup; controls.css is plain, sheet-owned CSS.
// - No `@/` alias: the islands import no application source.
// - The generated, minified bundle is git-ignored but sits inside the lint
//   root; a post-minify banner keeps repository ESLint off build output.
const lintBanner = {
  name: "design-sheet-lint-banner",
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle))
      if (file.type === "chunk")
        file.code = `/* eslint-disable -- generated bundle */\n${file.code}`;
  },
};

export default defineConfig({
  plugins: [react(), lintBanner],
  publicDir: false,
  css: { postcss: { plugins: [] } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./controls.tsx", import.meta.url)),
      name: "DesignSheetControls",
      formats: ["iife"],
      fileName: () => "controls.js",
      cssFileName: "controls",
    },
  },
});
