import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { photoPreviewUrl } from "../../scripts/topgold-scan-benchmark/mobile/photo-url.mjs";

const read = (file: string) => readFileSync(resolve(file), "utf8");
const require = createRequire(import.meta.url);
const origin = "https://preview.example";

describe("benchmark photo URL boundary", () => {
  it("preserves locally created image object URLs", () => {
    const url = `blob:${origin}/85f76e2f-7617-491a-bf02-13643d5479d6`;
    expect(photoPreviewUrl(url, origin)).toBe(url);
  });

  it.each([
    "https://attacker.example/photo.jpg",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "blob:https://attacker.example/photo",
    "blob:null/photo",
  ])("rejects a non-local image URL %s", (url) => {
    expect(() => photoPreviewUrl(url, origin)).toThrow();
  });

  it("encodes URL metacharacters before image property assignment", () => {
    const encoded = photoPreviewUrl(`blob:${origin}/<img src="x">`, origin);
    expect(encoded).toBe(`blob:${origin}/%3Cimg%20src=%22x%22%3E`);
  });
});

describe("benchmark barcode workers", () => {
  const workers = [
    "scripts/topgold-scan-benchmark/mobile/wasm.worker.js",
    "scripts/topgold-scan-benchmark/kiro/variants.worker.js",
  ];
  function worker(file: string) {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const self = {
      location: { origin },
      postMessage: vi.fn(),
      onmessage: null as
        null | ((event: { origin: string; data: unknown }) => Promise<void>),
    };
    const source = ts.transpileModule(read(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    runInNewContext(source, {
      self,
      exports: {},
      require: () => ({ prepareZXingModule: prepare }),
      importScripts: vi.fn(),
      performance,
    });
    return { self, prepare };
  }

  it.each(workers)(
    "rejects a foreign origin before decoding in %s",
    async (file) => {
      const { self, prepare } = worker(file);
      const data = new Proxy(
        {},
        {
          get: () => {
            throw new Error("untrusted data accessed");
          },
        },
      );
      await self.onmessage!({ origin: "https://attacker.example", data });
      expect(prepare).not.toHaveBeenCalled();
      expect(self.postMessage).not.toHaveBeenCalled();
    },
  );

  it.each(workers)(
    "accepts dedicated-worker and same-origin initialization in %s",
    async (file) => {
      const { self, prepare } = worker(file);
      for (const sender of ["", origin]) {
        await self.onmessage!({
          origin: sender,
          data: { cmd: "init", wasmUrl: `${origin}/barcode/zxing_reader.wasm` },
        });
      }
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(self.postMessage).toHaveBeenCalledTimes(2);
    },
  );
});

it("returns a fixed benchmark HTTP error without exposing parser or stack details", async () => {
  const file = "scripts/product-barcode-benchmark/server.mjs";
  let handler: (request: unknown, response: unknown) => Promise<void>;
  const source = ts.transpileModule(
    read(file).replaceAll(
      "import.meta.url",
      JSON.stringify(pathToFileURL(resolve(file)).href),
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await runInNewContext(`(async () => { ${source} })()`, {
    exports: {},
    require: (name: string) => {
      if (name === "node:http")
        return {
          createServer: (callback: typeof handler) => {
            handler = callback;
            return { listen: vi.fn() };
          },
        };
      if (name === "node:fs/promises")
        return { readFile: vi.fn().mockResolvedValue("[]") };
      return require(name);
    },
    process: { env: {} },
    URL,
    Buffer,
  });
  const response = { writeHead: vi.fn(), end: vi.fn() };
  await handler!(
    {
      url: "/results/regression",
      method: "POST",
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("{private malformed input");
      },
    },
    response,
  );
  expect(response.writeHead).toHaveBeenCalledWith(500);
  expect(response.end).toHaveBeenCalledWith("Benchmark request failed");
});
