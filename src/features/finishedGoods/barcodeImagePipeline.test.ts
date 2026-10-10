import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeBarcodeBitmap } from "./barcodeImagePipeline";
const decoder = vi.hoisted(() => ({ read: vi.fn(), classic: vi.fn() }));
vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: vi.fn(),
  readBarcodes: decoder.read,
}));
vi.mock("./barcodeDecoder", () => ({
  createBarcodeReader: vi.fn(),
  decodeBarcodeCanvas: decoder.classic,
}));
const canvases: { width: number; height: number }[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  canvases.length = 0;
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        canvases.push(this);
      }
      getContext() {
        return { drawImage: vi.fn(), getImageData: vi.fn() };
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const symbol = (text: string, format = "Code128", isValid = true) => ({
  text,
  format,
  isValid,
});
const image = { width: 640, height: 480, close: vi.fn() };
it("a classic singleton cannot suppress another checksum-valid Code128 location", async () => {
  decoder.read.mockResolvedValue([symbol("ZONE-A"), symbol("ZONE-B")]);
  decoder.classic.mockResolvedValue(["ZONE-A"]);
  const result = await decodeBarcodeBitmap(image, "LOCATION", "/reader.wasm");
  expect(result.codes).toEqual(["ZONE-A", "ZONE-B"]);
  expect(
    canvases.every((canvas) => canvas.width === 1 && canvas.height === 1),
  ).toBe(true);
});
it("preserves multiple QR locations when classic sees one", async () => {
  decoder.read.mockResolvedValue([
    symbol("ZONE-A", "QRCode"),
    symbol("ZONE-B", "QRCode"),
    symbol("INVALID", "QRCode", false),
  ]);
  decoder.classic.mockResolvedValue(["ZONE-A"]);
  expect(
    (await decodeBarcodeBitmap(image, "LOCATION", "/reader.wasm")).codes,
  ).toEqual(["ZONE-A", "ZONE-B"]);
});
it("uses the established geometry reader to correct a noisy singleton Code128 read", async () => {
  decoder.read.mockResolvedValue([symbol("NOISY")]);
  decoder.classic.mockResolvedValue(["ZONE-A"]);
  expect(
    (await decodeBarcodeBitmap(image, "LOCATION", "/reader.wasm")).codes,
  ).toEqual(["ZONE-A"]);
});
