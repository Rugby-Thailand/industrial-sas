const MAX_SIDE = 2000;
const MAX_PIXELS = 40_000_000;
export const MAX_JOB_TICKET_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_JOB_TICKET_AI_DATA_URL = 4_000_000;

// JPEG remains the AI input. WebP only changes the stored copy.
const JPEG_QUALITY = 0.85;
const WEBP_QUALITY = 0.88;
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

/**
 * Dispatch the unchanged JPEG to AI before doing any optional WebP work.
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
  const canvas = document.createElement("canvas");
  try {
    try {
      signal.throwIfAborted();
      if (
        bitmap.width <= 0 ||
        bitmap.height <= 0 ||
        bitmap.width * bitmap.height > MAX_PIXELS
      )
        throw new Error("imageSize");
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("imageUnreadable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
      // Release the full-resolution decode before encoding/network work.
      bitmap.close();
    }
    const jpeg = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
    signal.throwIfAborted();
    if (!jpeg || jpeg.type !== "image/jpeg") throw new Error("imageUnreadable");
    const aiFile = photoFile(jpeg, file.name, "jpg");
    await onAiReady(aiFile);
    signal.throwIfAborted();
    try {
      const webp = await encodeUpload(() => {
        // JPEG composites transparency onto black. Give the stored WebP the
        // same background without changing the JPEG already sent to AI.
        const context = canvas.getContext("2d");
        if (!context) return Promise.resolve(null);
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "black";
        context.fillRect(0, 0, canvas.width, canvas.height);
        return toBlob(canvas, "image/webp", WEBP_QUALITY);
      }, signal);
      signal.throwIfAborted();
      return webp?.type === "image/webp" && webp.size < jpeg.size
        ? photoFile(webp, file.name, "webp")
        : aiFile;
    } catch {
      signal.throwIfAborted();
      return aiFile;
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
}
