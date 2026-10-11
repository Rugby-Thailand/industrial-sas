/* global ZXingWASM */
let ready;
const yieldTask = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

function canvasFor(image, [x, y, w, h], angle, curve) {
  const radians = (angle * Math.PI) / 180;
  const canvas =
    typeof document === "undefined"
      ? new OffscreenCanvas(1, 1)
      : document.createElement("canvas");
  canvas.width = Math.ceil(
    Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)),
  );
  canvas.height = Math.ceil(
    Math.abs(w * Math.sin(radians)) +
      Math.abs(h * Math.cos(radians)) +
      Math.abs(curve) * w,
  );
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  if (curve)
    for (let column = 0; column < w; column++) {
      const offset = curve * w * (column / w - 0.5) ** 2;
      ctx.drawImage(
        image,
        x + column,
        y,
        1,
        h,
        -w / 2 + column,
        -h / 2 - offset,
        1,
        h,
      );
    }
  else ctx.drawImage(image, x, y, w, h, -w / 2, -h / 2, w, h);
  return canvas;
}

// Actual barcode pixels only. No OCR, expected-label lookup, or AI requests.
export async function decodePhoto(image, target, cancelled, onProgress) {
  ready ??= ZXingWASM.prepareZXingModule({
    overrides: { locateFile: (path) => `/${path}` },
    fireImmediately: true,
  });
  await ready;
  const w = image.naturalWidth || image.width,
    h = image.naturalHeight || image.height,
    started = performance.now();
  let attempts = 0;
  const jobs = new Set();
  let exhausted = false;
  const wanted = (r) =>
    r.isValid &&
    (target === "location" ||
      (target === "job"
        ? /^FO\d{4,}$/i.test(r.text)
        : r.format === "Code128" && !/^FO\d+$/i.test(r.text)));
  async function attempt(region, angle = 0, curve = 0) {
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    if (performance.now() - started > 15000 || attempts >= 140) {
      exhausted = true;
      return null;
    }
    const canvas = canvasFor(image, region, angle, curve);
    let results;
    try {
      results = await ZXingWASM.readBarcodes(
        canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height),
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
    for (const r of results)
      if (r.isValid && /^FO\d{4,}$/i.test(r.text)) jobs.add(r.text);
    onProgress({ attempts, elapsed: performance.now() - started });
    await yieldTask();
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    const codes = [...new Set(results.filter(wanted).map((r) => r.text))];
    return codes.length
      ? {
          codes,
          jobs: [...jobs],
          review: !!curve,
          attempts,
          ms: performance.now() - started,
        }
      : null;
  }
  let result = await attempt([0, 0, w, h]);
  if (result) return result;
  for (const index of [6, 7, 8, 5, 4, 3, 2, 1, 0]) {
    const region = [0, Math.floor(h * index * 0.08), w, Math.ceil(h * 0.28)];
    for (const angle of [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]) {
      result = await attempt(region, angle);
      if (result) return result;
      if (exhausted) return null;
    }
    if (target === "product" && index === 7)
      for (const curve of [0.1, 0.2, -0.1, -0.2]) {
        for (const angle of [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]) {
          result = await attempt(
            [
              Math.floor(w * 0.2),
              Math.floor(h * 0.56),
              Math.ceil(w * 0.6),
              Math.ceil(h * 0.12),
            ],
            angle,
            curve,
          );
          if (result) return result;
          if (exhausted) return null;
        }
      }
  }
  return null;
}

export async function decodeCamera(video) {
  ready ??= ZXingWASM.prepareZXingModule({
    overrides: { locateFile: (path) => `/${path}` },
    fireImmediately: true,
  });
  await ready;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) return [];
  try {
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    return (
      await ZXingWASM.readBarcodes(
        ctx.getImageData(0, 0, canvas.width, canvas.height),
        {
          formats: ["Code128", "QRCode"],
          tryHarder: true,
          maxNumberOfSymbols: 8,
        },
      )
    )
      .filter((r) => r.isValid)
      .map((r) => r.text);
  } finally {
    canvas.width = canvas.height = 1;
  }
}
