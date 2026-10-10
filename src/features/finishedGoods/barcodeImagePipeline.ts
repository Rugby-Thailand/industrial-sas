import {
  prepareZXingModule,
  readBarcodes,
  type ReadResult,
} from "zxing-wasm/reader";
import type { BarcodeImageTarget, BarcodeImageResult } from "./barcodeImage";
import { classifyTicketBarcode } from "./jobScan/ticketDraft";
import { linearBarcodeRegions } from "./barcodeRegions";
import { createBarcodeReader, decodeBarcodeCanvas } from "./barcodeDecoder";

type Region = readonly [number, number, number, number];
const isJob = (code: string) => classifyTicketBarcode(code) === "factoryOrder";
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
  if (target === "LOCATION") {
    // Preserve the established location geometry and scale inside the owned worker.
    const started = performance.now();
    const scale = Math.min(1, 3000 / Math.max(image.width, image.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
      const symbols = await readBarcodes(
        context.getImageData(0, 0, canvas.width, canvas.height),
        {
          formats: ["Code128", "QRCode"],
          tryHarder: true,
          maxNumberOfSymbols: 8,
        },
      );
      const classic = await decodeBarcodeCanvas(canvas);
      const valid = symbols.filter((r) => r.isValid);
      const distinct = new Set(valid.map((r) => r.text));
      // A classic singleton may correct a noisy read, but cannot establish uniqueness when WASM sees multiple identities.
      const codes = classic.length
        ? [
            ...classic,
            ...valid
              .filter((r) => distinct.size > 1 || r.format === "QRCode")
              .map((r) => r.text),
          ]
        : valid.map((r) => r.text);
      return {
        codes: [...new Set(codes)],
        reviewRequired: false,
        attempts: 1,
        elapsedMs: performance.now() - started,
      };
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  const started = performance.now(),
    w = image.width,
    h = image.height;
  let attempts = 0,
    exhausted = false;
  const jobs = new Set<string>(),
    other = new Set<string>(),
    products = new Set<string>();
  let productNeedsReview = false;
  let fallback: Awaited<ReturnType<typeof createBarcodeReader>> | undefined;
  const wanted = (r: ReadResult) =>
    r.isValid &&
    (target === "ANY" ||
      (target === "factoryOrder"
        ? isJob(r.text)
        : !/^ISAS:/i.test(r.text) && !isJob(r.text)));
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
    let fallbackCode: string | undefined;
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
      if (!values.length && !attempts)
        values = await readBarcodes(
          canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height),
          { tryHarder: true, maxNumberOfSymbols: 8 },
        );
      if (!values.length && target === "ANY") {
        fallback ??= await createBarcodeReader(true);
        try {
          fallbackCode = fallback(canvas).getText().trim();
          // Preserve the established location decoder when both engines read the same pixels.
          if (fallbackCode) values = [];
        } catch (cause) {
          const kind =
            typeof cause === "object" &&
            cause &&
            "getKind" in cause &&
            typeof cause.getKind === "function"
              ? cause.getKind()
              : cause instanceof Error
                ? cause.name
                : "";
          if (
            ![
              "NotFoundException",
              "ChecksumException",
              "FormatException",
            ].includes(kind)
          )
            throw cause;
        }
      }
    } finally {
      canvas.width = canvas.height = 1;
    }
    attempts++;
    for (const r of values)
      if (r.isValid) {
        if (isJob(r.text)) jobs.add(r.text);
        else {
          other.add(r.text);
          if (!/^ISAS:/i.test(r.text)) {
            products.add(r.text);
            productNeedsReview ||= !!curve;
          }
        }
      }
    const codes = [...new Set(values.filter(wanted).map((r) => r.text))];
    if (fallbackCode) {
      (isJob(fallbackCode) ? jobs : other).add(fallbackCode);
      codes.push(fallbackCode);
    }
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
  if (target === "ANY") {
    const scale = Math.min(1, 2400 / w, 2400 / h);
    const detect = new OffscreenCanvas(
      Math.max(1, Math.round(w * scale)),
      Math.max(1, Math.round(h * scale)),
    );
    const context = detect.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, detect.width, detect.height);
    const pixels = context.getImageData(0, 0, detect.width, detect.height).data;
    const regions = [
      ...linearBarcodeRegions(pixels, detect.width, detect.height),
      ...linearBarcodeRegions(
        pixels,
        detect.width,
        detect.height,
        "horizontal",
      ),
    ];
    detect.width = detect.height = 1;
    for (const region of regions) {
      for (const angle of [...angles, 90]) {
        const candidate = await attempt(
          [
            region.x * w,
            region.y * h,
            Math.max(1, Math.round(region.width * w)),
            Math.max(1, Math.round(region.height * h)),
          ],
          angle,
        );
        if (candidate || exhausted) break;
      }
      if (exhausted) break;
    }
    if (jobs.size || other.size) return result([...jobs, ...other]);
  }
  if (found) {
    return completeTicket(found);
  }
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
