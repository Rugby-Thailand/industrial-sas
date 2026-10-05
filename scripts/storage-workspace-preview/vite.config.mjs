import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { "@": resolve(repository, "src") } },
  define: {
    "process.env.NEXT_PUBLIC_APP_URL": JSON.stringify("http://localhost:3190"),
  },
  server: {
    host: "127.0.0.1",
    port: 3190,
    strictPort: true,
    fs: { allow: [repository] },
  },
});
