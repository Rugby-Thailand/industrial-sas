import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readBarcodeImage, validateBarcodeFile } from "./barcodeImage";
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("location", { origin: "https://app.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const image = () => new File(["pixels"], "label.jpg", { type: "image/jpeg" });
it("aborting terminates the actual service worker and rejects rather than returning a code", async () => {
  const controller = new AbortController();
  const promise = readBarcodeImage(image(), "TICKET", controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
});
it("does not create a worker for an already cancelled scan", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readBarcodeImage(image(), "LOCATION", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances).toHaveLength(0);
});
it("has an outer deadline even when the worker never responds", async () => {
  vi.useFakeTimers();
  const promise = readBarcodeImage(
    image(),
    "TICKET",
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(20000);
  await expect(promise).resolves.toMatchObject({ codes: [] });
  expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
});
it("loads only the local WASM and cleans up after decoder failures", async () => {
  const promise = readBarcodeImage(
    image(),
    "LOCATION",
    new AbortController().signal,
  );
  const worker = FakeWorker.instances[0]!;
  expect(worker.postMessage.mock.calls[0]![0].wasmUrl).toBe(
    "https://app.test/barcode/zxing_reader.wasm",
  );
  worker.onmessage!({ data: { error: "DECODER" } });
  await expect(promise).rejects.toMatchObject({ code: "DECODER" });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("rejects empty and oversized files before worker allocation", () => {
  expect(() =>
    validateBarcodeFile(new File([], "empty.png", { type: "image/png" })),
  ).toThrow("SIZE");
  const file = image();
  Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
  expect(() => validateBarcodeFile(file)).toThrow("SIZE");
});
it("the served WASM matches the exact installed decoder version", () => {
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  expect(hash(readFileSync("public/barcode/zxing_reader.wasm"))).toBe(
    hash(readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm")),
  );
});

it("settles once even if a duplicate message arrives after cancellation", async () => {
  const controller = new AbortController();
  const promise = readBarcodeImage(image(), "LOCATION", controller.signal);
  const worker = FakeWorker.instances[0]!;
  controller.abort();
  worker.onmessage!({ data: { error: "DECODER" } });
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("cleans up when posting to the worker throws", async () => {
  vi.stubGlobal(
    "Worker",
    class extends FakeWorker {
      override postMessage = vi.fn(() => {
        throw new Error("clone failed");
      });
    },
  );
  await expect(
    readBarcodeImage(image(), "TICKET", new AbortController().signal),
  ).rejects.toMatchObject({ code: "DECODER" });
  expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
});
