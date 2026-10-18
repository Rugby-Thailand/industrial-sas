// One persistent, warm WASM decoder worker for live-frame replay. It receives a
// transferred ImageBitmap (as a live path would from createImageBitmap(video)),
// rasterises it off the main thread and decodes. No labels or file names here.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
// Production pixel-only bar detector (no coordinates or labels from the dataset).
import { linearBarcodeRegions } from "/src/features/finishedGoods/barcodeRegions.ts";

const now = () => performance.now();
const MODES = {
  fast: { roi: false, tryHarder: false },
  hard: { roi: false, tryHarder: true },
  roiFast: { roi: true, tryHarder: false },
};

// Added after the first pass (post hoc, same data): bounded Code 128 region rescue at
// frame resolution, the worker analogue of the main-thread live fallback.
const REGION_BUDGET_MS = 300;
const REGION_ANGLES = [0, -5, 5];

async function regionRescue(bitmap) {
  const t0 = now();
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const full = context.getImageData(0, 0, width, height);
  const regions = ["vertical", "horizontal"].flatMap((direction) =>
    linearBarcodeRegions(full.data, width, height, direction).map((r) => ({
      direction,
      r,
    })),
  );
  const pixelsMs = now() - t0;
  const t1 = now();
  const found = new Map();
  let attempts = 0,
    budgetHit = false;
  for (const { direction, r } of regions) {
    // Quiet-zone margin: along the code 12% + 16 px, across 35%.
    const alongX = direction === "vertical";
    const rw = r.width * width,
      rh = r.height * height;
    const padX = alongX ? rw * 0.12 + 16 : rw * 0.35;
    const padY = alongX ? rh * 0.35 : rh * 0.12 + 16;
    const x = Math.max(0, Math.floor(r.x * width - padX));
    const y = Math.max(0, Math.floor(r.y * height - padY));
    const w = Math.min(width, Math.ceil(r.x * width + rw + padX)) - x;
    const h = Math.min(height, Math.ceil(r.y * height + rh + padY)) - y;
    for (const angle of REGION_ANGLES) {
      if (now() - t1 > REGION_BUDGET_MS) {
        budgetHit = true;
        break;
      }
      const radians = (angle * Math.PI) / 180;
      const cw = Math.ceil(
        Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)),
      );
      const ch = Math.ceil(
        Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians)),
      );
      const crop = new OffscreenCanvas(cw, ch);
      const cc = crop.getContext("2d", { willReadFrequently: true });
      cc.fillStyle = "white";
      cc.fillRect(0, 0, cw, ch);
      cc.translate(cw / 2, ch / 2);
      cc.rotate(radians);
      cc.drawImage(canvas, x, y, w, h, -w / 2, -h / 2, w, h);
      attempts++;
      const results = (
        await readBarcodes(cc.getImageData(0, 0, cw, ch), {
          formats: ["Code128"],
          tryHarder: true,
          maxNumberOfSymbols: 4,
        })
      ).filter((v) => v.isValid);
      crop.width = crop.height = 1;
      for (const v of results)
        if (!found.has(v.text))
          found.set(v.text, {
            text: v.text,
            format: v.format,
            centre: [Math.round(x + w / 2), Math.round(y + h / 2)],
          });
      if (results.length) break;
    }
    if (budgetHit) break;
  }
  canvas.width = canvas.height = 1;
  return {
    pixelsMs,
    decodeMs: now() - t1,
    regions: regions.length,
    attempts,
    budgetHit,
    symbols: [...found.values()],
  };
}

function centre(position) {
  const p = [
    position.topLeft,
    position.topRight,
    position.bottomRight,
    position.bottomLeft,
  ];
  return [
    p.reduce((s, v) => s + v.x, 0) / 4,
    p.reduce((s, v) => s + v.y, 0) / 4,
  ];
}

self.onmessage = async (event) => {
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  const { data } = event;
  if (data.cmd === "caps") {
    // Capability only: a worker-side native detector would avoid main-thread decode.
    const present = "BarcodeDetector" in self;
    let formats = null;
    try {
      formats = present
        ? await self.BarcodeDetector.getSupportedFormats()
        : null;
    } catch (error) {
      formats = `error: ${error}`;
    }
    self.postMessage({ present, formats });
    return;
  }
  if (data.cmd === "init") {
    const started = now();
    await prepareZXingModule({
      overrides: { locateFile: () => data.wasmUrl },
      fireImmediately: true,
    });
    self.postMessage({ initMs: now() - started });
    return;
  }
  const { bitmap, mode, overlay, job } = data;
  try {
    if (mode === "regions") {
      self.postMessage({ job, ...(await regionRescue(bitmap)) });
      return;
    }
    const { roi, tryHarder } = MODES[mode];
    const t0 = now();
    const [x, y, w, h] = roi
      ? [
          Math.round(bitmap.width * overlay.x),
          Math.round(bitmap.height * overlay.y),
          Math.round(bitmap.width * overlay.width),
          Math.round(bitmap.height * overlay.height),
        ]
      : [0, 0, bitmap.width, bitmap.height];
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    const pixels = context.getImageData(0, 0, w, h);
    canvas.width = canvas.height = 1;
    const pixelsMs = now() - t0;
    const t1 = now();
    const results = await readBarcodes(pixels, {
      formats: ["Code128", "QRCode"],
      tryHarder,
      maxNumberOfSymbols: 8,
    });
    const decodeMs = now() - t1;
    const symbols = results
      .filter((r) => r.isValid)
      .map((r) => {
        const [cx, cy] = centre(r.position);
        return {
          text: r.text,
          format: r.format,
          centre: [Math.round(cx + x), Math.round(cy + y)],
        };
      });
    self.postMessage({ job, pixelsMs, decodeMs, symbols });
  } catch (error) {
    self.postMessage({ job, error: String(error?.stack || error) });
  } finally {
    bitmap.close();
  }
};
