import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const referenceFixture = resolve(
  repository,
  "output/workspace-qa/f1-f2-fixture.json",
);
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { "@": resolve(repository, "src") } },
  define: {
    "process.env.NEXT_PUBLIC_APP_URL": JSON.stringify("http://localhost:3190"),
    __STORAGE_REFERENCE_LAYOUTS__: existsSync(referenceFixture)
      ? readFileSync(referenceFixture, "utf8")
      : "null",
  },
  server: {
    host: "127.0.0.1",
    port: 3190,
    strictPort: true,
    fs: { allow: [repository] },
  },
});
