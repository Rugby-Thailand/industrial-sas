import { barcodeImageProblem, type BarcodeCrop } from "../barcodeDecoder";
import { MAX_LOCATION_IMAGE_DATA_URL } from "../../../../convex/model/finishedGoods/locationImage";
import { toDataUrl } from "./resizeImage";

/** Crop before downscaling; barcode acquisition keeps its original resolution. */
export async function prepareLocationImage(
  file: File,
  { crop, signal }: { crop?: BarcodeCrop; signal?: AbortSignal } = {},
) {
  const problem = barcodeImageProblem(file);
  if (problem) throw new Error(problem);
  signal?.throwIfAborted();
  const area = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  if (
    ![area.x, area.y, area.width, area.height].every(Number.isFinite) ||
    area.x < 0 ||
    area.y < 0 ||
    area.width <= 0 ||
    area.height <= 0 ||
    area.x + area.width > 1 ||
    area.y + area.height > 1
  )
    throw new Error("imageUnreadable");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    signal?.throwIfAborted();
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("imageSize");
    const width = bitmap.width * area.width,
      height = bitmap.height * area.height;
    const scale = Math.min(1, 2000 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("imageUnreadable");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      bitmap.width * area.x,
      bitmap.height * area.y,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    signal?.throwIfAborted();
    if (!blob) throw new Error("imageUnreadable");
    const data = await toDataUrl(blob);
    signal?.throwIfAborted();
    if (data.length > MAX_LOCATION_IMAGE_DATA_URL) throw new Error("imageSize");
    return data;
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
