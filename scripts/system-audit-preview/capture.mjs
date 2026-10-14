import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import en from "../../messages/en.json" with { type: "json" };
import th from "../../messages/th.json" with { type: "json" };

const repository = fileURLToPath(new URL("../../", import.meta.url));
const phase = process.env.AUDIT_PHASE ?? "after";
if (!["before", "after"].includes(phase)) throw new Error("Invalid phase");
const port = Number(process.env.AUDIT_CAPTURE_PORT ?? 3290);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid local fixture port");
const output = resolve(repository, "output/audit-cleanup/screenshots");
const sourceCommit =
  process.env.AUDIT_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
const cases = [
  { view: "organization", locale: "th", width: 1440 },
  { view: "organization", locale: "th", width: 390 },
  { view: "organization", locale: "en", width: 390 },
  { view: "workspace-error", locale: "en", width: 1440 },
  { view: "workspace-error", locale: "th", width: 390 },
  { view: "zone-card", locale: "th", width: 1440 },
  { view: "zone-card", locale: "en", width: 390 },
  {
    view: "zone-card",
    locale: "th",
    width: 390,
    query: "identity=distinct",
    name: "distinct",
  },
  {
    view: "zone-card",
    locale: "en",
    width: 1440,
    query: "positions=1",
    action: "labels",
    name: "positions",
  },
  { view: "floor-list", locale: "th", width: 390 },
  {
    view: "floor-list",
    locale: "en",
    width: 1440,
    action: "grid",
    name: "grid",
  },
  {
    view: "floor-list",
    locale: "en",
    width: 390,
    query: "identity=distinct",
    name: "distinct",
  },
  { view: "catalogue", locale: "en", width: 1440, action: "catalogue" },
  { view: "catalogue", locale: "th", width: 390, action: "qr", name: "qr" },
  {
    view: "catalogue",
    locale: "en",
    width: 1440,
    query: "identity=distinct",
    action: "qr",
    name: "distinct-qr",
  },
  { view: "named", locale: "en", width: 1440 },
  {
    view: "named",
    locale: "th",
    width: 390,
    query: "identity=distinct",
    name: "distinct",
  },
  { view: "record", locale: "en", width: 1440 },
  {
    view: "record",
    locale: "en",
    width: 1440,
    query: "identity=distinct",
    name: "distinct",
  },
  { view: "scan-summary", locale: "th", width: 390 },
  { view: "profile", locale: "en", width: 390 },
  { view: "profile", locale: "th", width: 1440 },
  { view: "workspace", locale: "en", width: 1440, action: "select" },
  { view: "workspace", locale: "th", width: 390, action: "select" },
  {
    view: "workspace",
    locale: "th",
    width: 390,
    query: "inventory=occupied&theme=dark",
    action: "select",
    name: "occupied-dark",
  },
  { view: "destination", locale: "en", width: 1440 },
  {
    view: "destination",
    locale: "th",
    width: 390,
    action: "camera",
    name: "camera-denied",
  },
  { view: "picker", locale: "en", width: 1440 },
  {
    view: "picker",
    locale: "th",
    width: 390,
    query: "identity=distinct",
    name: "distinct",
  },
  {
    view: "picker",
    locale: "en",
    width: 1440,
    action: "scan",
    name: "scan-denied",
  },
  {
    view: "picker",
    locale: "th",
    width: 390,
    action: "photo",
    name: "photo-denied",
  },
  {
    view: "picker",
    locale: "en",
    width: 390,
    action: "selected-image",
    name: "selected-image",
  },
  {
    view: "picker",
    locale: "en",
    width: 390,
    action: "nested-photo",
    name: "nested-photo",
  },
  {
    view: "picker",
    locale: "en",
    width: 390,
    action: "photo-selected",
    name: "photo-selected",
  },
  {
    view: "picker",
    locale: "en",
    width: 390,
    action: "photo-retake",
    name: "photo-retake",
  },
  {
    view: "job-scan",
    locale: "th",
    width: 390,
    action: "location-scan",
    name: "location-scan",
  },
  {
    view: "job-scan",
    locale: "en",
    width: 1440,
    action: "pick",
    name: "location-strip",
  },
  {
    view: "job-scan",
    locale: "en",
    width: 390,
    query: "identity=distinct",
    action: "pick",
    name: "distinct-location",
  },
  {
    view: "job-scan",
    locale: "th",
    width: 390,
    action: "ticket-scan",
    name: "ticket-scan",
  },
  {
    view: "job-scan",
    locale: "en",
    width: 1440,
    action: "ticket-photo",
    name: "ticket-photo",
  },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const captures = [];
const manifest = resolve(output, `${phase}-manifest.json`);
try {
  captures.push(...JSON.parse(await readFile(manifest, "utf8")));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
try {
  for (const c of cases) {
    if (
      process.env.AUDIT_CAPTURE_VIEW &&
      c.view !== process.env.AUDIT_CAPTURE_VIEW
    )
      continue;
    const height = c.width < 600 ? 844 : 900;
    const context = await browser.newContext({
      viewport: { width: c.width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const t = (c.locale === "th" ? th : en).JobScan;
    const url = `http://127.0.0.1:${port}/?view=${c.view}&locale=${c.locale}${c.query ? `&${c.query}` : ""}`;
    await page.goto(url);
    await page.locator("[data-audit-fixture]").waitFor();
    if (["organization", "workspace-error"].includes(c.view))
      await page.locator("h1").waitFor();
    if (c.action === "labels")
      await page
        .locator("summary")
        .filter({ hasText: c.locale === "en" ? "QR labels" : "ป้าย QR" })
        .click();
    if (c.action === "grid") {
      await page
        .getByRole("button", { name: "Filter locations", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Grid view", exact: true })
        .click();
      await page.keyboard.press("Escape");
    }
    if (["catalogue", "qr"].includes(c.action)) {
      await page
        .getByRole("button", {
          name: c.locale === "en" ? "All locations" : "จุดจัดเก็บทั้งหมด",
          exact: true,
        })
        .click();
      if (c.action === "qr")
        await page.getByRole("button", { name: /^QR / }).click();
    }
    if (c.action === "select")
      await page.locator("g[data-map-zone-id='audit-zone']").click();
    if (c.action === "camera")
      await page
        .getByRole("button", {
          name: c.locale === "en" ? "Start camera" : "เปิดกล้อง",
          exact: true,
        })
        .click();
    if (
      ["scan", "selected-image", "nested-photo", "location-scan"].includes(
        c.action,
      )
    )
      await page.getByRole("button", { name: t.scanCode, exact: true }).click();
    if (c.action === "selected-image" || c.action === "nested-photo") {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles(
          resolve(repository, "tests/fixtures/barcode/demo-product.png"),
        );
      await page
        .getByRole("button", { name: t.readLocationAi, exact: true })
        .waitFor();
      if (c.action === "nested-photo")
        await page
          .getByRole("button", { name: t.readLocationAi, exact: true })
          .click();
    }
    if (["photo", "photo-selected", "photo-retake"].includes(c.action))
      await page.getByRole("button", { name: t.photoAi, exact: true }).click();
    if (["photo-selected", "photo-retake"].includes(c.action)) {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles(
          resolve(repository, "tests/fixtures/barcode/demo-product.png"),
        );
      await page.getByRole("alert").waitFor();
      if (c.action === "photo-retake")
        await page
          .getByRole("button", { name: t.locationAiOpenCamera, exact: true })
          .click();
    }
    if (c.action === "nested-photo") await page.getByRole("alert").waitFor();
    if (["pick", "ticket-scan", "ticket-photo"].includes(c.action)) {
      await page.getByRole("button", { name: /^DEMO-F02-Z01/ }).click();
      if (c.action !== "pick")
        await page
          .getByRole("button", {
            name: c.action === "ticket-photo" ? t.photoAi : t.scanCode,
            exact: true,
          })
          .click();
    }
    if (
      [
        "camera",
        "scan",
        "location-scan",
        "ticket-scan",
        "photo",
        "ticket-photo",
        "photo-retake",
      ].includes(c.action)
    ) {
      // Wait for the deliberate camera refusal; a decoder import can still be
      // starting when the component has already rendered its frame.
      await page
        .getByRole("button", { name: t.retryCamera, exact: true })
        .waitFor();
    }
    // Leave the action to expose its persistent selected state, not hover.
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    const dom = await page.evaluate(() => ({
      text: document.body.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth,
      h1: document.querySelectorAll("h1").length,
    }));
    const filename = `${phase}-${c.view}-${c.locale}-${c.width}${c.name ? `-${c.name}` : ""}.png`;
    const path = resolve(output, filename);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    const capture = {
      ...c,
      height,
      phase,
      sourceCommit,
      filename,
      path,
      url: page.url(),
      ...dom,
      errors,
    };
    const previous = captures.findIndex((entry) => entry.filename === filename);
    if (previous === -1) captures.push(capture);
    else captures[previous] = capture;
    await writeFile(manifest, `${JSON.stringify(captures, null, 2)}\n`);
    console.log(
      filename,
      dom.overflow ? "OVERFLOW" : "ok",
      errors.length ? errors : "",
    );
    if (dom.overflow || errors.length)
      throw new Error(`Visual fixture check failed: ${filename}`);
    await context.close();
  }
} finally {
  await browser.close();
}
