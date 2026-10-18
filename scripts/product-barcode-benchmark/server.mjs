import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { format } from "prettier";

const root = fileURLToPath(new URL("../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));
const evidence = join(
  root,
  "docs/reviews/assets/product-barcode-non-ai-2026-10-10",
);
const manifest = JSON.parse(
  await readFile(join(evidence, "manifest.json"), "utf8"),
);
const port = Number(process.env.BARCODE_BENCHMARK_PORT || 3187);
const routes = new Map([
  ["/controls.js", [join(here, "controls.js"), "text/javascript"]],
  ["/", [join(here, "index.html"), "text/html"]],
  ["/benchmark.js", [join(here, "benchmark.js"), "text/javascript"]],
  [
    "/zxing.js",
    [
      join(root, "node_modules/@zxing/browser/umd/zxing-browser.min.js"),
      "text/javascript",
    ],
  ],
  [
    "/zxing-wasm.js",
    [
      join(
        root,
        ".cache/product-barcode-benchmark/package/dist/iife/reader/index.js",
      ),
      "text/javascript",
    ],
  ],
  [
    "/zxing_reader.wasm",
    [
      join(
        root,
        ".cache/product-barcode-benchmark/package/dist/reader/zxing_reader.wasm",
      ),
      "application/wasm",
    ],
  ],
]);
for (const item of manifest)
  routes.set(`/images/${item.name}`, [item.sourcePath, "image/jpeg"]);

createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (req.method === "GET" && path === "/manifest.json") {
      res.setHeader("Content-Type", "application/json");
      // Expectations remain on the server: acquisition cannot see or use them.
      res.end(
        JSON.stringify(manifest.map(({ name, sha256 }) => ({ name, sha256 }))),
      );
      return;
    }
    if (req.method === "POST" && /^\/results\/[a-z0-9-]+$/.test(path)) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error("Result too large");
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString());
      result.harnessSha256 = createHash("sha256")
        .update(await readFile(join(here, "benchmark.js")))
        .digest("hex");
      await writeFile(
        join(evidence, `${path.split("/").at(-1)}.json`),
        await format(JSON.stringify(result), { parser: "json" }),
      );
      res.end("saved");
      return;
    }
    const route = req.method === "GET" && routes.get(path);
    if (!route) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", route[1]);
    res.setHeader("Cache-Control", "no-store");
    res.end(await readFile(route[0]));
  } catch {
    res.writeHead(500);
    res.end("Benchmark request failed");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Barcode benchmark: http://127.0.0.1:${port}`),
);
