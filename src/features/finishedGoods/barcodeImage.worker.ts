import { decodeBarcodeBitmap } from "./barcodeImagePipeline";
import type { BarcodeImageTarget, BarcodeImageError } from "./barcodeImage";

self.onmessage = async ({
  data,
}: MessageEvent<{
  file: File;
  target: BarcodeImageTarget;
  wasmUrl: string;
}>) => {
  let image: ImageBitmap | undefined;
  try {
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
    self.postMessage({
      result: await decodeBarcodeBitmap(image, data.target, data.wasmUrl),
    });
  } catch {
    self.postMessage({ error: "DECODER" satisfies BarcodeImageError });
  } finally {
    image?.close();
  }
};
