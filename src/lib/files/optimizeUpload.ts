import type { MasterCardFileKind } from "@/lib/convex/orderToShipApi";

export const MAX_PRIVATE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_PHOTO_INPUT_BYTES = 20 * 1024 * 1024;
export const PHOTO_TARGET_BYTES = 2 * 1024 * 1024;
export const PHOTO_MAX_EDGE_PX = 2560;

export interface OptimizedUpload {
  readonly file: File;
  readonly originalBytes: number;
  readonly optimized: boolean;
  readonly contentDigest: string;
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const acceptedTypesFor = (kind: MasterCardFileKind): string =>
  kind === "PHOTO" ? "image/jpeg,image/png,image/webp" : "*";

export const maximumInputBytesFor = (kind: MasterCardFileKind): number =>
  kind === "PHOTO" ? MAX_PHOTO_INPUT_BYTES : MAX_PRIVATE_FILE_BYTES;

export const sha256File = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const webpName = (name: string): string => {
  const stem = name.replace(/\.[^.]+$/, "");
  return `${stem.length === 0 ? "photo" : stem}.webp`;
};

const canvasBlob = (
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));

export const optimizePhotoInBrowser = async (file: File): Promise<File> => {
  if (!PHOTO_TYPES.has(file.type) || typeof createImageBitmap !== "function") {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      PHOTO_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    let smallest: Blob | null = null;
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      const candidate = await canvasBlob(canvas, quality);
      if (candidate === null) continue;
      if (smallest === null || candidate.size < smallest.size) {
        smallest = candidate;
      }
      if (candidate.size <= PHOTO_TARGET_BYTES) break;
    }
    if (smallest === null || smallest.size >= file.size) return file;
    return new File([smallest], webpName(file.name), {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
};

export const optimizeUpload = async (
  file: File,
  kind: MasterCardFileKind,
  optimizePhoto: (source: File) => Promise<File> = optimizePhotoInBrowser,
): Promise<OptimizedUpload> => {
  const maximum = maximumInputBytesFor(kind);
  if (file.size > maximum) throw new Error("FILE_TOO_LARGE");

  const candidate = kind === "PHOTO" ? await optimizePhoto(file) : file;
  const finalFile = candidate.size < file.size ? candidate : file;
  if (finalFile.size > MAX_PRIVATE_FILE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }
  return {
    file: finalFile,
    originalBytes: file.size,
    optimized: finalFile !== file,
    contentDigest: await sha256File(finalFile),
  };
};
