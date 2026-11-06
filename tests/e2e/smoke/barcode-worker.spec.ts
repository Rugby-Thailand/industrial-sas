import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "../support/fixtures";

const cases = [
  {
    name: "product",
    path: "tests/fixtures/barcode/demo-product.png",
    type: "image/png",
    target: "productBarcodeText",
    expected: ["DEMO-PRODUCT"],
    crop: undefined,
  },
  {
    name: "glare location fallback",
    path: "tests/fixtures/barcode-photos/location-18.webp",
    type: "image/webp",
    target: "LOCATION",
    expected: ["F2-L28-18"],
    crop: undefined,
  },
  {
    name: "noisy location geometry",
    path: "tests/fixtures/barcode-photos/location-3-11.png",
    type: "image/png",
    target: "LOCATION",
    expected: ["F1-L3-11"],
    crop: undefined,
  },
  {
    name: "empty location crop",
    path: "tests/fixtures/barcode/demo-product.png",
    type: "image/png",
    target: "LOCATION",
    expected: [],
    crop: { x: 0, y: 0, width: 1, height: 0.03 },
  },
] as const;
for (const fixture of cases) {
  // Vite verification cannot prove Next's worker bundling or public-asset routing.
  test(`production barcode WASM is public and compiled worker handles ${fixture.name}`, async ({
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
    // Read the complete list emitted for this worker's factory. Next 16.4
    // separates runtime registration from the runtime implementation, so
    // `otherChunks` alone omits a required script and leaves messages unhandled.
    const entry = sources
      .flatMap(({ source }) =>
        [
          ...source.matchAll(
            /\.f\("(static\/chunks\/turbopack-worker-[^"]+\.js)",(\[[^\]]*\])\)/g,
          ),
        ].map((match) => ({
          bootstrap: match[1]!,
          chunks: JSON.parse(match[2]!) as string[],
        })),
      )
      .find(({ chunks }) =>
        chunks.includes(`static/chunks/${workerModule!.name}`),
      );
    expect(entry, "compiled barcode worker factory").toBeDefined();

    await page.goto("/en/sign-in");
    const result = await page.evaluate(
      async ({ png, bootstrap, chunks, target, crop, type }) => {
        const params = encodeURIComponent(
          JSON.stringify([chunks, "", "/_next/", "", ""]),
        );
        const worker = new Worker(`/_next/${bootstrap}?params=${params}`);
        const file = new File(
          [Uint8Array.from(atob(png), (char) => char.charCodeAt(0))],
          "demo-product.png",
          { type },
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
            target,
            crop,
            wasmUrl: `${location.origin}/barcode/zxing_reader.wasm`,
          });
        });
      },
      {
        png: readFileSync(fixture.path).toString("base64"),
        target: fixture.target,
        crop: fixture.crop,
        type: fixture.type,
        bootstrap: entry!.bootstrap,
        // Match the emitted worker factory's reversal before bootstrap loading.
        chunks: entry!.chunks.map((path) => `/_next/${path}`).reverse(),
      },
    );
    expect(result).toMatchObject({
      result: { codes: fixture.expected, reviewRequired: false },
    });
  });
}
