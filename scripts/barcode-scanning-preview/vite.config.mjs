import { defineConfig } from "vite";
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
  plugins: [react()],
  resolve: { alias: { "@": resolve(repository, "src") } },
  server: {
    host: "127.0.0.1",
    port: 3199,
    strictPort: true,
    fs: { allow: [repository] },
  },
});
