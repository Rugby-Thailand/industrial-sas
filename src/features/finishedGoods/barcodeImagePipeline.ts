import {
  prepareZXingModule,
  readBarcodes,
  type ReadResult,
} from "zxing-wasm/reader";
import type { BarcodeImageTarget, BarcodeImageResult } from "./barcodeImage";

type Region = readonly [number, number, number, number];
const isJob = (code: string) => /^FO\d{4,}$/i.test(code);
const angles = [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10];

function cropCanvas(
  image: ImageBitmap,
  [x, y, w, h]: Region,
  angle = 0,
  curve = 0,
) {
  const radians = (angle * Math.PI) / 180;
  const canvas = new OffscreenCanvas(
    Math.ceil(
      Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)),
    ),
    Math.ceil(
      Math.abs(w * Math.sin(radians)) +
        Math.abs(h * Math.cos(radians)) +
        Math.abs(curve) * w,
    ),
  );
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  if (curve) {
    // Cache the small crop before correcting columns; the original full bitmap is expensive to sample repeatedly.
    const source = new OffscreenCanvas(w, h);
    source
      .getContext("2d", { willReadFrequently: true })!
      .drawImage(image, x, y, w, h, 0, 0, w, h);
    for (let column = 0; column < w; column++) {
      const offset = curve * w * (column / w - 0.5) ** 2;
      ctx.drawImage(
        source,
        column,
        0,
        1,
        h,
        -w / 2 + column,
        -h / 2 - offset,
        1,
        h,
      );
    }
    source.width = source.height = 1;
  } else ctx.drawImage(image, x, y, w, h, -w / 2, -h / 2, w, h);
  return canvas;
}

/** Barcode pixels only: overlapping regions and geometric correction, without OCR or expected labels. */
export async function decodeBarcodeBitmap(
  image: ImageBitmap,
  target: BarcodeImageTarget,
  wasmUrl: string,
): Promise<BarcodeImageResult> {
  await prepareZXingModule({
    overrides: { locateFile: () => wasmUrl },
    fireImmediately: true,
  });
  const started = performance.now(),
    w = image.width,
    h = image.height;
  let attempts = 0,
    exhausted = false;
  const jobs = new Set<string>(),
    other = new Set<string>(),
    products = new Set<string>();
  let productNeedsReview = false;
  const wanted = (r: ReadResult) =>
    r.isValid &&
    (target === "LOCATION" ||
      target === "ANY" ||
      (target === "factoryOrder"
        ? isJob(r.text)
        : r.format === "Code128" && !isJob(r.text)));
  const result = (
    codes: string[],
    reviewRequired = false,
  ): BarcodeImageResult => ({
    codes,
    reviewRequired,
    attempts,
    elapsedMs: performance.now() - started,
  });
  async function attempt(region: Region, angle = 0, curve = 0) {
    if (attempts >= 140 || performance.now() - started >= 15000) {
      exhausted = true;
      return null;
    }
    const canvas = cropCanvas(image, region, angle, curve);
    let values: ReadResult[];
    try {
      values = await readBarcodes(
        canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height),
        {
          formats: ["Code128", "QRCode"],
          tryHarder: true,
          maxNumberOfSymbols: 8,
          ...(curve ? { tryDownscale: false, minLineCount: 1 } : {}),
        },
      );
    } finally {
      canvas.width = canvas.height = 1;
    }
    attempts++;
    for (const r of values)
      if (r.isValid) {
        if (isJob(r.text)) jobs.add(r.text);
        else {
          other.add(r.text);
          if (r.format === "Code128") {
            products.add(r.text);
            productNeedsReview ||= !!curve;
          }
        }
      }
    const codes = [...new Set(values.filter(wanted).map((r) => r.text))];
    if (target === "TICKET")
      return products.size
        ? result([...jobs, ...products], productNeedsReview)
        : null;
    if (!codes.length) return null;
    return result(codes, !!curve);
  }
  async function completeTicket(found: BarcodeImageResult) {
    if (target !== "TICKET" || jobs.size) return found;
    // A lower product crop may miss the JOB above it. Search upper bands before accepting a partial ticket.
    for (const band of [2, 1, 3, 0, 4]) {
      for (const angle of angles) {
        await attempt(
          [0, Math.floor(h * band * 0.08), w, Math.ceil(h * 0.28)],
          angle,
        );
        if (jobs.size || exhausted)
          return result([...jobs, ...products], productNeedsReview);
      }
    }
    return result([...products], productNeedsReview);
  }
  let found = await attempt([0, 0, w, h]);
  if (found) return completeTicket(found);
  for (const band of [6, 7, 8, 5, 4, 3, 2, 1, 0]) {
    for (const angle of angles) {
      found = await attempt(
        [0, Math.floor(h * band * 0.08), w, Math.ceil(h * 0.28)],
        angle,
      );
      if (found) return completeTicket(found);
      if (exhausted) break;
    }
    if (exhausted) break;
    if (
      (target === "TICKET" || target === "productBarcodeText") &&
      band === 6
    ) {
      for (const curve of [0.2, 0.1, -0.2, -0.1]) {
        for (const angle of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10]) {
          found = await attempt(
            [
              Math.floor(w * 0.2),
              Math.floor(h * 0.56),
              Math.ceil(w * 0.6),
              Math.ceil(h * 0.12),
            ],
            angle,
            curve,
          );
          if (found) return completeTicket(found);
          if (exhausted) break;
        }
        if (exhausted) break;
      }
    }
    if (exhausted) break;
  }
  // Let the owning field report a wrong-kind identity; never invent a missing product code.
  return result(
    target === "TICKET"
      ? [...products]
      : target === "factoryOrder"
        ? [...other]
        : target === "productBarcodeText"
          ? [...jobs]
          : [],
    productNeedsReview,
  );
}
