// Browser-side driver for the Kiro TopGold benchmark. Variants run strictly
// sequentially (never concurrently) so timings do not compete for CPU.
import { readBarcodeImage } from "/src/features/finishedGoods/barcodeImage.ts";

const HARD_TIMEOUT_MS = 20000;
const wasmUrl = new URL("/barcode/zxing_reader.wasm", location.origin).href;
const blobs = new Map();
const status = (value) => {
  window.progress = { ...window.progress, ...value };
  document.querySelector("#status").textContent = JSON.stringify(
    window.progress,
  );
};
let worker;

function call(message, timeoutMs = HARD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      worker = undefined;
      resolve({ timeout: true });
    }, timeoutMs);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      resolve(data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      resolve({ error: event.message || "worker error" });
    };
    worker.postMessage(message);
  });
}

async function spawn() {
  const started = performance.now();
  worker = new Worker(new URL("./variants.worker.js", import.meta.url), {
    type: "module",
  });
  const { initMs } = await call({ cmd: "init", wasmUrl }, 60000);
  return { spawnToReadyMs: performance.now() - started, initMs };
}

async function image(id) {
  if (!blobs.has(id)) {
    const blob = await (await fetch(`/__image/${id}`)).blob();
    blobs.set(id, new File([blob], "input.jpg", { type: "image/jpeg" }));
  }
  return blobs.get(id);
}

async function hex(file) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function production(file, target) {
  const started = performance.now();
  try {
    const result = await readBarcodeImage(
      file,
      target,
      new AbortController().signal,
    );
    const timeout = result.elapsedMs === 20000 && result.attempts === 0;
    return { wallMs: performance.now() - started, timeout, production: result };
  } catch (error) {
    return {
      wallMs: performance.now() - started,
      error: error.code || String(error),
    };
  }
}

async function runOne(variant, file, target) {
  if (variant === "production") return production(file, target);
  if (!worker) await spawn();
  const started = performance.now();
  const result = await call({ variant, file, target });
  return { ...result, wallMs: performance.now() - started };
}

async function post(run, row) {
  await fetch(`/__result?run=${run}`, {
    method: "POST",
    body: JSON.stringify(row),
  });
}

/** Synthetic controls: never counted as independent photos. */
async function controls() {
  const make = async (w, h, draw) => {
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext("2d");
    draw(context, w, h);
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.92,
    });
    return new File([blob], "control.jpg", { type: "image/jpeg" });
  };
  const list = [];
  list.push({
    id: "blank-white",
    target: "TICKET",
    file: await make(2160, 2880, (c, w, h) => {
      c.fillStyle = "#f4f4f2";
      c.fillRect(0, 0, w, h);
    }),
  });
  list.push({
    id: "noise-gray",
    target: "LOCATION",
    file: await make(2160, 2880, (c, w, h) => {
      const data = c.createImageData(w, h);
      let seed = 7;
      for (let i = 0; i < data.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const v = 90 + (seed % 90);
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
        data.data[i + 3] = 255;
      }
      c.putImageData(data, 0, 0);
    }),
  });
  list.push({
    id: "text-only",
    target: "TICKET",
    file: await make(2160, 2880, (c, w, h) => {
      c.fillStyle = "white";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "black";
      c.font = "bold 120px sans-serif";
      c.fillText("JOB NO. FO69100219", 120, 400);
      c.font = "160px monospace";
      c.fillText("F1-L3-10", 300, 900);
      c.font = "60px sans-serif";
      for (let y = 1200; y < 2700; y += 90)
        c.fillText("|||| ||| | |||| PART NAME 01-0533 ||| |", 120, y);
      for (let x = 100; x < 2100; x += 7)
        c.fillRect(x, 2750, x % 3 ? 2 : 4, 60); // irregular stripes, not a symbology
    }),
  });
  // Multi-identity composites from two real photos (ids chosen by position, not labels).
  for (const [a, b, target] of [
    [50, 51, "TICKET"],
    [1, 4, "LOCATION"],
  ]) {
    const [fa, fb] = [await image(a), await image(b)];
    const [ia, ib] = [await createImageBitmap(fa), await createImageBitmap(fb)];
    const h = Math.min(ia.height, ib.height, 2880);
    const wa = Math.round((ia.width * h) / ia.height),
      wb = Math.round((ib.width * h) / ib.height);
    list.push({
      id: `composite-${a}-${b}`,
      target,
      sources: [a, b],
      file: await make(wa + wb, h, (c) => {
        c.drawImage(ia, 0, 0, wa, h);
        c.drawImage(ib, wa, 0, wb, h);
      }),
    });
    ia.close();
    ib.close();
  }
  return list;
}

window.kiroManifest = async () => (await fetch("/__manifest")).json();

window.kiroSetup = async (run, repeats = 5) => {
  // Cold/warm worker+WASM startup, measured apart from any image work.
  for (let i = 0; i < repeats; i++) {
    worker?.terminate();
    worker = undefined;
    const timing = await spawn();
    await post(run, { kind: "setup", sample: i, ...timing });
  }
};

window.kiroProbe = async (run) => {
  // Source hash, dimensions and main-thread JPEG decode boundary per image.
  for (const row of await window.kiroManifest()) {
    const file = await image(row.id);
    const started = performance.now();
    const bitmap = await createImageBitmap(file);
    const bitmapMs = performance.now() - started;
    await post(run, {
      kind: "probe",
      ...row,
      sha256: await hex(file),
      bytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
      bitmapMs,
    });
    bitmap.close();
  }
};

/** plan: [{ round, variant, ids }]; executed strictly in the given order. */
window.kiroRun = async (run, plan) => {
  const targets = new Map(
    (await window.kiroManifest()).map((r) => [r.id, r.target]),
  );
  let order = 0;
  for (const step of plan) {
    for (const id of step.ids) {
      status({ run, round: step.round, variant: step.variant, id, order });
      const file = await image(id);
      const result = await runOne(step.variant, file, targets.get(id));
      await post(run, {
        kind: "result",
        order: order++,
        round: step.round,
        variant: step.variant,
        id,
        target: targets.get(id),
        bytes: file.size,
        ...result,
      });
    }
  }
  status({ state: "complete" });
};

window.kiroControls = async (run, variantList) => {
  const list = await controls();
  let order = 0;
  for (const variant of variantList)
    for (const control of list) {
      status({ run, variant, id: control.id });
      const result = await runOne(variant, control.file, control.target);
      await post(run, {
        kind: "control",
        order: order++,
        variant,
        id: control.id,
        target: control.target,
        sources: control.sources,
        ...result,
      });
    }
};

window.kiroInfo = () => ({
  userAgent: navigator.userAgent,
  hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory,
  crossOriginIsolated,
});
status({ state: "ready" });
window.kiroReady = true;
