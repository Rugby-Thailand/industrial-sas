import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const read = (file: string) => readFileSync(resolve(file), "utf8");
const require = createRequire(import.meta.url);
const origin = "https://preview.example";

function preview(directory: string, query: string, sources: string[]) {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = read(`${directory}/index.html`);
  const context = {
    document: doc,
    location: new URL(query, origin),
    window: { addEventListener: vi.fn(), scrollTo: vi.fn() },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    URL,
    URLSearchParams,
    crypto,
    setTimeout,
    clearTimeout,
  };
  runInNewContext(
    sources.map((file) => read(`${directory}/${file}`)).join("\n"),
    context,
  );
  return doc;
}

describe("archived preview input boundaries", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "does not dispatch the inherited screen or variant %s",
    (key) => {
      const doc = preview(
        "src/components/shell/_prototype/minimal-app",
        `/?page=${key}&variant=${key}`,
        ["reference-data.js", "app.js"],
      );
      expect(doc.getElementById("main")?.dataset.page).toBe("scan");
      expect(doc.documentElement.dataset.variant).toBe("A");
      expect(doc.querySelector("h1")).not.toBeNull();
    },
  );

  it("keeps valid preview selections", () => {
    const doc = preview(
      "src/components/shell/_prototype/minimal-app",
      "/?page=records&variant=B&lang=en",
      ["reference-data.js", "app.js"],
    );
    expect(doc.getElementById("main")?.dataset.page).toBe("records");
    expect(doc.documentElement.dataset.variant).toBe("B");
  });

  it("does not copy an arbitrary language control value into HTML or links", () => {
    const directory = "src/features/finishedGoods/jobScan/_prototype/barcode";
    const doc = document.implementation.createHTMLDocument();
    doc.documentElement.innerHTML = read(`${directory}/index.html`);
    runInNewContext(read(`${directory}/app.js`).replace(/^import .*;\n/, ""), {
      document: doc,
      location: new URL("/?lang=en", origin),
      URLSearchParams,
      window: { addEventListener: vi.fn() },
      clearTimeout,
    });
    const select = doc.getElementById("language") as HTMLSelectElement;
    const option = doc.createElement("option");
    option.value = 'en"><img id="injected" src=x>';
    select.append(option);
    select.value = option.value;
    select.dispatchEvent(new Event("change"));
    expect(doc.documentElement.lang).toBe("th");
    expect(doc.getElementById("injected")).toBeNull();
    expect(doc.querySelector(".preview-bar a")?.getAttribute("href")).toContain(
      "lang=th",
    );
  });
});

describe("archived barcode workers", () => {
  const workers = [
    "src/features/finishedGoods/jobScan/_prototype/barcode/reader-worker.js",
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

  it.each(workers.slice(1))(
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
