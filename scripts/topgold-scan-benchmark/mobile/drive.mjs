// Headless Chromium driver for the TopGold live-camera replay (mobile follow-up).
// Usage (server first: node scripts/topgold-scan-benchmark/mobile/server.mjs):
//   node scripts/topgold-scan-benchmark/mobile/drive.mjs <caps|pass|repeat|live> [run-name]
// Timed phases refuse to start until the static benchmark marker exists, so the two
// benchmarks never compete for CPU. Override only with MOBILE_FORCE=1.
import { chromium } from "@playwright/test";
import { access, appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

const [phase, name = phase] = process.argv.slice(2);
const base = `http://127.0.0.1:${process.env.MOBILE_BENCH_PORT || 3193}`;
const out = resolve(
  process.cwd(),
  "docs/reviews/assets/topgold-scanning-2026-10-16/mobile/raw",
);
const MARKER = "/tmp/topgold-static-timing-complete";

// Predeclared stratified subset (chosen from manifest metadata and visual inspection of
// 8 thumbnails BEFORE any decode in this harness): location barcode/visual-read, 3 source
// sizes, 90°/180° label rotation, multi-label (2), uncertain label (17), tickets FO/FOM,
// landscape (73), creased/glare (99), visual-read tickets (81, 112), large 3472×4624
// sources (40, 44), and no-barcode product labels as real negatives (145, 146).
export const SUBSET = [
  1, 2, 14, 21, 25, 12, 16, 17, 18, 26, 28, 33, 74, 106, 136, 149, 163, 40, 44,
  50, 52, 57, 60, 73, 77, 81, 99, 112, 131, 137, 150, 164, 165, 145, 146,
];
const VARIANTS = [
  "jsDefault",
  "jsHinted",
  "liveFallback",
  "wasmFast",
  "wasmHard",
  "wasmRoiFast",
  "native",
];

if (phase !== "caps") {
  try {
    await access(MARKER);
  } catch {
    if (!process.env.MOBILE_FORCE)
      throw Error(`Refusing timed phase: ${MARKER} is absent`);
  }
}
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--disable-background-timer-throttling"],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("pageerror", error.message));
await page.goto(`${base}/__mobile`);
await page.waitForFunction(() => window.mobileReady === true, null, {
  timeout: 120000,
});
const meta = {
  kind: "meta",
  phase,
  run: name,
  startedAt: new Date().toISOString(),
  browserVersion: browser.version(),
  executable: chromium.executablePath(),
  headless: true,
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  cpus: os.cpus().length,
  memoryGb: Math.round(os.totalmem() / 2 ** 30),
  loadAvg: os.loadavg(),
  subset: SUBSET,
};
await appendFile(resolve(out, `${name}.jsonl`), JSON.stringify(meta) + "\n");
console.log(JSON.stringify(meta));
const timer = setInterval(async () => {
  try {
    console.log(JSON.stringify(await page.evaluate(() => window.progress)));
  } catch {
    // Page busy; next tick.
  }
}, 30000);

const started = Date.now();
// MOBILE_IDS restricts any timed phase (smoke checks only; scored runs use the defaults).
const only = process.env.MOBILE_IDS?.split(",").map(Number);
const allIds =
  only ?? (await page.evaluate(() => window.mobileManifest())).map((r) => r.id);
const subset = only ?? SUBSET;
// Post-hoc additions run as separate named runs instead of re-running scored variants.
const variants = process.env.MOBILE_VARIANTS?.split(",") ?? VARIANTS;
if (phase === "caps") {
  const caps = await page.evaluate(() => window.mobileCaps());
  await appendFile(
    resolve(out, `${name}.jsonl`),
    JSON.stringify({ kind: "caps", ...caps }) + "\n",
  );
  console.log(JSON.stringify(caps, null, 2));
} else {
  const setup = await page.evaluate((run) => window.mobileSetup(run), name);
  console.log(JSON.stringify(setup));
  if (phase === "pass") {
    // All 153 unique photos once, both frame sizes, plus two synthetic controls.
    const plan = {
      ids: allIds,
      sizes: [1920, 1080],
      variants,
      reps: 1,
      controls: true,
    };
    await page.evaluate(
      ([run, p, ph]) => window.mobileRun(run, p, ph),
      [name, plan, phase],
    );
  } else if (phase === "repeat") {
    const plan = {
      ids: subset,
      sizes: [1920, 1080],
      variants,
      reps: Number(process.env.MOBILE_REPS || 3),
    };
    await page.evaluate(
      ([run, p, ph]) => window.mobileRun(run, p, ph),
      [name, plan, phase],
    );
  } else if (phase === "live") {
    const windowMs = Number(process.env.MOBILE_WINDOW_MS || 4000);
    await page.evaluate(
      ([run, p]) => window.mobileLive(run, p),
      [name, { ids: subset, windowMs, size: 1920 }],
    );
  } else if (phase === "live2") {
    const windowMs = Number(process.env.MOBILE_WINDOW_MS || 4000);
    await page.evaluate(
      ([run, p]) => window.mobileLive(run, p),
      [
        name,
        {
          ids: subset,
          windowMs,
          size: 1920,
          // v1 and current were already run twice ("live", "live-rerun").
          schedulerList: ["proposedV2"],
        },
      ],
    );
  } else if (phase === "diagnose") {
    // Production-fallback deliveries that differed from the provisional label in "pass".
    const items = JSON.parse(process.env.MOBILE_ITEMS || "[]");
    await page.evaluate(
      ([run, i]) => window.mobileDiagnose(run, i),
      [name, items],
    );
  } else throw Error(`Unknown phase ${phase}`);
}
clearInterval(timer);
console.log(`done ${phase} in ${Math.round((Date.now() - started) / 1000)}s`);
await browser.close();
