import { readBarcodeImage } from "../barcodeImage";
import type { BarcodeCrop } from "../barcodeDecoder";

const AI_MAX_SIDE = 1280;
const AI_WITHOUT_CROP_MAX_SIDE = 2300;
const DETAIL_MAX_SIDE = 1600;
const UPLOAD_MAX_SIDE = 2000;
export const MAX_JOB_TICKET_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_JOB_TICKET_AI_DATA_URL = 4_000_000;

// JPEG remains the AI input. WebP only changes the stored copy.
const JPEG_QUALITY = 0.85;
const WEBP_QUALITY = 0.9;
// Keep JPEG when changing format would only buy a marginal size reduction.
const MIN_WEBP_SAVING = 0.15;
const MAX_WEBP_ENCODERS = 2;
let activeEncoders = 0;
const waitingEncoders = new Set<() => void>();

async function encodeUpload<T>(
  encode: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      if (activeEncoders >= MAX_WEBP_ENCODERS) return;
      waitingEncoders.delete(start);
      signal.removeEventListener("abort", cancel);
      activeEncoders++;
      resolve();
    };
    const cancel = () => {
      waitingEncoders.delete(start);
      reject(signal.reason);
    };
    signal.addEventListener("abort", cancel, { once: true });
    waitingEncoders.add(start);
    start();
  });
  try {
    signal.throwIfAborted();
    return await encode();
  } finally {
    activeEncoders--;
    for (const start of waitingEncoders) start();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
}

function photoFile(blob: Blob, name: string, extension: "jpg" | "webp") {
  return new File([blob], `${name.replace(/\.\w+$/, "")}.${extension}`, {
    type: blob.type,
  });
}

function drawPhoto(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  maxSide: number,
  crop?: BarcodeCrop,
) {
  const x = crop ? Math.round(crop.x * bitmap.width) : 0;
  const y = crop ? Math.round(crop.y * bitmap.height) : 0;
  const width = crop
    ? Math.max(
        1,
        Math.min(bitmap.width - x, Math.round(crop.width * bitmap.width)),
      )
    : bitmap.width;
  const height = crop
    ? Math.max(
        1,
        Math.min(bitmap.height - y, Math.round(crop.height * bitmap.height)),
      )
    : bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("imageUnreadable");
  if (crop) {
    context.drawImage(
      bitmap,
      x,
      y,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
}

/** Improve the contrast of printed numbers. The main ticket retains its color. */
function sharpenDateCrop(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context?.getImageData) return;
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  const counts = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    const value = Math.round(
      0.299 * pixels.data[offset]! +
        0.587 * pixels.data[offset + 1]! +
        0.114 * pixels.data[offset + 2]!,
    );
    gray[i] = value;
    counts[value]!++;
  }
  const clip = Math.floor(gray.length * 0.006);
  let dark = 0,
    bright = 255,
    darkCount = 0,
    brightCount = 0;
  while (dark < 255 && darkCount + counts[dark]! <= clip) {
    darkCount += counts[dark++]!;
  }
  while (bright > dark && brightCount + counts[bright]! <= clip) {
    brightCount += counts[bright--]!;
  }
  if (bright <= dark) return;
  const contrast = 255 / (bright - dark);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = gray[i]!;
      const neighbors =
        x > 0 && x < width - 1 && y > 0 && y < height - 1
          ? (gray[i - 1]! +
              gray[i + 1]! +
              gray[i - width]! +
              gray[i + width]!) /
            4
          : value;
      const sharpened = value - neighbors;
      const light =
        (value - dark + (Math.abs(sharpened) > 2 ? 1.5 * sharpened : 0)) *
        contrast;
      const offset = i * 4;
      pixels.data[offset] =
        pixels.data[offset + 1] =
        pixels.data[offset + 2] =
          light;
    }
  }
  context.putImageData(pixels, 0, 0);
}

function drawOptionalCrop(
  bitmap: ImageBitmap,
  maxSide: number,
  crop: BarcodeCrop,
  sharpen = false,
): HTMLCanvasElement | undefined {
  const canvas = document.createElement("canvas");
  try {
    drawPhoto(canvas, bitmap, maxSide, crop);
    if (sharpen) sharpenDateCrop(canvas);
    return canvas;
  } catch {
    // A failed supplemental image must not prevent the usual scan or upload.
    canvas.width = canvas.height = 0;
    return undefined;
  }
}

async function encodeJpeg(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const jpeg = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
  signal.throwIfAborted();
  if (!jpeg || jpeg.type !== "image/jpeg") throw new Error("imageUnreadable");
  return jpeg;
}

export type JobTicketPhotoEvidence = {
  readonly codes: readonly string[];
  readonly detailImage?: File;
  readonly datesImage?: File;
  readonly deliveryImage?: File;
};

/**
 * Dispatch the AI JPEG and any barcode-anchored detail before encoding the upload.
 * onAiReady resolves after dispatch, not after the AI response. The returned
 * file is the one stored by UploadThing. Canvas lifetime stays inside here.
 */
export async function prepareJobTicketPhoto(
  file: File,
  {
    onAiReady,
    signal,
  }: {
    onAiReady: (
      image: File,
      evidence?: JobTicketPhotoEvidence,
    ) => Promise<void>;
    signal: AbortSignal;
  },
): Promise<File> {
  signal.throwIfAborted();
  const inspection = Promise.resolve()
    .then(() => readBarcodeImage(file, "TICKET_PHOTO", signal))
    .catch(() => undefined);
  const bitmap = await createImageBitmap(file);
  const aiCanvas = document.createElement("canvas");
  let canvas = aiCanvas;
  const supplements: Partial<
    Record<
      "detailImage" | "datesImage" | "deliveryImage",
      HTMLCanvasElement | undefined
    >
  > = {};
  try {
    const evidence = await inspection;
    try {
      signal.throwIfAborted();
      if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error("imageSize");
      const maxSide = evidence?.detailCrop
        ? AI_MAX_SIDE
        : AI_WITHOUT_CROP_MAX_SIDE;
      const side = Math.max(bitmap.width, bitmap.height);
      if (Math.min(side, maxSide) !== Math.min(side, UPLOAD_MAX_SIDE)) {
        canvas = document.createElement("canvas");
      }
      drawPhoto(aiCanvas, bitmap, maxSide);
      if (canvas !== aiCanvas) drawPhoto(canvas, bitmap, UPLOAD_MAX_SIDE);
      if (evidence?.detailCrop) {
        supplements.detailImage = drawOptionalCrop(
          bitmap,
          DETAIL_MAX_SIDE,
          evidence.detailCrop,
        );
      }
      if (evidence?.codes.length !== 2) {
        supplements.datesImage = drawOptionalCrop(
          bitmap,
          1800,
          {
            x: 0.025,
            y: evidence?.codes.length ? 0.11 : 0,
            width: evidence?.codes.length ? 0.595 : 0.82,
            height: evidence?.codes.length ? 0.55 : 0.66,
          },
          true,
        );
        if (evidence?.deliveryCrop) {
          supplements.deliveryImage = drawOptionalCrop(
            bitmap,
            1550,
            evidence.deliveryCrop,
            true,
          );
        }
      }
    } finally {
      bitmap.close();
    }
    const aiJpeg = await encodeJpeg(aiCanvas, signal);
    const photos: Partial<Record<keyof typeof supplements, File>> = {};
    for (const key of Object.keys(
      supplements,
    ) as (keyof typeof supplements)[]) {
      const supplement = supplements[key];
      if (!supplement) continue;
      try {
        photos[key] = photoFile(
          await encodeJpeg(supplement, signal),
          file.name,
          "jpg",
        );
      } catch {
        signal.throwIfAborted();
      } finally {
        supplement.width = supplement.height = 0;
      }
    }
    if (canvas !== aiCanvas) aiCanvas.width = aiCanvas.height = 0;
    const aiFile = photoFile(aiJpeg, file.name, "jpg");
    if (Object.keys(photos).length || evidence?.codes.length) {
      await onAiReady(aiFile, { codes: evidence?.codes ?? [], ...photos });
    } else {
      await onAiReady(aiFile);
    }
    signal.throwIfAborted();
    let jpeg = aiJpeg;
    if (canvas !== aiCanvas) {
      try {
        jpeg = await encodeJpeg(canvas, signal);
      } catch {
        // The AI read is already paid for: store its smaller JPEG rather
        // than discarding the scan because the larger encode failed.
        signal.throwIfAborted();
        return aiFile;
      }
    }
    const uploadJpeg =
      jpeg === aiJpeg ? aiFile : photoFile(jpeg, file.name, "jpg");
    try {
      const webp = await encodeUpload(() => {
        // JPEG composites transparency onto black. Match that background
        // in the stored WebP.
        const context = canvas.getContext("2d");
        if (!context) return Promise.resolve(null);
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "black";
        context.fillRect(0, 0, canvas.width, canvas.height);
        return toBlob(canvas, "image/webp", WEBP_QUALITY);
      }, signal);
      signal.throwIfAborted();
      return webp?.type === "image/webp" &&
        webp.size <= jpeg.size * (1 - MIN_WEBP_SAVING)
        ? photoFile(webp, file.name, "webp")
        : uploadJpeg;
    } catch {
      signal.throwIfAborted();
      return uploadJpeg;
    }
  } finally {
    if (canvas !== aiCanvas) aiCanvas.width = aiCanvas.height = 0;
    for (const extra of Object.values(supplements)) {
      if (extra) extra.width = extra.height = 0;
    }
    canvas.width = canvas.height = 0;
  }
}
