import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
export default defineConfig({
  root,
  // Both workspace harnesses run together in CI; their dependency graphs must
  // not overwrite each other's optimized-dependency metadata.
  cacheDir: resolve(repository, "node_modules/.vite-barcode-scanning"),
  publicDir: resolve(repository, "tests/fixtures/barcode-photos"),
  plugins: [
    react(),
    {
      name: "local-reader",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/barcode/zxing_reader.wasm") return next();
          res.setHeader("Content-Type", "application/wasm");
          res.end(
            readFileSync(
              resolve(repository, "public/barcode/zxing_reader.wasm"),
            ),
          );
        });
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom", "next-intl"],
    alias: {
      "@": resolve(repository, "src"),
      "next/image": resolve(repository, "scripts/barcode-preview/adapters.tsx"),
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "next-intl",
      "zxing-wasm/reader",
      "@zxing/library",
      "@zxing/browser",
      "convex/server",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3199,
    strictPort: true,
    fs: { allow: [repository] },
  },
});
