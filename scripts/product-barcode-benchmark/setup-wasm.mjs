import { copyFile, mkdir, readFile } from "node:fs/promises";

// Reuse the frozen-install dependency instead of downloading and extracting
// another executable package from the network.
const packageRoot = new URL(
  "../../../",
  import.meta.resolve("zxing-wasm/reader"),
);
const { version } = JSON.parse(
  await readFile(new URL("package.json", packageRoot), "utf8"),
);
if (version !== "3.1.5") throw new Error("Expected pinned zxing-wasm 3.1.5");
const destination = new URL(
  "../../.cache/product-barcode-benchmark/package/",
  import.meta.url,
);
for (const relative of [
  "dist/iife/reader/index.js",
  "dist/reader/zxing_reader.wasm",
]) {
  const target = new URL(relative, destination);
  await mkdir(new URL("./", target), { recursive: true });
  await copyFile(new URL(relative, packageRoot), target);
}
console.log("Prepared the installed zxing-wasm 3.1.5 in .cache.");
