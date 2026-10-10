import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "../support/fixtures";

// Vite verification cannot prove Next's worker bundling or public-asset routing.
test("production barcode WASM is public and the compiled worker decodes pixels", async ({
  page,
  request,
}) => {
  const response = await request.get("/barcode/zxing_reader.wasm", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/wasm");
  expect([...new Uint8Array(await response.body()).slice(0, 4)]).toEqual([
    0, 97, 115, 109,
  ]);

  const files = readdirSync(".next/static/chunks").filter((name) =>
    name.endsWith(".js"),
  );
  const sources = files.map((name) => ({
    name,
    source: readFileSync(`.next/static/chunks/${name}`, "utf8"),
  }));
  const workerModule = sources.find(
    ({ source }) =>
      source.includes("OffscreenCanvas") && source.includes('error:"PIXELS"'),
  );
  expect(workerModule, "built barcode worker module").toBeDefined();
  const runtime = sources.find(
    ({ source }) =>
      source.includes("otherChunks:") &&
      source.includes(`static/chunks/${workerModule!.name}`),
  );
  const bootstrap = sources.find(({ source }) =>
    source.includes("Missing worker bootstrap config"),
  );
  expect(runtime, "Next worker runtime").toBeDefined();
  expect(bootstrap, "Next worker entrypoint").toBeDefined();

  await page.goto("/en/sign-in");
  const result = await page.evaluate(
    async ({ png, bootstrap, chunks }) => {
      const params = encodeURIComponent(
        JSON.stringify([chunks, "", "/_next/", "", ""]),
      );
      const worker = new Worker(
        `/_next/static/chunks/${bootstrap}?params=${params}`,
      );
      const file = new File(
        [Uint8Array.from(atob(png), (char) => char.charCodeAt(0))],
        "demo-product.png",
        { type: "image/png" },
      );
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ error: "timeout" });
        }, 20_000);
        worker.onmessage = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve({ error: event.message });
        };
        worker.postMessage({
          file,
          target: "productBarcodeText",
          wasmUrl: `${location.origin}/barcode/zxing_reader.wasm`,
        });
      });
    },
    {
      png: readFileSync("tests/fixtures/barcode/demo-product.png").toString(
        "base64",
      ),
      bootstrap: bootstrap!.name,
      chunks: [workerModule!.name, runtime!.name].map(
        (name) => `/_next/static/chunks/${name}`,
      ),
    },
  );
  expect(result).toMatchObject({
    result: { codes: ["DEMO-PRODUCT"], reviewRequired: false },
  });
});
