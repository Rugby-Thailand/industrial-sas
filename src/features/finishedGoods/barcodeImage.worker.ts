import { decodeBarcodeBitmap } from "./barcodeImagePipeline";
import type { BarcodeImageTarget, BarcodeImageError } from "./barcodeImage";
import type { BarcodeCrop } from "./barcodeDecoder";

self.onmessage = async (
  event: MessageEvent<{
    file: File;
    target: BarcodeImageTarget;
    wasmUrl: string;
    crop?: BarcodeCrop;
  }>,
) => {
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  const { data } = event;
  let image: ImageBitmap | undefined;
  let cropped: ImageBitmap | undefined;
  try {
    const wasmUrl = new URL("/barcode/zxing_reader.wasm", self.location.origin)
      .href;
    if (data.wasmUrl !== wasmUrl) {
      self.postMessage({ error: "DECODER" satisfies BarcodeImageError });
      return;
    }
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined"
    ) {
      self.postMessage({ error: "UNAVAILABLE" satisfies BarcodeImageError });
      return;
    }
    try {
      image = await createImageBitmap(data.file);
    } catch {
      self.postMessage({ error: "IMAGE" satisfies BarcodeImageError });
      return;
    }
    if (image.width * image.height > 16_000_000) {
      self.postMessage({ error: "PIXELS" satisfies BarcodeImageError });
      return;
    }
    if (data.crop) {
      const { x, y, width, height } = data.crop;
      if (
        ![x, y, width, height].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0 ||
        x >= 1 ||
        y >= 1
      ) {
        self.postMessage({ error: "IMAGE" satisfies BarcodeImageError });
        return;
      }
      const left = Math.floor(x * image.width),
        top = Math.floor(y * image.height);
      cropped = await createImageBitmap(
        image,
        left,
        top,
        Math.max(
          1,
          Math.min(image.width - left, Math.round(width * image.width)),
        ),
        Math.max(
          1,
          Math.min(image.height - top, Math.round(height * image.height)),
        ),
      );
    }
    self.postMessage({
      result: await decodeBarcodeBitmap(cropped ?? image, data.target, wasmUrl),
    });
  } catch {
    self.postMessage({ error: "DECODER" satisfies BarcodeImageError });
  } finally {
    cropped?.close();
    image?.close();
  }
};
