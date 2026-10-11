import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const stub = (file) => resolve(root, "stubs", file);

/**
 * Loopback-only visual fixture for the AI usage report. Production
 * components are imported unchanged; only the Convex client, Clerk and
 * Next.js routing modules are replaced by in-memory stand-ins (no network,
 * no identity, no writes).
 */
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^convex\/react$/, replacement: stub("convex-react.ts") },
      { find: /^@clerk\/nextjs$/, replacement: stub("clerk.ts") },
      { find: /^next\/navigation$/, replacement: stub("next-navigation.ts") },
      { find: /^next\/link$/, replacement: stub("next-navigation.ts") },
      {
        find: /^@\/i18n\/navigation$/,
        replacement: stub("i18n-navigation.tsx"),
      },
      { find: /^@\//, replacement: `${resolve(repository, "src")}/` },
      { find: /^@tests\//, replacement: `${resolve(repository, "tests")}/` },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3191,
    strictPort: true,
    fs: { allow: [repository] },
  },
});
