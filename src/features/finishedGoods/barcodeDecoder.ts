import type { DecodeHintType as BarcodeHint } from "@zxing/library";

export interface BarcodeCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_BARCODE_IMAGE_BYTES = 25 * 1024 * 1024;
export type BarcodeImageError =
  "imageType" | "imageSize" | "imageUnreadable" | "imageNoBarcode";

export function barcodeImageProblem(file: File): BarcodeImageError | undefined {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "imageType";
  if (!file.size || file.size > MAX_BARCODE_IMAGE_BYTES) return "imageSize";
}

async function createBarcodeReader(primary = false) {
  const {
    MultiFormatReader,
    BinaryBitmap,
    HybridBinarizer,
    RGBLuminanceSource,
    DecodeHintType,
    BarcodeFormat,
  } = await import("@zxing/library");
  const hints = new Map<BarcodeHint, unknown>([
    [DecodeHintType.TRY_HARDER, true],
  ]);
  if (primary)
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
    ]);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("imageUnreadable");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let pixel = 0; pixel < luminance.length; pixel++) {
      const offset = pixel * 4;
      luminance[pixel] =
        (pixels[offset]! + 2 * pixels[offset + 1]! + pixels[offset + 2]!) / 4;
    }
    // Rotation is performed explicitly below. RGBLuminanceSource avoids the
    // browser adapter's optional canvas-rotation path while retaining TRY_HARDER.
    return reader.decodeWithState(
      new BinaryBitmap(
        new HybridBinarizer(
          new RGBLuminanceSource(luminance, canvas.width, canvas.height),
        ),
      ),
    );
  };
}

/** Dense horizontal edges identify bars; coordinates stay independent of a fixture or label. */
export function linearBarcodeRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): BarcodeCrop[] {
  const cellWidth = 24,
    cellHeight = 12;
  const columns = Math.ceil(width / cellWidth),
    rows = Math.ceil(height / cellHeight);
  const cells = new Uint8Array(columns * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      let edges = 0,
        samples = 0;
      for (
        let y = cy * cellHeight;
        y < Math.min(height, (cy + 1) * cellHeight);
        y += 2
      ) {
        for (
          let x = cx * cellWidth + 1;
          x < Math.min(width, (cx + 1) * cellWidth);
          x++
        ) {
          const offset = (y * width + x) * 4;
          const difference =
            Math.abs(
              data[offset]! +
                data[offset + 1]! +
                data[offset + 2]! -
                (data[offset - 4]! + data[offset - 3]! + data[offset - 2]!),
            ) / 3;
          if (difference > 32) edges++;
          samples++;
        }
      }
      if (samples && edges / samples >= 0.2) cells[cy * columns + cx] = 1;
    }
  }
  const found: (BarcodeCrop & { score: number })[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start]) continue;
    const stack = [start];
    cells[start] = 0;
    let minX = columns,
      maxX = 0,
      minY = rows,
      maxY = 0,
      count = 0;
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % columns,
        y = Math.floor(index / columns);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count++;
      // Bridge a short reflection gap, including slightly tilted bars.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
          const next = ny * columns + nx;
          if (cells[next]) {
            cells[next] = 0;
            stack.push(next);
          }
        }
      }
    }
    const bw = (maxX - minX + 1) * cellWidth,
      bh = (maxY - minY + 1) * cellHeight;
    if (count < 6 || bw < 96 || bw < bh * 1.5) continue;
    const left = Math.max(0, minX * cellWidth - cellWidth);
    const top = Math.max(0, minY * cellHeight - cellHeight);
    const right = Math.min(width, (maxX + 1) * cellWidth + cellWidth);
    const bottom = Math.min(height, (maxY + 1) * cellHeight + cellHeight);
    found.push({
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
      score: count,
    });
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...crop }) => crop);
}

function canvasFor(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop: BarcodeCrop,
  angle = 0,
) {
  const sw = Math.max(1, Math.round(width * crop.width)),
    sh = Math.max(1, Math.round(height * crop.height));
  const radians = (angle * Math.PI) / 180;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(
    sw * Math.abs(Math.cos(radians)) + sh * Math.abs(Math.sin(radians)),
  );
  canvas.height = Math.ceil(
    sw * Math.abs(Math.sin(radians)) + sh * Math.abs(Math.cos(radians)),
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("imageUnreadable");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(
    source,
    width * crop.x,
    height * crop.y,
    sw,
    sh,
    -sw / 2,
    -sh / 2,
    sw,
    sh,
  );
  return canvas;
}

const fullImage: BarcodeCrop = { x: 0, y: 0, width: 1, height: 1 };
const angles = [0, -2, 2, -4, 4, -6, 6, 90];
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Finite, cancellable photo decoding; callers choose between distinct decoded values. */
export async function decodeBarcodeCanvas(
  source: HTMLCanvasElement,
  {
    signal,
    crop,
    budgetMs = 8000,
  }: {
    signal?: AbortSignal;
    crop?: BarcodeCrop;
    budgetMs?: number;
  } = {},
): Promise<string[]> {
  signal?.throwIfAborted();
  const decoder = await createBarcodeReader(true);
  let fallback: Awaited<ReturnType<typeof createBarcodeReader>> | undefined;
  const started = performance.now();
  const codes = new Set<string>();
  const detect = document.createElement("canvas");
  const scale = Math.min(1, 2400 / source.width, 2400 / source.height);
  detect.width = Math.max(1, Math.round(source.width * scale));
  detect.height = Math.max(1, Math.round(source.height * scale));
  const context = detect.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("imageUnreadable");
  context.drawImage(source, 0, 0, detect.width, detect.height);
  const regions = crop
    ? [crop]
    : [
        fullImage,
        ...linearBarcodeRegions(
          context.getImageData(0, 0, detect.width, detect.height).data,
          detect.width,
          detect.height,
        ),
      ];
  for (const region of regions) {
    let decoded = false;
    for (const angle of region === fullImage ? [0, 90] : angles) {
      signal?.throwIfAborted();
      if (performance.now() - started > budgetMs) return [...codes];
      const candidate = canvasFor(
        source,
        source.width,
        source.height,
        region,
        angle,
      );
      try {
        const code = decoder(candidate).getText().trim();
        if (code) codes.add(code);
        decoded = true;
        break;
      } catch (error) {
        const kind =
          typeof error === "object" &&
          error &&
          "getKind" in error &&
          typeof error.getKind === "function"
            ? error.getKind()
            : error instanceof Error
              ? error.name
              : "";
        if (
          ![
            "NotFoundException",
            "ChecksumException",
            "FormatException",
          ].includes(kind)
        )
          throw error;
      } finally {
        candidate.width = 0;
        candidate.height = 0;
      }
      await pause();
    }
    // A Code 128 can resemble an EAN on one noisy scanline. Prefer the stronger
    // Code 128/QR result across angles before allowing the other formats in a
    // region that actually contains bars, rather than the photo background.
    if (!decoded && region !== fullImage) {
      fallback ??= await createBarcodeReader();
      signal?.throwIfAborted();
      const candidate = canvasFor(source, source.width, source.height, region);
      try {
        const code = fallback(candidate).getText().trim();
        if (code) codes.add(code);
      } catch {
        // The primary pass already distinguished unexpected decoder errors.
      } finally {
        candidate.width = 0;
        candidate.height = 0;
      }
    }
    await pause();
  }
  signal?.throwIfAborted();
  return [...codes];
}

export async function decodeBarcodeImage(
  file: File,
  options: { signal?: AbortSignal; crop?: BarcodeCrop } = {},
) {
  const problem = barcodeImageProblem(file);
  if (problem) throw new Error(problem);
  options.signal?.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  try {
    options.signal?.throwIfAborted();
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("imageSize");
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("imageUnreadable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    try {
      return await decodeBarcodeCanvas(canvas, options);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
