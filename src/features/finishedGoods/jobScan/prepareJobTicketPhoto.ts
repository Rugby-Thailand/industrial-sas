const AI_MAX_SIDE = 1280;
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
) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("imageUnreadable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
}

async function encodeJpeg(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const jpeg = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
  signal.throwIfAborted();
  if (!jpeg || jpeg.type !== "image/jpeg") throw new Error("imageUnreadable");
  return jpeg;
}

/**
 * Dispatch the smaller AI JPEG before encoding the upload.
 * onAiReady resolves after dispatch, not after the AI response. The returned
 * file is the one stored by UploadThing. Canvas lifetime stays inside here.
 */
export async function prepareJobTicketPhoto(
  file: File,
  {
    onAiReady,
    signal,
  }: {
    onAiReady: (image: File) => Promise<void>;
    signal: AbortSignal;
  },
): Promise<File> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  const aiCanvas = document.createElement("canvas");
  const canvas =
    Math.max(bitmap.width, bitmap.height) > AI_MAX_SIDE
      ? document.createElement("canvas")
      : aiCanvas;
  try {
    try {
      signal.throwIfAborted();
      if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error("imageSize");
      drawPhoto(aiCanvas, bitmap, AI_MAX_SIDE);
      if (canvas !== aiCanvas) drawPhoto(canvas, bitmap, UPLOAD_MAX_SIDE);
    } finally {
      bitmap.close();
    }
    const aiJpeg = await encodeJpeg(aiCanvas, signal);
    if (canvas !== aiCanvas) aiCanvas.width = aiCanvas.height = 0;
    const aiFile = photoFile(aiJpeg, file.name, "jpg");
    await onAiReady(aiFile);
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
    canvas.width = canvas.height = 0;
  }
}
