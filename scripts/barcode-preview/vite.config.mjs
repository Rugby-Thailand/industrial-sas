import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const manifestPath = process.env.BARCODE_PRIVATE_MANIFEST;
const photos =
  manifestPath && existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : [];
const aliases = [
  "convex/react",
  "@/components/system/QueryGate",
  "@/hooks/useDraftKey",
  "@/hooks/useCanManage",
  "@/lib/uploadthing",
  "@/i18n/navigation",
  "next/image",
];
export default defineConfig({
  root: here,
  cacheDir: resolve(root, "node_modules/.vite-barcode-preview"),
  publicDir: resolve(root, "public"),
  plugins: [
    react(),
    {
      name: "private-barcode-photos",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/fixture-writer.wasm") {
            res.setHeader("Content-Type", "application/wasm");
            res.end(
              readFileSync(
                resolve(
                  root,
                  "node_modules/zxing-wasm/dist/writer/zxing_writer.wasm",
                ),
              ),
            );
            return;
          }
          if (req.url === "/private-corpus.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify(
                photos.map(({ name, expectedProduct, expectedJob }) => ({
                  name,
                  expectedProduct,
                  expectedJob,
                })),
              ),
            );
            return;
          }
          const photo = photos.find(
            (p) => req.url === `/private-photos/${p.name}`,
          );
          if (!photo) return next();
          res.setHeader("Content-Type", "image/jpeg");
          res.end(readFileSync(photo.sourcePath));
        });
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom", "next-intl"],
    alias: [
      ...aliases.map((find) => ({
        find,
        replacement: resolve(here, "adapters.tsx"),
      })),
      { find: "@", replacement: resolve(root, "src") },
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 3219,
    strictPort: true,
    fs: { allow: [root] },
  },
});
