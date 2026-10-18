// Browser-side live-camera replay for TopGold photos. Every measured call runs
// strictly sequentially. Frames are downscaled copies of real photos (aspect
// preserved, never upscaled); they are NOT phone camera frames.
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  BarcodeFormat,
  DecodeHintType,
  MultiFormatReader,
} from "@zxing/library";
// Actual production fallback decoder used by useBarcodeCamera.ts.
import { decodeBarcodeCanvas } from "/src/features/finishedGoods/barcodeDecoder.ts";

// BarcodeCameraBox.tsx overlay: inset-x-[10%] top-[37.5%] h-1/4 over an object-contain
// video whose box has the video aspect, so it maps 1:1 to frame fractions.
const OVERLAY = { x: 0.1, y: 0.375, width: 0.8, height: 0.25 };
const IGNORED = ["NotFoundException", "ChecksumException", "FormatException"];
const WORKER_TIMEOUT_MS = 10000;
const wasmUrl = new URL("/barcode/zxing_reader.wasm", location.origin).href;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = (value) => {
  window.progress = { ...window.progress, ...value };
  document.querySelector("#status").textContent = JSON.stringify(
    window.progress,
  );
};
const post = (run, row) =>
  fetch(`/__result?run=${run}`, { method: "POST", body: JSON.stringify(row) });

// ---- Main-thread blocking evidence -------------------------------------------------
const longTasks = [];
const longTaskSupported =
  PerformanceObserver.supportedEntryTypes?.includes("longtask");
if (longTaskSupported)
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      longTasks.push([entry.startTime, entry.duration]);
  }).observe({ type: "longtask", buffered: true });

async function blocking(t0, t1) {
  // Long-task entries are queued after the task ends; yield before reading them.
  await sleep(0);
  await sleep(10);
  let max = 0,
    sum = 0,
    count = 0;
  for (const [start, duration] of longTasks)
    if (start < t1 && start + duration > t0) {
      max = Math.max(max, duration);
      sum += duration;
      count++;
    }
  if (longTasks.length > 5000) longTasks.splice(0, longTasks.length - 1000);
  return { longTaskMaxMs: max, longTaskSumMs: sum, longTaskCount: count };
}

function kindOf(error) {
  return typeof error?.getKind === "function"
    ? error.getKind()
    : error?.name || String(error);
}

// ---- Decoders -------------------------------------------------------------------
function jsReader(hinted) {
  // Same constructor options as useBarcodeCamera.ts; hinted only adds POSSIBLE_FORMATS.
  const hints = hinted
    ? new Map([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE],
        ],
      ])
    : undefined;
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanSuccess: 100,
    delayBetweenScanAttempts: 100,
  });
}

/** One live attempt as BrowserCodeReader.scan does it: drawImage(source) then decodeFromCanvas. */
function jsAttempt(reader, frame, capture) {
  capture.context.drawImage(frame, 0, 0);
  try {
    const result = reader.decodeFromCanvas(capture.canvas);
    const points = result.getResultPoints() || [];
    const centre = points.length
      ? [
          Math.round(points.reduce((s, p) => s + p.getX(), 0) / points.length),
          Math.round(points.reduce((s, p) => s + p.getY(), 0) / points.length),
        ]
      : null;
    return {
      symbols: [
        {
          text: result.getText(),
          format: BarcodeFormat[result.getBarcodeFormat()],
          centre,
        },
      ],
    };
  } catch (error) {
    const kind = kindOf(error);
    return IGNORED.includes(kind)
      ? { symbols: [], miss: kind }
      : { symbols: [], error: kind };
  }
}

/** Mirror of useBarcodeCamera fallback(): ≤2400 px canvas, production decodeBarcodeCanvas, 1200 ms budget. */
async function liveFallback(frame) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 2400 / Math.max(frame.width, frame.height));
  canvas.width = Math.round(frame.width * scale);
  canvas.height = Math.round(frame.height * scale);
  try {
    canvas.getContext("2d").drawImage(frame, 0, 0, canvas.width, canvas.height);
    const codes = await decodeBarcodeCanvas(canvas, {
      signal: new AbortController().signal,
      budgetMs: 1200,
    });
    // The hook delivers only a singleton.
    return {
      symbols: codes.map((text) => ({ text })),
      accepted: codes.length === 1 ? codes[0] : null,
    };
  } catch (error) {
    return { symbols: [], error: kindOf(error) };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

let worker;
let job = 0;
function spawnWorker() {
  worker = new Worker(new URL("./wasm.worker.js", import.meta.url), {
    type: "module",
  });
}
function workerCall(message, transfer = []) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      spawnWorker();
      resolve({ timeout: true, respawned: true });
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      resolve(data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      resolve({ error: event.message || "worker error" });
    };
    worker.postMessage(message, transfer);
  });
}
async function initWorker() {
  const started = performance.now();
  spawnWorker();
  const { initMs } = await workerCall({ cmd: "init", wasmUrl });
  return { spawnToReadyMs: performance.now() - started, initMs };
}

/** Latest-frame grab: createImageBitmap(source) on the main thread, transferred (not copied). */
async function wasmAttempt(mode, source) {
  const t0 = performance.now();
  const bitmap = await createImageBitmap(source);
  const t1 = performance.now();
  const pending = workerCall({ bitmap, mode, overlay: OVERLAY, job: ++job }, [
    bitmap,
  ]);
  const postMs = performance.now() - t1;
  const result = await pending;
  if (result.timeout && worker) await workerCall({ cmd: "init", wasmUrl });
  return { grabMs: t1 - t0, postMs, ...result };
}

let detector;
async function nativeAttempt(frame) {
  const found = await detector.detect(frame);
  return {
    symbols: found.map((b) => ({
      text: b.rawValue,
      format: b.format,
      centre: [
        Math.round(b.boundingBox.x + b.boundingBox.width / 2),
        Math.round(b.boundingBox.y + b.boundingBox.height / 2),
      ],
    })),
  };
}

// ---- Frames ---------------------------------------------------------------------
async function source(id) {
  const blob = await (await fetch(`/__image/${id}`)).blob();
  return createImageBitmap(blob);
}
async function frameOf(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale),
    height = Math.round(bitmap.height * scale);
  return createImageBitmap(bitmap, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
}
function captureFor(frame) {
  // BrowserCodeReader.createCaptureCanvas sizes the canvas to the media element.
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  return {
    canvas,
    context: canvas.getContext("2d", { willReadFrequently: true }),
  };
}
async function syntheticFrame(kind, width = 1440, height = 1920) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (kind === "blank") {
    context.fillStyle = "#f4f4f2";
    context.fillRect(0, 0, width, height);
  } else {
    const data = context.createImageData(width, height);
    let seed = 7;
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = 90 + (seed % 90);
      data.data[i + 3] = 255;
    }
    context.putImageData(data, 0, 0);
  }
  return createImageBitmap(canvas);
}

// ---- Variants -------------------------------------------------------------------
let readers;
function variantsFor(frame, capture) {
  const list = {
    jsDefault: () => jsAttempt(readers.jsDefault, frame, capture),
    jsHinted: () => jsAttempt(readers.jsHinted, frame, capture),
    liveFallback: () => liveFallback(frame),
    wasmFast: () => wasmAttempt("fast", frame),
    wasmHard: () => wasmAttempt("hard", frame),
    wasmRoiFast: () => wasmAttempt("roiFast", frame),
    wasmRegions: () => wasmAttempt("regions", frame),
  };
  if (detector) list.native = () => nativeAttempt(frame);
  return list;
}

async function measure(fn) {
  const t0 = performance.now();
  const result = await fn();
  const t1 = performance.now();
  return { wallMs: t1 - t0, ...result, ...(await blocking(t0, t1)) };
}

window.mobileCaps = async () => {
  const caps = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    longTaskSupported,
    windowBarcodeDetector: "BarcodeDetector" in window,
    windowFormats: null,
  };
  if (caps.windowBarcodeDetector)
    try {
      caps.windowFormats = await window.BarcodeDetector.getSupportedFormats();
    } catch (error) {
      caps.windowFormats = `error: ${error}`;
    }
  const probe = new Worker(new URL("./wasm.worker.js", import.meta.url), {
    type: "module",
  });
  caps.worker = await new Promise((resolve) => {
    probe.onmessage = ({ data }) => resolve(data);
    probe.postMessage({ cmd: "caps" });
  });
  probe.terminate();
  return caps;
};

window.mobileManifest = async () => (await fetch("/__manifest")).json();

/** Sets up warm decoders once. Native is enabled only when both formats are supported. */
window.mobileSetup = async (run) => {
  const caps = await window.mobileCaps();
  const nativeOk =
    Array.isArray(caps.windowFormats) &&
    ["code_128", "qr_code"].every((f) => caps.windowFormats.includes(f));
  if (nativeOk)
    detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code"] });
  readers = { jsDefault: jsReader(false), jsHinted: jsReader(true) };
  const setup = [];
  for (let i = 0; i < 3; i++) {
    worker?.terminate();
    setup.push(await initWorker()); // last one stays as the single warm worker
  }
  const row = {
    kind: "setup",
    caps,
    nativeEnabled: nativeOk,
    workerSetup: setup,
  };
  await post(run, row);
  return row;
};

/**
 * plan: { ids, sizes, variants, reps }. Variant order rotates per image and rep so no
 * variant always runs first. Warm-up calls on the first image are recorded, not scored.
 */
window.mobileRun = async (run, plan, phase) => {
  const targets = new Map(
    (await window.mobileManifest()).map((r) => [r.id, r.target]),
  );
  let order = 0;
  const runCalls = async (kind, id, target, frame, size, reps, salt) => {
    const capture = captureFor(frame);
    const table = variantsFor(frame, capture);
    const names = plan.variants.filter((v) => table[v]);
    for (let rep = 0; rep < reps; rep++) {
      const shift = (salt + rep) % names.length;
      for (const variant of [...names.slice(shift), ...names.slice(0, shift)]) {
        status({ run, phase, kind, id, size, rep, variant, order });
        const result = await measure(table[variant]);
        await post(run, {
          kind,
          phase,
          order: order++,
          id,
          target,
          size,
          width: frame.width,
          height: frame.height,
          rep,
          variant,
          ...result,
        });
      }
    }
    capture.canvas.width = capture.canvas.height = 0;
  };
  // Warm-up: JIT and decoder state, excluded from scoring.
  {
    const bitmap = await source(plan.ids[0]);
    const frame = await frameOf(bitmap, plan.sizes[0]);
    await runCalls(
      "warmup",
      plan.ids[0],
      targets.get(plan.ids[0]),
      frame,
      plan.sizes[0],
      2,
      0,
    );
    frame.close();
    bitmap.close();
  }
  for (const [index, id] of plan.ids.entries()) {
    const bitmap = await source(id);
    for (const size of plan.sizes) {
      const frame = await frameOf(bitmap, size);
      await runCalls(
        "result",
        id,
        targets.get(id),
        frame,
        size,
        plan.reps,
        index,
      );
      frame.close();
    }
    bitmap.close();
  }
  if (plan.controls)
    for (const control of ["blank", "noise"]) {
      const frame = await syntheticFrame(control);
      await runCalls("control", control, "ANY", frame, 1920, 1, 0);
      frame.close();
    }
  status({ state: "complete" });
};

// ---- Live scheduling replay (static frame via canvas.captureStream; NOT a camera) ---
function frameStream(frame) {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  context.drawImage(frame, 0, 0);
  const stream = canvas.captureStream(30);
  // Repaint the same pixels so the stream keeps delivering frames like a camera.
  const timer = setInterval(() => context.drawImage(frame, 0, 0), 33);
  return {
    stream,
    dispose() {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      canvas.width = canvas.height = 0;
    },
  };
}

function gapMeter() {
  let last = performance.now(),
    max = 0,
    frames = 0,
    on = true;
  const tick = (t) => {
    max = Math.max(max, t - last);
    last = t;
    frames++;
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => ((on = false), { rafMaxGapMs: max, rafFrames: frames });
}

function dedupe(t0, events, stoppedRef) {
  const seen = new Map();
  return (raw, via) => {
    if (stoppedRef.stopped) {
      stoppedRef.lateCallbacks++;
      return;
    }
    const code = raw.trim();
    const now = Date.now();
    if (!code || now - (seen.get(code) ?? -Infinity) < 1000) return;
    for (const [old, time] of seen) if (now - time >= 1000) seen.delete(old);
    seen.set(code, now);
    events.push({ atMs: Math.round(performance.now() - t0), code, via });
  };
}

/** Production scheduling: JS reader every 100 ms after each attempt + main-thread fallback. */
async function currentScheduler(stream, video, windowMs) {
  const t0 = performance.now();
  const events = [];
  const ref = { stopped: false, lateCallbacks: 0 };
  const accept = dedupe(t0, events, ref);
  const fallbackAbort = new AbortController();
  const fallbacks = [];
  let attempts = 0,
    fallbackPending = false,
    fallbackAt = 0,
    decoderError = null;
  async function fallback() {
    if (
      !video.videoWidth ||
      ref.stopped ||
      fallbackPending ||
      Date.now() < fallbackAt
    )
      return;
    fallbackPending = true;
    fallbackAt = Date.now() + 1500;
    const started = performance.now();
    const frame = document.createElement("canvas");
    const scale = Math.min(
      1,
      2400 / Math.max(video.videoWidth, video.videoHeight),
    );
    frame.width = Math.round(video.videoWidth * scale);
    frame.height = Math.round(video.videoHeight * scale);
    let codes = [];
    try {
      frame.getContext("2d").drawImage(video, 0, 0, frame.width, frame.height);
      codes = await decodeBarcodeCanvas(frame, {
        signal: fallbackAbort.signal,
        budgetMs: 1200,
      });
      if (codes.length === 1) accept(codes[0], "fallback");
    } catch {
      // Ordinary decoder remains active.
    } finally {
      fallbacks.push({
        atMs: Math.round(started - t0),
        ms: Math.round(performance.now() - started),
        codes: codes.length,
      });
      frame.width = frame.height = 0;
      fallbackPending = false;
    }
  }
  const reader = jsReader(false);
  const controls = await reader.decodeFromStream(
    stream,
    video,
    (result, error, callbackControls) => {
      if (ref.stopped) {
        ref.lateCallbacks++;
        callbackControls.stop();
        return;
      }
      attempts++;
      if (result) accept(result.getText(), "js");
      else if (error && !IGNORED.includes(kindOf(error))) {
        decoderError = kindOf(error);
        callbackControls.stop();
      } else void fallback();
    },
  );
  const readyMs = performance.now() - t0;
  await sleep(windowMs);
  const stopAt = performance.now();
  ref.stopped = true;
  fallbackAbort.abort();
  controls.stop();
  const stopMs = performance.now() - stopAt;
  await sleep(1500); // observe any late callbacks after stop
  return {
    readyMs,
    windowMs: Math.round(stopAt - t0),
    stopMs,
    attempts,
    fallbacks,
    decoderError,
    events,
    lateCallbacks: ref.lateCallbacks,
  };
}

/**
 * Proposed scheduling (predeclared): one warm worker; latest frame only (grab the next
 * frame only after the previous decode returns, no queue); overlay ROI fast on grabs
 * 0,1,2 of each 4, full-frame on every 4th grab; a full slot is "hard" when the two
 * previous full slots decoded nothing. All distinct valid symbols are delivered.
 */
const JOB_LIKE = /^FOM?\d{4,}$/i;
/** Acquisition-level "unresolved": hook mode only, never labels. */
function unresolved(target, symbols) {
  if (target === "LOCATION") return symbols.length === 0;
  return !(
    symbols.some((s) => JOB_LIKE.test(s.text)) &&
    symbols.some((s) => /128/.test(s.format) && !JOB_LIKE.test(s.text))
  );
}

async function proposedScheduler(stream, video, windowMs, escalate, target) {
  video.srcObject = stream;
  await video.play();
  const t0 = performance.now();
  const events = [];
  const ref = { stopped: false, lateCallbacks: 0 };
  const accept = dedupe(t0, events, ref);
  const grabs = { roiFast: 0, fast: 0, hard: 0, regions: 0 };
  let escalateHard = false;
  let k = 0,
    emptyFull = 0,
    workerMs = 0,
    mainMs = 0,
    inFlight;
  // Every grab is a fresh latest frame; a result that lands after stop is dropped.
  const run = async (slot) => {
    inFlight = wasmAttempt(slot, video);
    const result = await inFlight;
    if (ref.stopped) {
      ref.lateCallbacks += result.symbols?.length ? 1 : 0; // dropped, never delivered
      return null;
    }
    grabs[slot]++;
    workerMs += (result.pixelsMs || 0) + (result.decodeMs || 0);
    mainMs += result.grabMs + result.postMs;
    const symbols = result.symbols || [];
    for (const s of symbols) accept(s.text, slot);
    return symbols;
  };
  const loop = async () => {
    while (!ref.stopped) {
      const full = k++ % 4 === 3;
      if (!full) {
        if ((await run("roiFast")) === null) break;
        continue;
      }
      if (!escalate) {
        // v1 (predeclared): hard when the two previous full slots decoded nothing.
        const symbols = await run(emptyFull >= 2 ? "hard" : "fast");
        if (symbols === null) break;
        emptyFull = symbols.length ? 0 : emptyFull + 1;
        continue;
      }
      // v2 (post hoc, designed after the first pass on the same photos): an unresolved
      // full frame gets a bounded region rescue on a fresh grab; if still unresolved,
      // the next full slot is a hard pass instead of a fast one.
      const first = await run(escalateHard ? "hard" : "fast");
      if (first === null) break;
      if (!unresolved(target, first)) {
        escalateHard = false;
        continue;
      }
      const rescue = await run("regions");
      if (rescue === null) break;
      escalateHard = unresolved(target, [...first, ...rescue]);
    }
  };
  const running = loop();
  await sleep(windowMs);
  const stopAt = performance.now();
  ref.stopped = true;
  await running; // a real stop would terminate a long hard pass; here it is ≤ one call
  const stopMs = performance.now() - stopAt;
  video.srcObject = null;
  return {
    readyMs: 0,
    windowMs: Math.round(stopAt - t0),
    stopMs,
    grabs,
    workerMs: Math.round(workerMs),
    mainMs: Math.round(mainMs),
    events,
    lateCallbacks: ref.lateCallbacks,
  };
}

window.mobileLive = async (
  run,
  { ids, windowMs, size, schedulerList = ["current", "proposed"] },
) => {
  const targets = new Map(
    (await window.mobileManifest()).map((r) => [r.id, r.target]),
  );
  let order = 0;
  for (const [index, id] of ids.entries()) {
    const bitmap = await source(id);
    const frame = await frameOf(bitmap, size);
    bitmap.close();
    const schedulers = index % 2 ? [...schedulerList].reverse() : schedulerList;
    for (const scheduler of schedulers) {
      status({ run, phase: "live", id, scheduler, order });
      const { stream, dispose } = frameStream(frame);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      document.body.append(video);
      const stopGap = gapMeter();
      const t0 = performance.now();
      const result =
        scheduler === "current"
          ? await currentScheduler(stream, video, windowMs)
          : await proposedScheduler(
              stream,
              video,
              windowMs,
              scheduler === "proposedV2",
              targets.get(id),
            );
      const t1 = t0 + (result.readyMs || 0) + result.windowMs;
      const gaps = stopGap();
      dispose();
      video.remove();
      await post(run, {
        kind: "live",
        order: order++,
        id,
        target: targets.get(id),
        size,
        width: frame.width,
        height: frame.height,
        scheduler,
        ...result,
        ...gaps,
        ...(await blocking(t0, t1)),
      });
    }
    frame.close();
  }
  status({ state: "complete" });
};

/**
 * Diagnostic only: the production fallback returns text without a format. Wrap the
 * shared ZXing MultiFormatReader to record which symbology produced each result.
 */
window.mobileDiagnose = async (run, items) => {
  const original = MultiFormatReader.prototype.decodeWithState;
  const log = [];
  MultiFormatReader.prototype.decodeWithState = function (bitmap) {
    const result = original.call(this, bitmap);
    log.push({
      text: result.getText(),
      format: BarcodeFormat[result.getBarcodeFormat()],
    });
    return result;
  };
  try {
    for (const { id, size } of items) {
      const bitmap = await source(id);
      const frame = await frameOf(bitmap, size);
      bitmap.close();
      log.length = 0;
      const result = await liveFallback(frame);
      frame.close();
      await post(run, {
        kind: "diagnose",
        id,
        size,
        accepted: result.accepted,
        decodes: [...log],
      });
    }
  } finally {
    MultiFormatReader.prototype.decodeWithState = original;
  }
};

status({ state: "ready" });
window.mobileReady = true;
