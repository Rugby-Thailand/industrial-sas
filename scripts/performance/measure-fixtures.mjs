// Production Vite builds of the existing isolated UI fixtures; numeric output only.
import { chromium, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import {
  measurementOptions,
  evidenceLabel,
  summarize,
} from "./measurement.mjs";
const label = evidenceLabel(process.argv[2] ?? "baseline");
const options = measurementOptions();
if (options.network !== "none")
  throw Error("Fixture measurements require unthrottled loopback");
const workspace =
  process.env.PERFORMANCE_WORKSPACE_URL ?? "http://127.0.0.1:3236";
const scanning =
  process.env.PERFORMANCE_SCANNING_URL ?? "http://127.0.0.1:3237";
for (const origin of [workspace, scanning]) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
    throw Error("Loopback fixtures required");
}
const browser = await chromium.launch();
const rows = [];
const record = (row) => {
  if (row.run >= 0) rows.push(row);
};
const settle = (p) =>
  p.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const init = () => {
  window.__labLongTasks = [];
  new PerformanceObserver((list) =>
    window.__labLongTasks.push(
      ...list.getEntries().map((entry) => entry.duration),
    ),
  ).observe({ type: "longtask", buffered: true });
};
const tasks = (p) =>
  p.evaluate(() => ({
    longTaskCount: window.__labLongTasks.length,
    longTaskMs: window.__labLongTasks.reduce((s, d) => s + d, 0),
    jsDecodedBytes: performance
      .getEntriesByType("resource")
      .filter((r) => r.name.endsWith(".js"))
      .reduce((s, r) => s + r.decodedBodySize, 0),
  }));
try {
  for (const width of options.widths) {
    for (const locale of options.locales) {
      const messages = JSON.parse(
        readFileSync(`messages/${locale}.json`, "utf8"),
      ).StorageLayouts;
      for (let run = -options.warmups; run < options.samples; run++) {
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        await ctx.addInitScript(init);
        const page = await ctx.newPage();
        for (const cache of ["cold", "warm"]) {
          const started = performance.now();
          await page.goto(
            `${workspace}/?panel=list&fixture=empty&locale=${locale}`,
          );
          await expect(page.locator("[data-location-row]")).toHaveCount(25);
          const usableMs = performance.now() - started;
          await settle(page);
          record({
            flow: "workspace-list",
            width,
            locale,
            run,
            cache,
            usableMs,
            ...(await tasks(page)),
          });
        }
        const nextName = messages.locationTable.next;
        const next = page.getByRole("button", { name: nextName, exact: true });
        const before = await page
          .locator("[data-location-row]")
          .first()
          .textContent();
        const pageStarted = performance.now();
        await next.click();
        await expect(
          page.locator("[data-location-row]").first(),
        ).not.toHaveText(before);
        await settle(page);
        record({
          flow: "workspace-page",
          width,
          locale,
          run,
          usableMs: performance.now() - pageStarted,
        });
        const mapStarted = performance.now();
        await page
          .getByRole("button", { name: messages.workspace.map, exact: true })
          .click();
        await expect(page.locator("[data-map-zone-id]")).toHaveCount(198);
        await settle(page);
        record({
          flow: "workspace-map-switch",
          width,
          locale,
          run,
          usableMs: performance.now() - mapStarted,
          ...(await tasks(page)),
        });
        const scanStarted = performance.now();
        await page.goto(`${scanning}/?locale=${locale}`);
        await page
          .getByRole("button", {
            name: locale === "en" ? "Choose image" : "เลือกภาพ",
            exact: true,
          })
          .waitFor();
        const usableMs = performance.now() - scanStarted;
        await settle(page);
        record({
          flow: "scanning-load",
          width,
          locale,
          run,
          cache: "cold",
          usableMs,
          ...(await tasks(page)),
        });
        await page.evaluate(() => {
          window.__labLongTasks = [];
          window.__labGaps = [];
          let last = performance.now();
          window.__labTimer = setInterval(() => {
            const now = performance.now();
            window.__labGaps.push(Math.max(0, now - last - 16));
            last = now;
          }, 16);
        });
        const decodeStarted = performance.now();
        const files = [
          "location-1.webp",
          "location-18.webp",
          "location-18.png",
          "location-4-2.png",
          "location-3-11.png",
          "location-22-2.webp",
        ];
        for (const file of files) {
          await page
            .locator("input[type=file]")
            .setInputFiles(`tests/fixtures/barcode-photos/${file}`);
          await page
            .getByRole("button", {
              name:
                locale === "en" ? "Use scanned code(s)" : "ใช้รหัสที่อ่านได้",
              exact: true,
            })
            .click();
        }
        await expect(page.getByLabel("Decoded codes")).toHaveText(
          "F2-L28-1, F2-L28-18, F2-L28-18, F1-L4-2, F1-L3-11, F1-L22-2",
        );
        const decodeMs = performance.now() - decodeStarted;
        await settle(page);
        const maxEventLoopDelayMs = await page.evaluate(() => {
          clearInterval(window.__labTimer);
          return Math.max(0, ...window.__labGaps);
        });
        record({
          flow: "scanning-six-photos",
          width,
          locale,
          run,
          decodeMs,
          maxEventLoopDelayMs,
          ...(await tasks(page)),
        });
        await ctx.close();
      }
    }
  }
} catch {
  rows.push({
    flow: "fixture-run",
    status: "error",
    reason: "setup-or-action",
  });
  process.exitCode = 1;
} finally {
  await browser.close();
}
mkdirSync("output/performance", { recursive: true });
writeFileSync(
  `output/performance/${label}-fixtures.json`,
  JSON.stringify(
    {
      machine: { cpu: os.cpus()[0].model, node: process.version },
      browserVersion: browser.version(),
      protocol: {
        samples: options.samples,
        warmups: options.warmups,
        widths: options.widths,
        locales: options.locales,
        network: options.network,
      },
      summary: summarize(rows),
      conditions:
        "Production Vite fixture builds; Chromium; loopback; no throttle; reduced motion; parameterized samples and excluded warmups; cold=new context; warm=same-context reload; no physical camera; lab only",
      rows,
    },
    null,
    2,
  ),
);
console.log(`Saved ${rows.length} production fixture samples`);
