import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ decode: vi.fn(), bitmap: vi.fn() }));
vi.mock("./barcodeImagePipeline", () => ({
  decodeBarcodeBitmap: mocks.decode,
}));
const scope = {
  location: { origin: "https://app.test" },
  postMessage: vi.fn(),
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
};
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("self", scope);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", mocks.bitmap);
  mocks.bitmap.mockResolvedValue({ width: 100, height: 100, close: vi.fn() });
  mocks.decode.mockResolvedValue({ codes: ["DEMO"], reviewRequired: false });
  await import("./barcodeImage.worker");
});
afterEach(() => vi.unstubAllGlobals());
const data = (wasmUrl = "https://app.test/barcode/zxing_reader.wasm") => ({
  file: new File(["pixels"], "label.jpg", { type: "image/jpeg" }),
  target: "LOCATION",
  wasmUrl,
});
it("ignores messages claiming a foreign origin", async () => {
  await scope.onmessage!(
    new MessageEvent("message", {
      data: data(),
      origin: "https://foreign.test",
    }),
  );
  expect(mocks.bitmap).not.toHaveBeenCalled();
  expect(scope.postMessage).not.toHaveBeenCalled();
});
it("rejects external decoder URLs before decoding", async () => {
  await scope.onmessage!(
    new MessageEvent("message", {
      data: data("https://foreign.test/reader.wasm"),
    }),
  );
  expect(scope.postMessage).toHaveBeenCalledWith({ error: "DECODER" });
  expect(mocks.bitmap).not.toHaveBeenCalled();
});
it("accepts the dedicated worker channel and disposes decoded pixels", async () => {
  await scope.onmessage!(new MessageEvent("message", { data: data() }));
  expect(mocks.decode).toHaveBeenCalled();
  expect(scope.postMessage).toHaveBeenCalledWith({
    result: { codes: ["DEMO"], reviewRequired: false },
  });
  expect(
    (await mocks.bitmap.mock.results[0]!.value).close,
  ).toHaveBeenCalledOnce();
});
