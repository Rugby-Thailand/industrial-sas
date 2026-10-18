// Benchmark-only decode variants. Runs in one persistent module worker so that
// WASM startup is measured separately from per-image work. No file names,
// coordinates or expected identities are available to this module.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { linearBarcodeRegions } from "/src/features/finishedGoods/barcodeRegions.ts";
import { decodeBarcodeBitmap } from "/src/features/finishedGoods/barcodeImagePipeline.ts";

const FORMATS = ["Code128", "QRCode"];
// Completeness heuristic for the cascade only. The printed ticket header shows
// both FO######## and FOM####### job numbers; production uses /^FO\d{4,}$/.
const JOB_LIKE = /^FOM?\d{4,}$/i;
const CASCADE_BUDGET_MS = 8000;
const now = () => performance.now();
let wasmUrl = "";

function pixels(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 1;
  return { data, scale };
}

/** Native-resolution crop; optional rotation (deg, clockwise) and column curve shift. */
function crop(bitmap, rect, angle = 0, curve = 0) {
  const [x, y, w, h] = rect;
  const radians = (angle * Math.PI) / 180;
  const cw = Math.ceil(
    Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)),
  );
  const ch = Math.ceil(
    Math.abs(w * Math.sin(radians)) +
      Math.abs(h * Math.cos(radians)) +
      Math.abs(curve) * w,
  );
  const canvas = new OffscreenCanvas(cw, ch);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "white";
  context.fillRect(0, 0, cw, ch);
  context.translate(cw / 2, ch / 2);
  context.rotate(radians);
  if (curve) {
    // Port of the production curve probe: shift columns along a parabola.
    const source = new OffscreenCanvas(w, h);
    source.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    for (let column = 0; column < w; column++) {
      const offset = curve * w * (column / w - 0.5) ** 2;
      context.drawImage(
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
  } else context.drawImage(bitmap, x, y, w, h, -w / 2, -h / 2, w, h);
  const data = context.getImageData(0, 0, cw, ch);
  canvas.width = canvas.height = 1;
  return data;
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

/** Dominant gradient direction of a crop relative to its bar orientation, in degrees. */
function estimateSkew(data, direction) {
  const step = Math.max(1, Math.round(Math.max(data.width, data.height) / 480));
  const { width, height } = data;
  const lum = (x, y) => {
    const o = (y * width + x) * 4;
    return data.data[o] + 2 * data.data[o + 1] + data.data[o + 2];
  };
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (let y = step; y < height - step; y += step)
    for (let x = step; x < width - step; x += step) {
      const gx = lum(x + step, y) - lum(x - step, y);
      const gy = lum(x, y + step) - lum(x, y - step);
      if (Math.abs(gx) + Math.abs(gy) < 200) continue;
      sxx += gx * gx;
      syy += gy * gy;
      sxy += gx * gy;
    }
  if (!sxx && !syy) return 0;
  const theta = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
  let delta = theta - (direction === "vertical" ? 0 : 90);
  while (delta > 90) delta -= 180;
  while (delta < -90) delta += 180;
  return delta;
}

/** Generic edge-density regions from the production detector, mapped to native pixels with quiet-zone margin. */
function regions(bitmap) {
  const { data, scale } = pixels(bitmap, 2400);
  const found = [];
  for (const direction of ["vertical", "horizontal"])
    for (const r of linearBarcodeRegions(
      data.data,
      data.width,
      data.height,
      direction,
    )) {
      const x = r.x * bitmap.width,
        y = r.y * bitmap.height,
        w = r.width * bitmap.width,
        h = r.height * bitmap.height;
      const alongX = direction === "vertical";
      // Code 128 needs ~10 modules of quiet zone; pad along the code by 12% + 16px and across by 35%.
      const padX = alongX ? w * 0.12 + 16 : w * 0.35;
      const padY = alongX ? h * 0.35 : h * 0.12 + 16;
      const left = Math.max(0, Math.floor(x - padX)),
        top = Math.max(0, Math.floor(y - padY));
      const right = Math.min(bitmap.width, Math.ceil(x + w + padX)),
        bottom = Math.min(bitmap.height, Math.ceil(y + h + padY));
      found.push({ direction, rect: [left, top, right - left, bottom - top] });
    }
  return { list: found, detectScale: scale };
}

class Collector {
  constructor() {
    this.symbols = new Map();
    this.attempts = 0;
    this.stages = [];
  }
  add(results, stage, mapCentre, review = false) {
    let added = 0;
    for (const r of results) {
      if (!r.isValid) continue;
      added++;
      const text = r.text;
      const entry = this.symbols.get(text) ?? {
        text,
        format: r.format,
        formats: [],
        stages: [],
        review: true,
        centres: [],
      };
      if (!entry.stages.includes(stage)) entry.stages.push(stage);
      if (!entry.formats.includes(r.format)) entry.formats.push(r.format);
      entry.review &&= review;
      entry.centres.push(mapCentre(centre(r.position)).map(Math.round));
      this.symbols.set(text, entry);
    }
    return added;
  }
  list() {
    return [...this.symbols.values()];
  }
  ticketComplete() {
    const strict = this.list().filter((s) => !s.review);
    return (
      strict.some((s) => JOB_LIKE.test(s.text)) &&
      strict.some(
        (s) =>
          s.format === "Code128" &&
          !JOB_LIKE.test(s.text) &&
          !/^ISAS:/i.test(s.text),
      )
    );
  }
  covers(rect) {
    const [x, y, w, h] = rect;
    for (const s of this.symbols.values())
      for (const [cx, cy] of s.centres)
        if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) return true;
    return false;
  }
}

async function readFull(bitmap, collector, stage, maxSide, options) {
  const { data, scale } = pixels(bitmap, maxSide);
  collector.attempts++;
  const results = await readBarcodes(data, {
    formats: FORMATS,
    maxNumberOfSymbols: 8,
    ...options,
  });
  return collector.add(results, stage, ([cx, cy]) => [cx / scale, cy / scale]);
}

async function readRegion(
  bitmap,
  collector,
  stage,
  region,
  angle,
  options,
  review = false,
  curve = 0,
) {
  const data = crop(bitmap, region.rect, angle, curve);
  collector.attempts++;
  const results = await readBarcodes(data, {
    formats: ["Code128"],
    maxNumberOfSymbols: 4,
    ...options,
  });
  const [x, y, w, h] = region.rect;
  const radians = (-angle * Math.PI) / 180;
  return collector.add(
    results,
    stage,
    ([cx, cy]) => {
      // Inverse rotation back into source coordinates (curve offset ignored).
      const dx = cx - data.width / 2,
        dy = cy - data.height / 2;
      return [
        x + w / 2 + dx * Math.cos(radians) - dy * Math.sin(radians),
        y + h / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
      ];
    },
    review,
  );
}

function regionAngles(bitmap, region, extra) {
  const preview = crop(bitmap, region.rect);
  const skew = estimateSkew(preview, region.direction);
  const angles = [0];
  if (Math.abs(skew) >= 1.5 && Math.abs(skew) <= 20)
    angles.push(Math.round(-skew));
  for (const a of extra)
    if (!angles.some((b) => Math.abs(a - b) < 2)) angles.push(a);
  return { angles, skew: Math.round(skew * 10) / 10 };
}

async function roi(bitmap, collector, tryHarder) {
  // QR stays on the full photo; finder patterns need their whole quiet zone.
  await readFull(bitmap, collector, "qr-full1600", 1600, {
    formats: ["QRCode"],
    tryHarder,
  });
  const { list } = regions(bitmap);
  collector.regions = list.length;
  for (const region of list) {
    const { angles } = regionAngles(bitmap, region, [-6, 6]);
    for (const angle of angles)
      if (
        await readRegion(
          bitmap,
          collector,
          tryHarder ? "roi-hard" : "roi-fast",
          region,
          angle,
          { tryHarder },
        )
      )
        break;
  }
}

async function cascade(bitmap, collector, target) {
  const started = now();
  const over = () => now() - started > CASCADE_BUDGET_MS;
  const done = () => target === "TICKET" && collector.ticketComplete();
  const stage = (name) =>
    collector.stages.push({ name, atMs: Math.round(now() - started) });
  // A. Cheap full-frame pass: every symbol, both identities, no early stop.
  stage("A-full1600-fast");
  await readFull(bitmap, collector, "A", 1600, { tryHarder: false });
  // A ticket with a JOB and a product is complete: the full-frame pass already
  // returned every symbol it saw (up to 8), so ambiguity is retained, not hidden.
  if (done()) return;
  const { list } = regions(bitmap);
  collector.regions = list.length;
  const unresolved = () => list.filter((r) => !collector.covers(r.rect));
  // B. Native ROI fast pass on regions no symbol explains (multi-label completeness).
  stage("B-roi-fast");
  for (const region of unresolved()) {
    if (over()) return (collector.budgetHit = true);
    const { angles } = regionAngles(bitmap, region, []);
    for (const angle of angles)
      if (
        await readRegion(bitmap, collector, "B", region, angle, {
          tryHarder: false,
        })
      )
        break;
  }
  // Locations: stop once anything strict is read (B already visited every unexplained region).
  if (target === "TICKET" ? done() : collector.symbols.size) return;
  // C. Hard pass: full-frame 3000 tryHarder, then bounded angles on still-unresolved regions.
  stage("C-full3000-hard");
  await readFull(bitmap, collector, "C", 3000, { tryHarder: true });
  if (target === "TICKET" ? done() : collector.symbols.size) return;
  stage("C-roi-hard");
  for (const region of unresolved()) {
    if (over()) return (collector.budgetHit = true);
    const { angles } = regionAngles(bitmap, region, [-4, 4, -8, 8]);
    for (const angle of angles)
      if (
        await readRegion(bitmap, collector, "C", region, angle, {
          tryHarder: true,
        })
      )
        break;
  }
  if (target === "TICKET" ? done() : collector.symbols.size) return;
  // D. Review-only rescue: single-scanline and curve correction; never auto-confirmed.
  stage("D-review-rescue");
  for (const region of unresolved()) {
    for (const [angle, curve] of [
      [0, 0],
      [0, 0.15],
      [0, -0.15],
    ]) {
      if (over()) return (collector.budgetHit = true);
      const options = { tryHarder: true, tryDownscale: false, minLineCount: 1 };
      if (
        await readRegion(
          bitmap,
          collector,
          "D",
          region,
          angle,
          options,
          true,
          curve,
        )
      )
        break;
    }
  }
}

const variants = {
  async full1600fast(b, c) {
    await readFull(b, c, "full", 1600, { tryHarder: false });
  },
  async full1600(b, c) {
    await readFull(b, c, "full", 1600, { tryHarder: true });
  },
  async full3000(b, c) {
    await readFull(b, c, "full", 3000, { tryHarder: true });
  },
  async roiFast(b, c) {
    await roi(b, c, false);
  },
  async roiHard(b, c) {
    await roi(b, c, true);
  },
  async cascade(b, c, target) {
    await cascade(b, c, target);
  },
};

self.onmessage = async (event) => {
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  const { data } = event;
  if (data.cmd === "init") {
    const started = now();
    wasmUrl = data.wasmUrl;
    await prepareZXingModule({
      overrides: { locateFile: () => wasmUrl },
      fireImmediately: true,
    });
    self.postMessage({ initMs: now() - started });
    return;
  }
  let bitmap;
  try {
    const t0 = now();
    bitmap = await createImageBitmap(data.file);
    const bitmapMs = now() - t0;
    const t1 = now();
    if (data.variant === "prodWarm") {
      // Production pipeline in a warm worker: isolates spawn/WASM-init from decode work.
      const result = await decodeBarcodeBitmap(bitmap, data.target, wasmUrl);
      self.postMessage({
        bitmapMs,
        decodeMs: now() - t1,
        width: bitmap.width,
        height: bitmap.height,
        production: result,
      });
      return;
    }
    const collector = new Collector();
    await variants[data.variant](bitmap, collector, data.target);
    self.postMessage({
      bitmapMs,
      decodeMs: now() - t1,
      width: bitmap.width,
      height: bitmap.height,
      attempts: collector.attempts,
      regions: collector.regions,
      stages: collector.stages,
      budgetHit: !!collector.budgetHit,
      symbols: collector.list(),
    });
  } catch (error) {
    self.postMessage({ error: String(error?.stack || error) });
  } finally {
    bitmap?.close();
  }
};
