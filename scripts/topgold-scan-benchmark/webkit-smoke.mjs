// Functional desktop WebKit check. This is not an iPhone speed benchmark.
// Run after both Kiro timing jobs have finished; mobile server must be on 3193.
import { webkit } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3193/__mobile");
  await page.waitForFunction(() => window.mobileReady === true);
  const caps = await page.evaluate(() => window.mobileCaps());
  await page.evaluate(() => window.mobileSetup("webkit-smoke"));
  await page.evaluate(() =>
    window.mobileRun(
      "webkit-smoke",
      {
        ids: [1, 50],
        sizes: [1920],
        variants: ["jsDefault", "wasmHard", "wasmRegions"],
        reps: 1,
      },
      "compatibility",
    ),
  );
  const results = (
    await readFile(
      "docs/reviews/assets/topgold-scanning-2026-10-16/mobile/raw/webkit-smoke.jsonl",
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((r) => r.kind === "result")
    .slice(-6);
  const functionalChecks = {
    sixCallsCompleted: results.length === 6,
    workerProcessedTwoFrames:
      results.filter((r) => r.variant === "wasmHard").length === 2,
    regionWorkerProcessedTwoFrames:
      results.filter((r) => r.variant === "wasmRegions").length === 2,
    noDecoderErrors: results.every((r) => !r.error && !r.timeout),
    sampleJobDecodedByBoth: results
      .filter((r) => r.id === 50 && r.variant !== "wasmRegions")
      .every((r) => r.symbols.some((s) => s.text === "FO69100125")),
  };
  const report = {
    browser: "desktop WebKit",
    version: browser.version(),
    purpose: "functional smoke only; not actual iPhone or speed evidence",
    caps,
    errors,
    functionalChecks,
    progress: await page.evaluate(() => window.progress),
  };
  await writeFile(
    "docs/reviews/assets/topgold-scanning-2026-10-16/webkit-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (errors.length || !Object.values(functionalChecks).every(Boolean))
    process.exitCode = 1;
} finally {
  await browser.close();
}
