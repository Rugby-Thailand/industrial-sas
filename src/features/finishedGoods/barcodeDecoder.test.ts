import { expect, it } from "vitest";
import {
  barcodeImageProblem,
  decodeBarcodeCanvas,
  linearBarcodeRegions,
  MAX_BARCODE_IMAGE_BYTES,
} from "./barcodeDecoder";

it("isolates offset bars with white margins and ignores blank backgrounds", () => {
  const width = 480,
    height = 320;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  expect(linearBarcodeRegions(data, width, height)).toEqual([]);
  for (let y = 170; y < 230; y++) {
    for (let x = 250; x < 420; x++) {
      if (Math.floor((x - 250) / 2) % 2) continue;
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  const regions = linearBarcodeRegions(data, width, height);
  expect(regions).toHaveLength(1);
  const region = regions[0]!;
  expect(region.x * width).toBeLessThan(250);
  expect((region.x + region.width) * width).toBeGreaterThan(420);
  expect(region.y * height).toBeLessThan(170);
  expect((region.y + region.height) * height).toBeGreaterThan(230);
});

it("validates image types and bounds before decoding", () => {
  expect(
    barcodeImageProblem(
      new File(["photo"], "photo.webp", { type: "image/webp" }),
    ),
  ).toBeUndefined();
  expect(
    barcodeImageProblem(
      new File(["photo"], "photo.gif", { type: "image/gif" }),
    ),
  ).toBe("imageType");
  expect(
    barcodeImageProblem(new File([], "photo.png", { type: "image/png" })),
  ).toBe("imageSize");
  const large = new File(["photo"], "photo.png", { type: "image/png" });
  Object.defineProperty(large, "size", { value: MAX_BARCODE_IMAGE_BYTES + 1 });
  expect(barcodeImageProblem(large)).toBe("imageSize");
});

it("rejects a cancelled decode before loading a reader or accessing the canvas", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    decodeBarcodeCanvas({} as HTMLCanvasElement, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
