// Functional checks only. Synthetic camera/Native results are explicitly mocked;
// WASM and JS decode a real generated QR. Never use these timings as phone data.
import { chromium } from "@playwright/test";
import { QRCodeWriter, BarcodeFormat } from "@zxing/library";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const base = `http://127.0.0.1:${process.env.DEVICE_BENCH_PORT || 3194}`;
const evidence = resolve(
  "docs/reviews/assets/topgold-scanning-2026-10-16/device-ui",
);
await mkdir(evidence, { recursive: true });
const checks = [];
const matrix = new QRCodeWriter().encode(
  "FOM123456",
  BarcodeFormat.QR_CODE,
  320,
  320,
  new Map(),
);
const qr = {
  width: matrix.getWidth(),
  height: matrix.getHeight(),
  pixels: Array.from({ length: matrix.getHeight() }, (_, y) =>
    Array.from({ length: matrix.getWidth() }, (_, x) => matrix.get(x, y)),
  ),
};
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let saveFails = false;
const posted = [];
await page.route("**/__device-result", async (route) => {
  if (saveFails) {
    await route.abort();
    return;
  }
  const body = route.request().postDataJSON();
  posted.push(body);
  await route.fulfill({
    json: { saved: true, id: body.id, revision: body.revision },
  });
});
const rows = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("topgold-device-trials-v1") || "[]"),
  );
async function completed(count) {
  await page.waitForFunction(
    (n) =>
      JSON.parse(localStorage.getItem("topgold-device-trials-v1") || "[]")
        .length === n,
    count,
  );
  await page.waitForFunction(() => document.getElementById("stop").disabled);
}
async function choose(buffer) {
  await page.locator("#file").setInputFiles({
    name: "functional-qr.png",
    mimeType: "image/png",
    buffer,
  });
  await page.waitForFunction(() => !document.getElementById("start").disabled);
}
try {
  await page.goto(base);
  await page.waitForFunction(() => !document.getElementById("camera").disabled);
  await page.waitForFunction(
    () =>
      !document.getElementById("message").textContent.includes("กำลังตรวจสอบ"),
  );
  assert.equal(await page.locator("#start").isDisabled(), true);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.locator("#camera").click();
  await page.waitForFunction(() =>
    document
      .getElementById("message")
      .textContent.includes("ยังไม่ได้รับอนุญาต"),
  );
  assert.equal(await page.locator("#camera").isEnabled(), true);
  checks.push("camera denial recovers without a live track");

  const base64 = await page.evaluate((qr) => {
    const canvas = document.createElement("canvas");
    canvas.width = qr.width;
    canvas.height = qr.height;
    const ctx = canvas.getContext("2d");
    for (let y = 0; y < qr.height; y++)
      for (let x = 0; x < qr.width; x++) {
        ctx.fillStyle = qr.pixels[y][x] ? "#000" : "#fff";
        ctx.fillRect(x, y, 1, 1);
      }
    return canvas.toDataURL("image/png").split(",")[1];
  }, qr);
  const fixture = Buffer.from(base64, "base64");
  await choose(fixture);
  await page.locator("#sample").fill("ตรวจเครื่องมือ · QR จำลอง");
  await page.locator("#target").selectOption("job");
  await page.locator("#method").selectOption("wasm");
  await page.locator(".reference summary").click();
  await page.locator("#expected-job").fill("FOM999999");
  await page.locator("#start").click();
  await completed(1);
  let latest = (await rows()).at(-1);
  assert.equal(latest.reason, "photo-complete");
  assert.equal(latest.symbols[0].text, "FOM123456");
  assert.ok(latest.firstFieldMs.job > 0);
  assert.ok(latest.setupMs > 0);
  assert.ok(
    await page
      .locator("#history-body")
      .innerText()
      .then((text) => text.includes("job: ผิด")),
  );
  checks.push(
    "real WASM decodes FOM QR; false expected answer does not influence decoding",
  );

  await page.locator("#verdict").selectOption("incorrect");
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("topgold-device-trials-v1"))[0]
        .syncedRevision === 2,
  );
  assert.equal(posted.at(-1).manualVerdict, "incorrect");
  checks.push("manual review revision is persisted and sent to Mac");

  await page.locator("#expected-job").fill("FOM123456");
  await page.locator("#method").selectOption("legacy");
  await page.locator("#start").click();
  await completed(2);
  latest = (await rows()).at(-1);
  assert.equal(latest.symbols[0].text, "FOM123456");
  assert.equal(latest.symbols[0].engine, "legacyPrimary");
  checks.push("real production JS primary reader decodes QR");

  // Fake capability + values to test routing. These are never accuracy evidence.
  await page.addInitScript(() => {
    window.__nativeSymbols = [{ rawValue: "FOM123456", format: "qr_code" }];
    window.BarcodeDetector = class {
      static async getSupportedFormats() {
        return ["qr_code", "code_128"];
      }
      async detect() {
        return window.__nativeSymbols;
      }
    };
  });
  await page.reload();
  await choose(fixture);
  await page.locator(".reference summary").click();
  await page.locator("#target").selectOption("both");
  await page.locator("#expected-job").fill("FOM123456");
  await page.locator("#expected-product").fill("TEST-PRODUCT");
  await page.locator("#method").selectOption("mixed");
  await page.locator("#start").click();
  await completed(3);
  latest = (await rows()).at(-1);
  assert.deepEqual(
    latest.calls.map((call) => call.engine),
    ["native", "wasmHard", "wasmRegions"],
  );
  assert.equal(latest.firstCompleteMs, null);
  assert.ok(
    (await page.locator("#history-body").innerText()).includes(
      "product: อ่านไม่ได้",
    ),
  );
  checks.push(
    "JOB-only QR does not finish a product target; mixed pipeline escalates",
  );

  await page.evaluate(() => {
    window.__nativeSymbols.push({
      rawValue: "TEST-PRODUCT",
      format: "code_128",
    });
  });
  await page.locator("#start").click();
  await completed(4);
  latest = (await rows()).at(-1);
  assert.deepEqual(
    latest.calls.map((call) => call.engine),
    ["native"],
  );
  assert.ok(latest.firstCompleteMs > 0);
  checks.push(
    "mixed pipeline skips WASM when Native finds the requested fields",
  );

  await page.evaluate(() => {
    window.__nativeSymbols.push({
      rawValue: "ANOTHER-PRODUCT",
      format: "code_128",
    });
  });
  await page.locator("#method").selectOption("native");
  await page.locator("#start").click();
  await completed(5);
  latest = (await rows()).at(-1);
  assert.equal(
    latest.symbols.filter((symbol) => symbol.format === "code_128").length,
    2,
  );
  assert.ok(
    (await page.locator("#history-body").innerText()).includes(
      "product: หลายค่า",
    ),
  );
  checks.push("ambiguous products stay visible and are not scored correct");

  saveFails = true;
  await page.locator("#method").selectOption("wasm");
  await page.locator("#target").selectOption("job");
  await page.locator("#start").click();
  await completed(6);
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("topgold-device-trials-v1")).at(-1)
        .saveError,
  );
  assert.equal(await page.locator("#retry").isVisible(), true);
  saveFails = false;
  await page.locator("#retry").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("topgold-device-trials-v1")).at(-1)
        .syncedRevision === 1,
  );
  checks.push(
    "failed save survives locally and explicit retry synchronises it",
  );

  // Download events are checked separately below to register the listener first.
  for (const format of ["json", "csv"]) {
    const event = page.waitForEvent("download");
    await page.locator(`#${format}`).click();
    const downloaded = await event;
    const body = await readFile(await downloaded.path(), "utf8");
    if (format === "json") assert.equal(JSON.parse(body).trials.length, 6);
    else assert.ok(body.includes('"FOM123456"'));
  }
  checks.push("JSON and CSV exports contain the complete trial history");

  await page.screenshot({
    path: resolve(evidence, "desktop.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(evidence, "mobile.png"),
    fullPage: false,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    await page
      .locator("#start")
      .evaluate((el) => el.getBoundingClientRect().height >= 48),
    true,
  );
  checks.push(
    "desktop and 390px mobile layout fit; primary controls have 48px touch targets",
  );

  // Real MediaStream, but synthetic static pixels. This validates lifecycle only.
  await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext("2d").fillStyle = "white";
    canvas.getContext("2d").fillRect(0, 0, 640, 480);
    canvas.getContext("2d").drawImage(img, 160, 80, 320, 320);
    window.__cameraCanvas = canvas;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__cameraStream = canvas.captureStream(15);
      window.__paint = setInterval(
        () => canvas.getContext("2d").drawImage(img, 160, 80, 320, 320),
        67,
      );
      return window.__cameraStream;
    };
  }, base64);
  await page.locator("#camera").click();
  await page.waitForFunction(() => !document.getElementById("start").disabled);
  await page.locator("#start").click();
  await page.waitForFunction(() =>
    document.getElementById("job-result").textContent.includes("FOM123456"),
  );
  await page.locator("#stop").click();
  await completed(7);
  const stopped = (await rows()).at(-1);
  assert.equal(stopped.reason, "manual");
  assert.ok(stopped.frames > 0);
  await page.locator("#close-camera").click();
  assert.equal(
    await page.evaluate(() =>
      window.__cameraStream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
    true,
  );
  assert.equal((await rows()).at(-1).calls.length, stopped.calls.length);
  checks.push(
    "synthetic live frames decode; Stop rejects late work; Close ends all tracks",
  );

  await page.locator("#camera").click();
  await page.waitForFunction(() => !document.getElementById("start").disabled);
  await page.locator("#start").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("กำลังทดสอบ"),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await completed(8);
  assert.equal((await rows()).at(-1).reason, "hidden");
  assert.equal(
    await page.evaluate(
      () =>
        document.getElementById("video").srcObject === null &&
        window.__cameraStream
          .getTracks()
          .every((track) => track.readyState === "ended"),
    ),
    true,
  );
  await page.evaluate(() => {
    delete document.hidden;
    clearInterval(window.__paint);
  });
  checks.push("hiding the page cancels the worker and shuts down the camera");

  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        window.__allowCamera = resolve;
      });
  });
  await page.locator("#camera").click();
  await page.locator("#close-camera").click();
  await page.evaluate(() => {
    window.__lateStream = window.__cameraCanvas.captureStream(15);
    window.__allowCamera(window.__lateStream);
  });
  await page.waitForFunction(() =>
    window.__lateStream
      .getTracks()
      .every((track) => track.readyState === "ended"),
  );
  assert.equal(await page.locator("#start").isDisabled(), true);
  checks.push(
    "camera permission resolving after cancellation cannot leak a stream",
  );

  // Initialisation still in progress when user presses Stop.
  await page.route(
    "**/barcode/zxing_reader.wasm",
    (route) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(route.continue().catch(() => {})), 1000),
      ),
  );
  await choose(fixture);
  await page.locator("#start").click();
  await page.locator("#stop").click();
  await completed(9);
  assert.equal((await rows()).at(-1).reason, "prepare-cancelled");
  assert.equal((await rows()).at(-1).elapsedMs, 0);
  checks.push(
    "Stop during worker preparation cancels without starting a timed trial",
  );

  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => {
    delete window.BarcodeDetector;
  });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.route("**/__device-result", (route) =>
    route.fulfill({ json: { saved: true } }),
  );
  await fallbackPage.goto(base);
  await fallbackPage.locator("#file").setInputFiles({
    name: "functional-qr.png",
    mimeType: "image/png",
    buffer: fixture,
  });
  await fallbackPage.waitForFunction(
    () => !document.getElementById("start").disabled,
  );
  assert.equal(
    await fallbackPage.locator('#method option[value="native"]').isDisabled(),
    true,
  );
  await fallbackPage.locator("#target").selectOption("job");
  await fallbackPage.locator("#method").selectOption("mixed");
  await fallbackPage.locator("#start").click();
  await fallbackPage.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("topgold-device-trials-v1") || "[]")
        .length === 1,
  );
  const fallbackTrial = await fallbackPage.evaluate(
    () => JSON.parse(localStorage.getItem("topgold-device-trials-v1"))[0],
  );
  assert.deepEqual(
    fallbackTrial.calls.map((call) => call.engine),
    ["wasmHard"],
  );
  assert.equal(fallbackTrial.symbols[0].text, "FOM123456");
  await fallbackContext.close();
  checks.push(
    "mixed mode reads through WASM when Native is entirely unavailable",
  );

  // Exercise actual server validation and idempotent revision storage separately.
  const id = randomUUID();
  const record = { schema: 1, id, revision: 2, symbols: [], smoke: true };
  const file = resolve("data/private/topgold-device", `${id}.json`);
  try {
    assert.equal(
      (
        await context.request.post(`${base}/__device-result`, { data: record })
      ).status(),
      200,
    );
    assert.equal(
      (
        await context.request.post(`${base}/__device-result`, {
          data: { ...record, revision: 1 },
        })
      ).status(),
      200,
    );
    assert.equal(JSON.parse(await readFile(file, "utf8")).revision, 2);
    assert.equal(
      (
        await context.request.post(`${base}/__device-result`, {
          data: { ...record, id: "../../wrong" },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await context.request.post(`${base}/__device-result`, {
          headers: { Origin: "https://example.com" },
          data: record,
        })
      ).status(),
      403,
    );
  } finally {
    await rm(file, { force: true });
  }
  checks.push(
    "server saves atomically, ignores stale revisions and rejects invalid ids/origins",
  );
  assert.deepEqual(errors, []);
  checks.push("no uncaught page errors");
  await writeFile(
    resolve(evidence, "checks.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: browser.version(),
        device: "desktop Chromium; synthetic camera/Native; real JS/WASM QR",
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
