import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const source = resolve(process.env.AUDIT_SOURCE_ROOT ?? repository);
const port = Number(process.env.AUDIT_PORT ?? 3290);
const stub = (file) => resolve(root, "stubs", file);
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^convex\/react$/, replacement: stub("convex-react.ts") },
      { find: /^@clerk\/nextjs$/, replacement: stub("clerk.tsx") },
      { find: /^next-intl\/server$/, replacement: stub("intl-server.ts") },
      { find: /^next\/navigation$/, replacement: stub("next-navigation.ts") },
      { find: /^next\/link$/, replacement: stub("i18n-navigation.tsx") },
      {
        find: /^@\/i18n\/navigation$/,
        replacement: stub("i18n-navigation.tsx"),
      },
      {
        find: /^.*\/WorkspaceProvider(?:\.tsx)?$/,
        replacement: stub("workspace.ts"),
      },
      {
        find: /^.*\/HrAccessProvider(?:\.tsx)?$/,
        replacement: stub("hr.ts"),
      },
      { find: /^@\//, replacement: `${resolve(source, "src")}/` },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_APP_URL": JSON.stringify("http://localhost:3290"),
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    fs: { allow: [repository, source] },
  },
});
