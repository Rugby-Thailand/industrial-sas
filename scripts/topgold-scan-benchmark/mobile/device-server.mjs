// Standalone local instrument. No Next routes, auth, Convex or production writes.
import { createServer } from "vite";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = Number(process.env.DEVICE_BENCH_PORT || 3194);
const resultDir = resolve(root, "data/private/topgold-device");
const writes = new Map();
const server = await createServer({
  configFile: false,
  root,
  logLevel: "warn",
  resolve: { alias: { "@": resolve(root, "src") } },
  optimizeDeps: {
    entries: [
      "scripts/topgold-scan-benchmark/mobile/device.js",
      "scripts/topgold-scan-benchmark/mobile/wasm.worker.js",
    ],
  },
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [
    {
      name: "topgold-device-test",
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          try {
            if (url.pathname === "/" || url.pathname === "/__device") {
              const html = await readFile(
                resolve(
                  root,
                  "scripts/topgold-scan-benchmark/mobile/device.html",
                ),
                "utf8",
              );
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(await vite.transformIndexHtml(url.pathname, html));
            } else if (
              url.pathname === "/__device-result" &&
              req.method === "POST"
            ) {
              if (
                req.headers.origin &&
                req.headers.origin !== `http://${req.headers.host}`
              ) {
                res.statusCode = 403;
                res.end("Wrong origin");
                return;
              }
              if (
                !req.headers["content-type"]?.startsWith("application/json")
              ) {
                res.statusCode = 415;
                res.end("JSON required");
                return;
              }
              let bytes = 0;
              const chunks = [];
              for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 1_000_000) throw Error("Result too large");
                chunks.push(chunk);
              }
              const row = JSON.parse(Buffer.concat(chunks).toString());
              if (
                !/^[a-f0-9-]{36}$/.test(row.id) ||
                row.schema !== 1 ||
                !Number.isSafeInteger(row.revision) ||
                row.revision < 1 ||
                !Array.isArray(row.symbols)
              ) {
                res.statusCode = 400;
                res.end("Invalid trial");
                return;
              }
              const write = (writes.get(row.id) || Promise.resolve())
                .catch(() => {})
                .then(async () => {
                  await mkdir(resultDir, { recursive: true });
                  const file = resolve(resultDir, `${row.id}.json`);
                  const previous = await readFile(file, "utf8")
                    .then(JSON.parse)
                    .catch((error) => {
                      if (error.code !== "ENOENT") throw error;
                      return null;
                    });
                  if (previous && previous.revision >= row.revision) return;
                  const temporary = `${file}.tmp`;
                  await writeFile(
                    temporary,
                    JSON.stringify(row, null, 2) + "\n",
                  );
                  await rename(temporary, file);
                });
              writes.set(row.id, write);
              try {
                await write;
              } finally {
                if (writes.get(row.id) === write) writes.delete(row.id);
              }
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  saved: true,
                  id: row.id,
                  revision: row.revision,
                }),
              );
            } else next();
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error?.message || error));
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(`TopGold Android test: http://localhost:${port}/`);
console.log(`Results: ${resultDir}`);
console.log("USB: node scripts/topgold-scan-benchmark/android-usb.mjs");
