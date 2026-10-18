import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const dataset =
  process.env.TOPGOLD_DATASET ??
  "/Users/macbook/Downloads/TopGold_2569-10-10_ถึง_2569-10-16/";
const evidence = resolve(
  root,
  "docs/reviews/assets/topgold-scanning-2026-10-16",
);
const manifest = JSON.parse(
  await readFile(resolve(evidence, "manifest.json"), "utf8"),
);
const audit = JSON.parse(
  await readFile(resolve(evidence, "dataset-audit.json"), "utf8"),
);
const preferred = [
  50, 52, 57, 60, 73, 77, 81, 99, 112, 131, 137, 150, 164, 165,
];
const photos = new Map();
for (const row of manifest.rows) {
  if (row.category !== "2_เอกสาร_Package" || !row.job_no || row.duplicate_of)
    continue;
  const path = resolve(dataset, row.path);
  if (!path.startsWith(resolve(dataset) + "/"))
    throw new Error("Invalid dataset path");
  await stat(path);
  const dimensions = audit.rows.find((item) => item.id === row.index);
  photos.set(row.index, {
    path,
    id: row.index,
    width: dimensions.width,
    height: dimensions.height,
  });
}
const orderedIds = [
  ...preferred.filter((id) => photos.has(id)),
  ...[...photos.keys()].filter((id) => !preferred.includes(id)),
];
const catalog = orderedIds.map((id) => {
  const { width, height } = photos.get(id);
  return {
    id,
    width,
    height,
    recommended: preferred.includes(id),
    src: `/image/${id}`,
  };
});
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/display.js", ["display.js", "text/javascript; charset=utf-8"]],
  ["/display.css", ["display.css", "text/css; charset=utf-8"]],
]);

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const path = new URL(request.url, "http://127.0.0.1:3195").pathname;
    if (path === "/api/specimens") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        request.method === "HEAD" ? undefined : JSON.stringify(catalog),
      );
      return;
    }
    const match = /^\/image\/(\d+)$/.exec(path);
    if (match && photos.has(Number(match[1]))) {
      const photo = photos.get(Number(match[1]));
      const info = await stat(photo.path);
      response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": info.size,
      });
      if (request.method === "HEAD") response.end();
      else
        createReadStream(photo.path)
          .on("error", () => response.destroy())
          .pipe(response);
      return;
    }
    if (staticFiles.has(path)) {
      const [filename, type] = staticFiles.get(path);
      const body = await readFile(resolve(here, filename));
      response.writeHead(200, {
        "Content-Type": type,
        "Content-Length": body.length,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    response.writeHead(404).end("Not found");
  } catch (error) {
    console.error(error.message);
    if (!response.headersSent) response.writeHead(500);
    response.end("Unable to load specimen");
  }
});

server.listen(3195, "127.0.0.1", () => {
  console.log(
    `Job display ready: http://127.0.0.1:3195/?id=50 (${catalog.length} original Job photos)`,
  );
});
