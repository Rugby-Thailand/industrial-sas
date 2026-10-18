// Local-only TopGold live-camera replay server (second Kiro agent, mobile follow-up).
// Separate port and raw directory so the static Kiro harness on 3192 is untouched.
// Labels stay server-side: the browser receives only image ids and the scan target.
import { createServer } from "vite";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = process.cwd();
const dataset =
  process.env.TOPGOLD_DATASET ||
  "/Users/macbook/Downloads/TopGold_2569-10-10_ถึง_2569-10-16";
const port = Number(process.env.MOBILE_BENCH_PORT || 3193);
const rawDir = resolve(
  root,
  "docs/reviews/assets/topgold-scanning-2026-10-16/mobile/raw",
);
await mkdir(rawDir, { recursive: true });

const manifest = JSON.parse(
  await readFile(resolve(dataset, "รายการไฟล์.json"), "utf8"),
);
const seen = new Set();
const rows = [];
for (const row of manifest) {
  let buffer;
  try {
    buffer = await readFile(resolve(dataset, row.path));
  } catch {
    continue; // Absent files are excluded from the actual denominator.
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (seen.has(sha256)) continue;
  seen.add(sha256);
  rows.push({ ...row, sha256 });
}

const json = (res, value) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};

const server = await createServer({
  configFile: false,
  root,
  logLevel: "warn",
  resolve: { alias: { "@": resolve(root, "src") } },
  optimizeDeps: {
    entries: [
      "scripts/topgold-scan-benchmark/mobile/runner.js",
      "scripts/topgold-scan-benchmark/mobile/wasm.worker.js",
    ],
  },
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [
    {
      name: "mobile-local-dataset",
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          try {
            if (url.pathname === "/__mobile") {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<title>TopGold live-camera replay</title><pre id="status">Loading</pre>' +
                  '<script type="module" src="/scripts/topgold-scan-benchmark/mobile/runner.js"></script>',
              );
            } else if (url.pathname === "/__manifest") {
              // No filenames, text labels or expected values reach the decoder.
              json(
                res,
                rows.map((r) => ({
                  id: r.index,
                  target: r.category.startsWith("1_") ? "LOCATION" : "TICKET",
                })),
              );
            } else if (/^\/__image\/\d+$/.test(url.pathname)) {
              const id = Number(url.pathname.split("/").at(-1));
              const row = rows.find((r) => r.index === id);
              if (!row) {
                res.statusCode = 404;
                res.end();
                return;
              }
              res.setHeader("Content-Type", "image/jpeg");
              res.setHeader("Cache-Control", "no-store");
              res.end(await readFile(resolve(dataset, row.path)));
            } else if (url.pathname === "/__result" && req.method === "POST") {
              const run = url.searchParams.get("run") || "";
              if (!/^[a-z0-9-]{1,40}$/.test(run)) throw Error("Bad run name");
              const chunks = [];
              let bytes = 0;
              for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 2_000_000) throw Error("Too large");
                chunks.push(chunk);
              }
              const row = JSON.parse(Buffer.concat(chunks).toString());
              await appendFile(
                resolve(rawDir, `${run}.jsonl`),
                JSON.stringify(row) + "\n",
              );
              res.end("saved");
            } else next();
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `TopGold mobile replay: http://127.0.0.1:${port}/__mobile (${rows.length} unique images)`,
);
