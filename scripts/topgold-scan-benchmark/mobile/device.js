import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat } from "@zxing/library";
import { photoPreviewUrl } from "./photo-url.mjs";
import { decodeBarcodeCanvas } from "/src/features/finishedGoods/barcodeDecoder.ts";
import {
  METHODS,
  candidates,
  fieldOf,
  targetFound,
  scoreTrial,
  summarise,
  csvCell,
} from "./device-model.mjs";

const $ = (id) => document.getElementById(id);
const STORE = "topgold-device-trials-v1";
const SCHEMA = 1;
const PIPELINE = "job-device-1";
const MIN_FRAME_MS = 100;
const IGNORED = ["NotFoundException", "ChecksumException", "FormatException"];
const REASONS = {
  timeout: "ครบเวลา",
  manual: "กดหยุด",
  "photo-complete": "อ่านภาพจบ",
  hidden: "สลับแอป/ซ่อนหน้า",
  pagehide: "ออกจากหน้า",
  "source-closed": "ปิดภาพ/กล้อง",
  error: "เกิดข้อผิดพลาด",
  "prepare-cancelled": "ยกเลิกก่อนเริ่ม",
};
let source = { kind: "none" };
let sourceGeneration = 0;
let opening = false;
let trial = null;
let nativeFormats = [];
let caps = {};
let capabilitiesReady = false;
let storageError = "";
let trials = [];
const saves = new Map();

function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
}
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "[]");
  if (!Array.isArray(saved) || saved.some((row) => row.schema !== SCHEMA))
    throw Error("ข้อมูลรุ่นเก่าไม่ตรงกัน");
  trials = saved;
} catch (error) {
  storageError = `อ่านประวัติในเบราว์เซอร์ไม่ได้: ${error.message}`;
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(trials));
    storageError = "";
  } catch {
    storageError = "พื้นที่เก็บบนโทรศัพท์ไม่พอ กรุณาดาวน์โหลด JSON เก็บไว้";
  }
}

function saveTrial(row) {
  const queued = (saves.get(row.id) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if ((row.syncedRevision || 0) >= row.revision) return;
      const revision = row.revision;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch("/__device-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...row, syncedRevision: undefined }),
          signal: controller.signal,
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        row.syncedRevision = revision;
        row.saveError = null;
      } catch (error) {
        row.saveError = String(error.message);
      } finally {
        clearTimeout(timeout);
        persist();
        renderHistory();
      }
    });
  saves.set(row.id, queued);
  void queued.finally(() => {
    if (saves.get(row.id) === queued) saves.delete(row.id);
  });
  return queued;
}

function updateControls() {
  const busy = Boolean(trial);
  $("settings").disabled = busy || opening;
  $("start").disabled =
    busy || opening || source.kind === "none" || !capabilitiesReady;
  $("stop").disabled = !busy;
  $("camera").disabled = busy || opening;
  $("file").disabled = busy || opening;
  $("close-camera").disabled = source.kind === "none" && !opening;
  $("close-camera").textContent =
    source.kind === "photo" ? "ปิดภาพ" : "ปิดกล้อง";
  $("torch").disabled = busy || opening;
  $("verdict").disabled = busy || trials.length === 0;
  $("json").disabled = trials.length === 0;
  $("csv").disabled = trials.length === 0;
}

function releaseSource(reason = "source-closed") {
  sourceGeneration++;
  if (trial) finishTrial(reason);
  opening = false;
  source.stream?.getTracks().forEach((track) => track.stop());
  source.bitmap?.close();
  if (source.url) URL.revokeObjectURL(source.url);
  source = { kind: "none" };
  $("video").srcObject = null;
  $("video").hidden = true;
  $("photo").removeAttribute("src");
  $("photo").hidden = true;
  $("empty-camera").hidden = false;
  $("torch").hidden = true;
  $("torch").setAttribute("aria-pressed", "false");
  $("source-info").textContent =
    "ยังไม่ได้เลือกภาพ · สแกนเต็มภาพ ไม่มีกรอบบังคับตำแหน่ง";
  updateControls();
}

$("camera").onclick = async () => {
  releaseSource();
  const token = sourceGeneration;
  opening = true;
  updateControls();
  message("กำลังเปิดกล้องหลัง โปรดอนุญาตกล้องบนโทรศัพท์");
  let stream;
  try {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw Error(
        "เปิดผ่าน http://localhost:3194 ด้วย USB forwarding หรือใช้ HTTPS เพื่อให้เข้าถึงกล้องได้",
      );
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    if (token !== sourceGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    source = { kind: "camera", stream };
    const video = $("video");
    video.hidden = false;
    video.srcObject = stream;
    await video.play();
    if (token !== sourceGeneration) return;
    const track = stream.getVideoTracks()[0];
    source.settings = track.getSettings();
    source.capabilities = track.getCapabilities?.() || {};
    track.onended = () => {
      if (source.stream === stream) {
        releaseSource();
        message("กล้องถูกตัดการเชื่อมต่อ กรุณาเปิดกล้องอีกครั้ง", true);
      }
    };
    $("empty-camera").hidden = true;
    $("source-info").textContent =
      `กล้องจริง ${video.videoWidth} × ${video.videoHeight} px · ${source.settings.frameRate || "?"} fps · รอโฟกัสก่อนกดเริ่ม`;
    $("torch").hidden = !source.capabilities.torch;
    message("กล้องพร้อม วางใบ Job ให้นิ่ง รอโฟกัส แล้วกดเริ่มจับเวลา");
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (token !== sourceGeneration) return;
    releaseSource();
    message(
      error.name === "NotAllowedError"
        ? "ยังไม่ได้รับอนุญาตกล้อง เปิดสิทธิ์กล้องใน Chrome แล้วลองอีกครั้ง"
        : `เปิดกล้องไม่ได้: ${error.message}`,
      true,
    );
  } finally {
    if (token === sourceGeneration) opening = false;
    updateControls();
  }
};

$("close-camera").onclick = () => {
  releaseSource();
  message("ปิดภาพและกล้องแล้ว ผลการทดลองยังอยู่ด้านล่าง");
};
$("torch").onclick = async () => {
  const current = source;
  try {
    const next = $("torch").getAttribute("aria-pressed") !== "true";
    await current.stream
      .getVideoTracks()[0]
      .applyConstraints({ advanced: [{ torch: next }] });
    if (source !== current) return;
    $("torch").setAttribute("aria-pressed", String(next));
    $("torch").textContent = next ? "ปิดไฟฉาย" : "เปิดไฟฉาย";
  } catch {
    message(
      "เปิดไฟฉายไม่ได้ ใช้แสงภายนอกหรือเปิดกล้องใหม่แล้วลองอีกครั้ง",
      true,
    );
  }
};

$("file").onchange = async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  releaseSource();
  const token = sourceGeneration;
  opening = true;
  updateControls();
  message("กำลังเตรียมภาพ การอ่านไฟล์ครั้งนี้ยังไม่รวมในเวลาสแกน");
  let bitmap, resized, url;
  try {
    if (
      !/^image\/(jpeg|png|webp)$/.test(file.type) ||
      file.size > 25 * 1024 * 1024
    )
      throw Error("เลือกภาพ JPG, PNG หรือ WebP ขนาดไม่เกิน 25 MB");
    bitmap = await createImageBitmap(file);
    const originalSize = [bitmap.width, bitmap.height];
    if (bitmap.width * bitmap.height > 40_000_000)
      throw Error("ภาพใหญ่เกิน 40 ล้านพิกเซล กรุณาย่อภาพก่อน");
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
      resizeQuality: "high",
    });
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    if (token !== sourceGeneration) {
      resized.close();
      return;
    }
    url = URL.createObjectURL(file);
    source = {
      kind: "photo",
      bitmap: resized,
      url,
      name: file.name,
      sha256: hash,
      originalSize,
    };
    document.getElementById("photo").src = photoPreviewUrl(
      url,
      location.origin,
    );
    $("photo").hidden = false;
    $("empty-camera").hidden = true;
    $("source-info").textContent =
      `ภาพจากไฟล์ ${originalSize.join(" × ")} px · อ่านครั้งเดียวต่อรอบ · การโหลดไฟล์ไม่นับเป็นเวลาสแกน`;
    message("ภาพพร้อม สลับวิธีแล้วกดเริ่มเพื่อเทียบด้วยภาพเดียวกันได้เลย");
  } catch (error) {
    resized?.close();
    if (url) URL.revokeObjectURL(url);
    if (token === sourceGeneration)
      message(`เตรียมภาพไม่ได้: ${error.message}`, true);
  } finally {
    bitmap?.close();
    if (token === sourceGeneration) opening = false;
    updateControls();
  }
};

class WorkerReader {
  constructor() {
    this.worker = new Worker(new URL("./wasm.worker.js", import.meta.url), {
      type: "module",
    });
    this.sequence = 0;
    this.pending = null;
    this.worker.onmessage = ({ data }) => {
      if (!this.pending || (data.job != null && data.job !== this.pending.id))
        return;
      const { resolve, reject, timer } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      if (data.error) reject(Error(data.error));
      else resolve(data);
    };
    this.worker.onerror = (event) =>
      this.close(Error(event.message || "Worker failed"));
  }
  call(data, transfer = []) {
    if (this.closed) return Promise.reject(Error("Worker stopped"));
    if (this.pending) return Promise.reject(Error("Worker already busy"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(
        () => this.close(Error("Worker timeout (10s)")),
        10000,
      );
      this.pending = { id, resolve, reject, timer };
      try {
        this.worker.postMessage({ ...data, job: id }, transfer);
      } catch (error) {
        this.close(error);
      }
    });
  }
  close(error = Error("Trial stopped")) {
    this.closed = true;
    this.worker.terminate();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }
}

const elapsed = (row) => performance.now() - row.t0;
const isCurrent = (row) => trial === row;
function recordSymbols(row, symbols, engine) {
  if (!isCurrent(row)) return;
  const atMs = elapsed(row);
  for (const symbol of symbols) {
    const text = symbol.text?.trim();
    if (!text) continue;
    const key = JSON.stringify([engine, symbol.format || null, text]);
    if (!row.found.has(key) && row.found.size < 128)
      row.found.set(key, { ...symbol, text, engine, firstSeenMs: atMs });
  }
  row.symbols = [...row.found.values()];
  const fields = candidates(row.symbols);
  for (const field of ["job", "product"])
    if (fields[field].length && row.firstFieldMs[field] === null)
      row.firstFieldMs[field] = atMs;
  if (row.firstCompleteMs === null && targetFound(row.target, row.symbols))
    row.firstCompleteMs = atMs;
  renderReadings(row);
}

async function stage(row, engine, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    if (!isCurrent(row)) return result;
    row.calls.push({
      engine,
      atMs: elapsed(row),
      wallMs: performance.now() - start,
      count: result.symbols.length,
    });
    recordSymbols(row, result.symbols, engine);
    return result;
  } catch (error) {
    if (isCurrent(row))
      row.calls.push({
        engine,
        atMs: elapsed(row),
        wallMs: performance.now() - start,
        error: String(error.message),
      });
    throw error;
  }
}

function legacyAttempt(row, canvas) {
  try {
    const result = row.reader.decodeFromCanvas(canvas);
    return {
      symbols: [
        {
          text: result.getText(),
          format: BarcodeFormat[result.getBarcodeFormat()],
        },
      ],
    };
  } catch (error) {
    const kind =
      typeof error.getKind === "function" ? error.getKind() : error.name;
    if (!IGNORED.includes(kind)) throw error;
    return { symbols: [] };
  }
}

async function wasm(row, canvas, mode) {
  const bitmap = await createImageBitmap(canvas);
  if (!isCurrent(row)) {
    bitmap.close();
    throw Error("Trial stopped");
  }
  try {
    return await row.worker.call({ bitmap, mode }, [bitmap]);
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

async function decodeFrame(row, canvas) {
  const frameSymbols = [];
  if (row.method === "legacy") {
    const primary = await stage(row, "legacyPrimary", () =>
      legacyAttempt(row, canvas),
    );
    if (!isCurrent(row)) return;
    if (primary.symbols.length === 0 && elapsed(row) >= row.fallbackAt) {
      row.fallbackAt = elapsed(row) + 1500;
      await stage(row, "legacyFallback", async () => {
        const codes = await decodeBarcodeCanvas(canvas, {
          signal: row.abort.signal,
          budgetMs: 1200,
        });
        // Same singleton acceptance as the production camera hook.
        row.withheldFallbackCandidates += codes.length > 1 ? codes.length : 0;
        return {
          symbols: codes.length === 1 ? [{ text: codes[0], format: null }] : [],
        };
      });
    }
    return;
  }
  if (row.method === "native" || (row.method === "mixed" && row.detector)) {
    try {
      const result = await stage(row, "native", async () => ({
        symbols: (await row.detector.detect(canvas)).map((symbol) => ({
          text: symbol.rawValue,
          format: symbol.format,
        })),
      }));
      frameSymbols.push(...result.symbols);
    } catch (error) {
      if (row.method === "native") throw error;
    }
  }
  if (!isCurrent(row) || row.method === "native") return;
  if (row.method === "wasm" || !targetFound(row.target, frameSymbols)) {
    const result = await stage(row, "wasmHard", () =>
      wasm(row, canvas, "hard"),
    );
    frameSymbols.push(...result.symbols);
  }
  if (!isCurrent(row)) return;
  if (
    row.method === "mixed" &&
    row.target !== "job" &&
    candidates(frameSymbols).product.length !== 1 &&
    elapsed(row) >= row.regionAt
  ) {
    row.regionAt = elapsed(row) + 1000;
    await stage(row, "wasmRegions", () => wasm(row, canvas, "regions"));
  }
}

function captureFrame(row) {
  const input = source.kind === "camera" ? $("video") : source.bitmap;
  const width = input.videoWidth || input.width,
    height = input.videoHeight || input.height;
  if (!width || !height)
    throw Error("กล้องยังไม่มีภาพ กรุณาปิดแล้วเปิดกล้องใหม่");
  const scale = Math.min(1, row.maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("สร้างภาพสำหรับอ่านไม่ได้");
  context.drawImage(input, 0, 0, canvas.width, canvas.height);
  row.frameSize = [canvas.width, canvas.height];
  return canvas;
}

function nextFrame(row) {
  const video = $("video");
  return new Promise((resolve) => {
    let id;
    const native = typeof video.requestVideoFrameCallback === "function";
    const done = (_, metadata) => {
      row.cancelFrame = null;
      if (!isCurrent(row)) {
        resolve(false);
        return;
      }
      const mediaTime = metadata?.mediaTime ?? video.currentTime;
      if (mediaTime === row.lastMediaTime) {
        schedule();
        return;
      }
      row.lastMediaTime = mediaTime;
      resolve(true);
    };
    const schedule = () => {
      id = native
        ? video.requestVideoFrameCallback(done)
        : requestAnimationFrame(done);
      row.cancelFrame = () => {
        if (native) video.cancelVideoFrameCallback(id);
        else cancelAnimationFrame(id);
        resolve(false);
      };
    };
    schedule();
  });
}

async function runFrames(row) {
  try {
    while (isCurrent(row)) {
      if (row.source === "camera" && !(await nextFrame(row))) return;
      if (!isCurrent(row)) return;
      const start = performance.now();
      const canvas = captureFrame(row);
      try {
        await decodeFrame(row, canvas);
      } finally {
        canvas.width = canvas.height = 0;
      }
      if (!isCurrent(row)) return;
      row.attemptWallMs.push(performance.now() - start);
      row.frames++;
      if (row.source === "photo") {
        finishTrial("photo-complete");
        return;
      }
      // One in-flight frame. Wait for the next newly presented frame after work.
      await new Promise((resolve) => {
        row.wake = resolve;
        row.delay = setTimeout(
          resolve,
          Math.max(0, MIN_FRAME_MS - (performance.now() - start)),
        );
      });
      row.wake = null;
    }
  } catch (error) {
    if (isCurrent(row)) {
      row.error = String(error.message);
      finishTrial("error");
      message(`รอบนี้หยุดเพราะ: ${error.message} ผลบางส่วนเก็บไว้แล้ว`, true);
    }
  }
}

function monitor(row) {
  let previous = performance.now();
  const raf = (now) => {
    if (!isCurrent(row)) return;
    row.maxRafGapMs = Math.max(row.maxRafGapMs, now - previous);
    previous = now;
    row.raf = requestAnimationFrame(raf);
  };
  row.raf = requestAnimationFrame(raf);
  row.clock = setInterval(() => {
    if (isCurrent(row))
      $("timer").textContent = `${(elapsed(row) / 1000).toFixed(1)} s`;
  }, 100);
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    row.observer = new PerformanceObserver((list) => {
      if (isCurrent(row))
        row.longTasksMs.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
    });
    row.observer.observe({ type: "longtask" });
  }
}

$("start").onclick = async () => {
  if (trial || source.kind === "none" || !capabilitiesReady) return;
  const row = {
    schema: SCHEMA,
    pipeline: PIPELINE,
    id: crypto.randomUUID(),
    revision: 1,
    createdAt: new Date().toISOString(),
    method: $("method").value,
    target: $("target").value,
    maxSide: Number($("max-side").value),
    limitMs: Number($("duration").value) * 1000,
    sample: $("sample").value.trim(),
    expected: {
      job: $("expected-job").value.trim(),
      product: $("expected-product").value.trim(),
    },
    source: source.kind,
    photo:
      source.kind === "photo"
        ? {
            name: source.name,
            sha256: source.sha256,
            originalSize: source.originalSize,
          }
        : null,
    camera: source.stream?.getVideoTracks()[0]?.getSettings() || null,
    caps,
    symbols: [],
    calls: [],
    frames: 0,
    attemptWallMs: [],
    firstFieldMs: { job: null, product: null },
    firstCompleteMs: null,
    maxRafGapMs: 0,
    longTasksMs: [],
    manualVerdict: "unreviewed",
    setupMs: null,
    found: new Map(),
    abort: new AbortController(),
    fallbackAt: 0,
    regionAt: 0,
    withheldFallbackCandidates: 0,
  };
  trial = row;
  updateControls();
  renderReadings(row);
  $("timer").hidden = false;
  $("timer").textContent = "กำลังเตรียม…";
  message("กำลังเตรียมตัวอ่าน ยังไม่เริ่มจับเวลา");
  const setupAt = performance.now();
  try {
    if (row.method === "native" || row.method === "mixed") {
      const supported = ["qr_code", "code_128"].every((format) =>
        nativeFormats.includes(format),
      );
      if (!supported && row.method === "native")
        throw Error(
          "เครื่องนี้ไม่รองรับ Native ทั้ง QR และ Code 128 ใช้ WASM หรือวิธีผสมได้",
        );
      if (supported)
        row.detector = new window.BarcodeDetector({
          formats: ["code_128", "qr_code"],
        });
    }
    if (row.method === "wasm" || row.method === "mixed") {
      row.worker = new WorkerReader();
      await row.worker.call({
        cmd: "init",
        wasmUrl: new URL("/barcode/zxing_reader.wasm", location.origin).href,
      });
    }
    if (!isCurrent(row)) return;
    if (row.method === "legacy")
      row.reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanSuccess: 100,
        delayBetweenScanAttempts: 100,
      });
    row.setupMs = performance.now() - setupAt;
    row.t0 = performance.now();
    row.startedAt = new Date().toISOString();
    $("timer").textContent = "0.0 s";
    $("run-note").textContent =
      `เตรียมตัวอ่าน ${Math.round(row.setupMs)} ms · ${row.source === "photo" ? "อ่านภาพเดียวครั้งเดียว" : "กำลังอ่านเฟรมใหม่ทีละเฟรม"} · ไม่หยุดอัตโนมัติเมื่อเจอ QR`;
    message("กำลังทดสอบ เล็งใบให้นิ่ง ผลแต่ละช่องจะแสดงเมื่ออ่านพบ");
    if (matchMedia("(max-width: 740px)").matches)
      document
        .querySelector(".capture")
        .scrollIntoView({ block: "start", behavior: "instant" });
    monitor(row);
    if (row.source === "camera")
      row.timeout = setTimeout(() => finishTrial("timeout"), row.limitMs);
    void runFrames(row);
  } catch (error) {
    if (isCurrent(row)) {
      row.error = String(error.message);
      finishTrial("error");
      message(`เตรียมตัวอ่านไม่ได้: ${error.message}`, true);
    }
  }
};

function finishTrial(reason) {
  const row = trial;
  if (!row) return;
  trial = null; // Invalidate before termination: late results cannot reach the UI.
  const started = Number.isFinite(row.t0);
  row.elapsedMs = started ? elapsed(row) : 0;
  row.reason = !started && reason === "manual" ? "prepare-cancelled" : reason;
  clearTimeout(row.timeout);
  clearTimeout(row.delay);
  clearInterval(row.clock);
  row.wake?.();
  row.cancelFrame?.();
  cancelAnimationFrame(row.raf);
  if (row.observer) {
    row.longTasksMs.push(
      ...row.observer.takeRecords().map((entry) => entry.duration),
    );
    row.observer.disconnect();
  }
  row.abort.abort();
  row.worker?.close();
  row.symbols = [...row.found.values()];
  const saved = { ...row };
  for (const key of [
    "found",
    "worker",
    "reader",
    "detector",
    "observer",
    "abort",
    "timeout",
    "delay",
    "clock",
    "raf",
    "wake",
    "cancelFrame",
    "t0",
  ])
    delete saved[key];
  // Runtime resources are intentionally excluded from persisted evidence.
  trials.push(saved);
  persist();
  $("timer").textContent =
    `${(row.elapsedMs / 1000).toFixed(1)} s · ${REASONS[row.reason]}`;
  $("verdict").value = "unreviewed";
  renderReadings(row);
  renderHistory();
  updateControls();
  void saveTrial(saved);
  if (reason !== "error")
    message("จบรอบแล้ว ตรวจข้อมูลกับใบจริง แล้วสลับวิธีเพื่อทดสอบใบเดิมได้เลย");
}
$("stop").onclick = () => finishTrial("manual");

function ms(value) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}
function renderReadings(row) {
  const fields = candidates(row.symbols);
  for (const field of ["job", "product"]) {
    $(field + "-result").textContent = fields[field].length
      ? fields[field].join(" / ") +
        (fields[field].length > 1 ? " · พบหลายค่า" : "")
      : "ยังอ่านไม่พบ";
    $(field + "-time").textContent = ms(row.firstFieldMs[field]);
  }
  $("diagnostics").textContent = JSON.stringify(
    {
      method: row.method,
      target: row.target,
      frameSize: row.frameSize,
      frames: row.frames,
      firstCompleteMs: row.firstCompleteMs,
      maxRafGapMs: row.maxRafGapMs,
      calls: row.calls.slice(-8),
      symbols: row.symbols.map((symbol) => ({
        ...symbol,
        field: fieldOf(symbol),
      })),
      withheldFallbackCandidates: row.withheldFallbackCandidates,
    },
    null,
    2,
  );
}

const SCORE_LABELS = {
  correct: "ถูก",
  incorrect: "ผิด",
  "no-read": "อ่านไม่ได้",
  ambiguous: "หลายค่า",
  unscored: "ไม่มีคำตอบอ้างอิง",
};
function renderHistory() {
  const body = $("history-body");
  body.replaceChildren();
  for (const row of trials.slice(-30).reverse()) {
    const score = scoreTrial(row);
    const tr = document.createElement("tr");
    const texts = [
      [
        row.sample || "ไม่ได้ตั้งชื่อใบ",
        `${METHODS[row.method]} · ${row.source === "camera" ? "กล้อง" : "ไฟล์"} · ${row.target} · ${row.maxSide}px`,
      ],
      [
        `Job: ${score.fields.job.join(" / ") || "—"}`,
        `สินค้า: ${score.fields.product.join(" / ") || "—"}`,
      ],
      [
        ms(row.firstCompleteMs),
        `${row.frames} เฟรม · เตรียม ${ms(row.setupMs)}`,
      ],
      [
        Object.entries(score.scores)
          .map(([field, value]) => `${field}: ${SCORE_LABELS[value]}`)
          .join(" · "),
        `ตรวจด้วยตา: ${{ unreviewed: "ยังไม่ตรวจ", correct: "ถูกครบ", incorrect: "ผิด/ขาด", uncertain: "ไม่แน่ใจ" }[row.manualVerdict]}`,
      ],
      [
        REASONS[row.reason],
        `${(row.elapsedMs / 1000).toFixed(1)} s${row.error ? ` · ${row.error}` : ""}`,
      ],
    ];
    for (const [text, small] of texts) {
      const td = document.createElement("td");
      td.textContent = text;
      const detail = document.createElement("small");
      detail.textContent = small;
      td.append(detail);
      tr.append(td);
    }
    body.append(tr);
  }
  const summary = summarise(trials);
  $("summary").textContent = summary.length
    ? summary
        .map(
          (group) =>
            `${METHODS[group.method]} · ${group.source} · ${group.target} · ${group.maxSide}px${group.limitMs ? ` · ${group.limitMs / 1000}s` : ""}\nถูกครบ ${group.correct}/${group.scored} รอบที่มีคำตอบครบ${group.scored ? ` (${Math.round((group.correct / group.scored) * 100)}%)` : " · ยังสรุปความแม่นยำไม่ได้"} · ผิด ${group.incorrect} · อ่านไม่ครบ ${group.noRead} · หลายค่า ${group.ambiguous} · ขัดจังหวะ/ผิดพลาด ${group.interrupted}\nเวลาพบครบเฉพาะรอบที่ถูก p50/p95: ${ms(group.correctTimeP50)} / ${ms(group.correctTimeP95)} · เวลาประมวลผลต่อเฟรมรวมเฟรมว่าง p50/p95: ${ms(group.attemptP50)} / ${ms(group.attemptP95)}`,
        )
        .join("\n\n")
    : "ยังไม่มีรอบทดสอบ เลือกภาพหรือเปิดกล้องเพื่อเริ่มได้เลย";
  const unsaved = trials.filter(
    (row) => (row.syncedRevision || 0) < row.revision,
  ).length;
  $("save-status").textContent =
    storageError ||
    (unsaved
      ? `มี ${unsaved} รอบรอส่งไป Mac · ผลยังอยู่ในเบราว์เซอร์และดาวน์โหลดได้`
      : trials.length
        ? `เก็บ ${trials.length} รอบบนเบราว์เซอร์ และส่งสำเนาไป Mac แล้ว · ตารางแสดงล่าสุด 30 รอบ`
        : "บันทึกบนโทรศัพท์และส่งสำเนาไป Mac หลังจบรอบ");
  $("retry").hidden = unsaved === 0;
}

$("verdict").onchange = () => {
  const latest = trials.at(-1);
  if (!latest || trial) return;
  latest.manualVerdict = $("verdict").value;
  latest.revision++;
  persist();
  renderHistory();
  void saveTrial(latest);
};
$("retry").onclick = () => {
  for (const row of trials)
    if ((row.syncedRevision || 0) < row.revision) void saveTrial(row);
};
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `topgold-android-${new Date().toISOString().replaceAll(":", "-")}.${extension}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$("json").onclick = () =>
  download(
    JSON.stringify(
      {
        schema: SCHEMA,
        pipeline: PIPELINE,
        exportedAt: new Date().toISOString(),
        summary: summarise(trials),
        trials,
      },
      null,
      2,
    ),
    "application/json",
    "json",
  );
$("csv").onclick = () => {
  const headers = [
    "id",
    "sample",
    "method",
    "source",
    "target",
    "maxSide",
    "reason",
    "job",
    "product",
    "jobScore",
    "productScore",
    "firstJobMs",
    "firstProductMs",
    "firstCompleteMs",
    "elapsedMs",
    "setupMs",
    "manualVerdict",
    "error",
  ];
  const rows = trials.map((row) => {
    const score = scoreTrial(row);
    return [
      row.id,
      row.sample,
      row.method,
      row.source,
      row.target,
      row.maxSide,
      row.reason,
      score.fields.job.join(" | "),
      score.fields.product.join(" | "),
      score.scores.job,
      score.scores.product,
      row.firstFieldMs.job,
      row.firstFieldMs.product,
      row.firstCompleteMs,
      row.elapsedMs,
      row.setupMs,
      row.manualVerdict,
      row.error,
    ];
  });
  download(
    "\ufeff" +
      [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
    "csv",
  );
};

document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseSource("hidden");
});
window.addEventListener("pagehide", () => releaseSource("pagehide"));
window.addEventListener("online", () => {
  for (const row of trials)
    if ((row.syncedRevision || 0) < row.revision) void saveTrial(row);
});

async function setup() {
  try {
    nativeFormats =
      "BarcodeDetector" in window
        ? await Promise.race([
            window.BarcodeDetector.getSupportedFormats(),
            new Promise((resolve) => setTimeout(() => resolve([]), 4000)),
          ])
        : [];
  } catch {
    nativeFormats = [];
  }
  caps = {
    userAgent: navigator.userAgent,
    secureContext: isSecureContext,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory || null,
    nativeFormats,
    videoFrameCallback:
      "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    longTask:
      PerformanceObserver.supportedEntryTypes?.includes("longtask") || false,
    wasmVersion: "3.1.5",
    jsVersion: "0.23.0",
    cadenceMs: MIN_FRAME_MS,
  };
  const native = ["qr_code", "code_128"].every((format) =>
    nativeFormats.includes(format),
  );
  $("method").querySelector('[value="native"]').disabled = !native;
  $("method-note").textContent = native
    ? "เครื่องนี้รองรับ Native ทั้ง QR และ Code 128"
    : "เครื่องนี้ไม่รองรับ Native ครบสองชนิด วิธีผสมจะเริ่มด้วย WASM";
  capabilitiesReady = true;
  if (trials.length) $("verdict").value = trials.at(-1).manualVerdict;
  renderHistory();
  updateControls();
  message(
    isSecureContext
      ? "พร้อมทดสอบ เปิดกล้องหรือเลือกภาพใบ Job ได้เลย"
      : "หน้านี้ไม่ได้อยู่บน localhost/HTTPS เลือกภาพได้ แต่กล้องต้องเปิดผ่าน USB forwarding",
    !isSecureContext,
  );
}
void setup();
