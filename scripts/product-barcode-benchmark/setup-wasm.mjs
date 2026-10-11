import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const destination = fileURLToPath(
  new URL("../../.cache/product-barcode-benchmark/", import.meta.url),
);
const integrity =
  "jmxXvTCR/qZxMz2XwR6V+nL2BlDTD1aux7ZWSH9BV77TG9u4k0VyHba/NCCHBHJ60Wg6VV0QL/SMlJczKhJI4w==";
const response = await fetch(
  "https://registry.npmjs.org/zxing-wasm/-/zxing-wasm-3.1.5.tgz",
);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha512").update(bytes).digest("base64") !== integrity)
  throw new Error("Package integrity mismatch");
await mkdir(destination, { recursive: true });
const archive = join(destination, "zxing-wasm-3.1.5.tgz");
await writeFile(archive, bytes);
execFileSync("tar", ["-xzf", archive, "-C", destination]);
console.log(
  "Prepared zxing-wasm 3.1.5 in .cache; project dependencies unchanged.",
);
