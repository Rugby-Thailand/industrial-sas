import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL("./", import.meta.url));
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const manifest = JSON.parse(
  await readFile(
    join(
      root,
      "docs/reviews/assets/product-barcode-non-ai-2026-10-10/manifest.json",
    ),
    "utf8",
  ),
);
const routes = new Map([
  ["/", [join(here, "index.html"), "text/html"]],
  ["/index.html", [join(here, "index.html"), "text/html"]],
  ["/style.css", [join(here, "style.css"), "text/css"]],
  ["/app.js", [join(here, "app.js"), "text/javascript"]],
  ["/decoder.js", [join(here, "decoder.js"), "text/javascript"]],
  ["/reader-worker.js", [join(here, "reader-worker.js"), "text/javascript"]],
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
for (const font of [
  "geist-latin.woff2",
  "geist-mono-latin.woff2",
  "noto-sans-thai.ttf",
])
  routes.set(`/fonts/${font}`, [
    join(root, "docs/design-sheet/fonts", font),
    font.endsWith("ttf") ? "font/ttf" : "font/woff2",
  ]);
for (const image of manifest)
  routes.set(`/images/${image.name}`, [image.sourcePath, "image/jpeg"]);
createServer(async (req, res) => {
  const route =
    req.method === "GET" &&
    routes.get(new URL(req.url, "http://localhost").pathname);
  if (!route) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    res.setHeader("Content-Type", route[1]);
    res.setHeader("Cache-Control", "no-store");
    res.end(await readFile(route[0]));
  } catch {
    res.writeHead(500);
    res.end("Preview asset unavailable. Run the benchmark WASM setup first.");
  }
}).listen(3202, "127.0.0.1", () =>
  console.log("Barcode UI preview: http://127.0.0.1:3202/"),
);
