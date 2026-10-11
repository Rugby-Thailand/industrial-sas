/* global ZXingBrowser */
// Numeric enums from the installed ZXing bundle: POSSIBLE_FORMATS=2,
// TRY_HARDER=3, CODE_128=4. The benchmark intentionally uses its public UMD API.
const defaultReader = new ZXingBrowser.BrowserMultiFormatReader();
const harderReader = new ZXingBrowser.BrowserMultiFormatReader(
  new Map([[3, true]]),
);
const code128Reader = new ZXingBrowser.BrowserMultiFormatReader(
  new Map([
    [2, [4]],
    [3, true],
  ]),
);
// MessageChannel yields without background-tab timer throttling contaminating timings.
const nextTask = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
window.benchmarkState = { running: false };

let wasmReady;
async function loadWasm() {
  wasmReady ??= (async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/zxing-wasm.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    await window.ZXingWASM.prepareZXingModule({
      overrides: { locateFile: (path) => `/${path}` },
      fireImmediately: true,
    });
    return window.ZXingWASM;
  })();
  return wasmReady;
}

function makeCanvas(
  image,
  region,
  angle = 0,
  scale = 1,
  filter = "none",
  curve = 0,
) {
  const [x, y, w, h] = region;
  const radians = (angle * Math.PI) / 180;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(
    (Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians))) * scale,
  );
  canvas.height = Math.ceil(
    (Math.abs(w * Math.sin(radians)) +
      Math.abs(h * Math.cos(radians)) +
      Math.abs(curve) * w) *
      scale,
  );
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  ctx.filter = filter;
  if (curve) {
    // Classical geometric correction: flatten a bowed label, no learned model.
    for (let column = 0; column < w; column++) {
      const offset = curve * w * (column / w - 0.5) ** 2;
      ctx.drawImage(
        image,
        x + column,
        y,
        1,
        h,
        (-w / 2 + column) * scale,
        (-h / 2 - offset) * scale,
        scale,
        h * scale,
      );
    }
  } else
    ctx.drawImage(
      image,
      x,
      y,
      w,
      h,
      (-w * scale) / 2,
      (-h * scale) / 2,
      w * scale,
      h * scale,
    );
  return canvas;
}

function decode(reader, canvas, label, region, angle = 0) {
  const start = performance.now();
  try {
    const result = reader.decodeFromCanvas(canvas);
    return {
      label,
      region,
      angle,
      text: result.getText(),
      format: result.getBarcodeFormat(),
      ms: performance.now() - start,
    };
  } catch (error) {
    const kind = error.getKind?.() || error.name;
    if (
      !["NotFoundException", "ChecksumException", "FormatException"].includes(
        kind,
      )
    )
      throw error;
    return { label, region, angle, error: kind, ms: performance.now() - start };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

const isProduct = (result) =>
  result.isValid &&
  result.format === "Code128" &&
  !/^FO\d+$/i.test(result.text);

async function decodeOptimized(image, wasm, row, allowCurve) {
  const w = image.naturalWidth,
    h = image.naturalHeight;
  const started = performance.now();
  const budgetMs = allowCurve ? 15000 : 5000,
    maxAttempts = 140;
  row.budget = { budgetMs, maxAttempts };
  row.reviewRequired = false;
  async function attempt(region, angle = 0, curve = 0) {
    if (
      performance.now() - started >= budgetMs ||
      row.attempts.length >= maxAttempts
    ) {
      row.budgetExhausted = true;
      return [];
    }
    const options = {
      formats: ["Code128", "QRCode"],
      tryHarder: true,
      maxNumberOfSymbols: 8,
      ...(curve ? { tryDownscale: false, minLineCount: 1 } : {}),
    };
    const canvas = makeCanvas(image, region, angle, 1, "none", curve);
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height);
    const decodeStart = performance.now();
    const results = await wasm.readBarcodes(pixels, options);
    canvas.width = canvas.height = 1;
    row.attempts.push({
      region,
      angle,
      curve,
      options,
      ms: performance.now() - decodeStart,
      results: results.map(({ text, format, isValid, position }) => ({
        text,
        format,
        isValid,
        position,
      })),
    });
    await nextTask();
    return results.filter(isProduct);
  }
  const full = await attempt([0, 0, w, h]);
  if (full.length) return full;
  // Prioritize the lower part of this application's pallet ticket layout;
  // all overlapping bands remain available. No image name or identity is used.
  for (const index of [6, 7, 8, 5, 4, 3, 2, 1, 0]) {
    const region = [0, Math.floor(h * index * 0.08), w, Math.ceil(h * 0.28)];
    for (const angle of [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]) {
      const results = await attempt(region, angle);
      if (results.length) return results;
      if (row.budgetExhausted) return [];
    }
    if (allowCurve && index === 7) {
      const center = [
        Math.floor(w * 0.2),
        Math.floor(h * index * 0.08),
        Math.ceil(w * 0.6),
        Math.ceil(h * 0.12),
      ];
      for (const curve of [0.1, 0.2, -0.1, -0.2]) {
        for (const angle of [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]) {
          const results = await attempt(center, angle, curve);
          if (results.length) {
            row.reviewRequired = true;
            return results;
          }
          if (row.budgetExhausted) return [];
        }
      }
    }
  }
  return [];
}

window.runBenchmark = async (stage) => {
  if (window.benchmarkState.running)
    throw new Error("Benchmark already running");
  const state = (window.benchmarkState = { stage, running: true, results: [] });
  const status = document.getElementById("status");
  try {
    const initStart = performance.now();
    const wasm = stage.startsWith("wasm") ? await loadWasm() : undefined;
    state.initMs = performance.now() - initStart;
    const manifest = await (await fetch("/manifest.json")).json();
    for (const item of manifest) {
      status.textContent = `${stage}: ${item.name}`;
      const image = new Image();
      image.src = `/images/${item.name}`;
      await image.decode();
      const w = image.naturalWidth,
        h = image.naturalHeight;
      const row = { ...item, width: w, height: h, attempts: [] };
      const start = performance.now();
      if (stage === "wasm-fast" || stage === "wasm-optimized") {
        const results = await decodeOptimized(
          image,
          wasm,
          row,
          stage === "wasm-optimized",
        );
        row.codes = [...new Set(results.map((r) => r.text))];
      } else if (wasm) {
        const regions =
          stage === "wasm-full"
            ? [[0, 0, w, h]]
            : Array.from({ length: 9 }, (_, index) => [
                0,
                Math.floor(h * index * 0.08),
                w,
                Math.ceil(h * 0.28),
              ]);
        const angles =
          stage === "wasm-angles"
            ? [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]
            : [0];
        const options = {
          formats: ["Code128", "QRCode"],
          tryHarder: true,
          maxNumberOfSymbols: 8,
        };
        const found = new Set();
        for (const region of regions) {
          for (const angle of angles) {
            const canvas = makeCanvas(image, region, angle);
            const pixels = canvas
              .getContext("2d")
              .getImageData(0, 0, canvas.width, canvas.height);
            const decodeStart = performance.now();
            const results = await wasm.readBarcodes(pixels, options);
            row.attempts.push({
              label: stage,
              region,
              angle,
              options,
              ms: performance.now() - decodeStart,
              results: results.map(({ text, format, position, isValid }) => ({
                text,
                format,
                position,
                isValid,
              })),
            });
            for (const result of results) found.add(result.text);
            canvas.width = canvas.height = 1;
            await nextTask();
            if (
              results.some(
                (r) => r.format === "Code128" && !/^FO\d+$/i.test(r.text),
              )
            )
              break;
          }
        }
        row.codes = [...found];
      } else if (stage === "baseline") {
        for (const [label, reader] of [
          ["default-full", defaultReader],
          ["harder-full", harderReader],
          ["code128-full", code128Reader],
        ]) {
          row.attempts.push(
            decode(reader, makeCanvas(image, [0, 0, w, h]), label, [
              0,
              0,
              w,
              h,
            ]),
          );
          await nextTask();
        }
      } else {
        // Generic overlapping full-width bands; never per-photo coordinates.
        const regions = Array.from({ length: 9 }, (_, index) => [
          0,
          Math.floor(h * index * 0.08),
          w,
          Math.ceil(h * 0.28),
        ]);
        const angles =
          stage === "angles" || stage === "js-targeted"
            ? [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]
            : [0];
        if (stage === "js-targeted")
          regions.splice(0, regions.length, [
            0,
            Math.floor(h * 0.56),
            w,
            Math.ceil(h * 0.28),
          ]);
        const found = new Set();
        for (const region of regions) {
          for (const angle of angles) {
            const attempt = decode(
              code128Reader,
              makeCanvas(image, region, angle),
              "code128-band",
              region,
              angle,
            );
            row.attempts.push(attempt);
            if (attempt.text) found.add(attempt.text);
            await nextTask();
            // One valid Code128 result per band is sufficient for this experiment.
            if (attempt.text) break;
          }
        }
        row.codes = [...found];
      }
      row.totalMs = performance.now() - start;
      state.results.push(row);
      status.textContent = JSON.stringify(state, null, 2);
      image.src = "";
      await nextTask();
    }
    const output = {
      stage,
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      decoder: wasm
        ? `zxing-wasm ${wasm.ZXING_WASM_VERSION}`
        : "@zxing/browser 0.2.1 (installed UMD)",
      initMs: state.initMs,
      results: state.results,
    };
    const saved = await fetch(`/results/${stage}`, {
      method: "POST",
      body: JSON.stringify(output),
    });
    if (!saved.ok) throw new Error(await saved.text());
    state.saved = true;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.running = false;
    status.textContent = JSON.stringify(state, null, 2);
  }
  return state;
};
