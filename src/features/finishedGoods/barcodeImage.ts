import type { BarcodeCrop } from "./barcodeDecoder";

export type BarcodeImageTarget =
  "LOCATION" | "ANY" | "TICKET" | "factoryOrder" | "productBarcodeText";
export type BarcodeImageResult = {
  codes: string[];
  reviewRequired: boolean;
  attempts: number;
  elapsedMs: number;
};
export type BarcodeImageError =
  "TYPE" | "SIZE" | "PIXELS" | "IMAGE" | "DECODER" | "UNAVAILABLE";
export class ImageScanError extends Error {
  constructor(readonly code: BarcodeImageError) {
    super(code);
  }
}
export const IMAGE_LIMIT_BYTES = 25 * 1024 * 1024;
export function validateBarcodeFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new ImageScanError("TYPE");
  if (!file.size || file.size > IMAGE_LIMIT_BYTES)
    throw new ImageScanError("SIZE");
}

/** One owned worker per image. Cancellation also interrupts a synchronous WASM attempt. */
export function readBarcodeImage(
  file: File,
  target: BarcodeImageTarget,
  signal: AbortSignal,
  crop?: BarcodeCrop,
): Promise<BarcodeImageResult> {
  validateBarcodeFile(file);
  if (signal.aborted)
    return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./barcodeImage.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      reject(new ImageScanError("UNAVAILABLE"));
      return;
    }
    let settled = false;
    const finish = (result?: BarcodeImageResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(undefined, new DOMException("Cancelled", "AbortError"));
    const timeout = setTimeout(
      () =>
        finish({
          codes: [],
          reviewRequired: false,
          attempts: 0,
          elapsedMs: 20000,
        }),
      20000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(undefined, new ImageScanError("DECODER"));
    worker.onmessage = ({
      data,
    }: MessageEvent<{
      result?: BarcodeImageResult;
      error?: BarcodeImageError;
    }>) => {
      if (data.error) finish(undefined, new ImageScanError(data.error));
      else if (data.result) finish(data.result);
      else finish(undefined, new ImageScanError("DECODER"));
    };
    try {
      worker.postMessage({
        file,
        target,
        crop,
        wasmUrl: new URL("/barcode/zxing_reader.wasm", location.origin).href,
      });
    } catch {
      finish(undefined, new ImageScanError("DECODER"));
    }
  });
}
