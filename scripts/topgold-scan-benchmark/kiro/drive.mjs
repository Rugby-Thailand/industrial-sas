// Headless Chromium driver for the local Kiro TopGold benchmark.
// Usage: node scripts/topgold-scan-benchmark/kiro/drive.mjs <phase> [run-name]
//   phases: setup | probe | pass1 | repeat | controls
import { chromium } from "@playwright/test";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

const [phase, name = phase] = process.argv.slice(2);
const base = `http://127.0.0.1:${process.env.KIRO_BENCH_PORT || 3192}`;
const out = resolve(
  process.cwd(),
  "docs/reviews/assets/topgold-scanning-2026-10-16/kiro/raw",
);
await mkdir(out, { recursive: true });

// Stratified fixed subset for repeated timing (selected after pass 1; see report).
const SUBSET = (process.env.KIRO_SUBSET || "")
  .split(",")
  .filter(Boolean)
  .map(Number);
const PASS1_VARIANTS = [
  "production",
  "prodWarm",
  "full1600fast",
  "full1600",
  "full3000",
  "roiFast",
  "roiHard",
  "cascade",
];
const REPEAT_VARIANTS = (
  process.env.KIRO_VARIANTS || "full1600,full3000,roiFast,roiHard,cascade"
).split(",");

const browser = await chromium.launch({
  args: ["--disable-background-timer-throttling"],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("pageerror", error.message));
await page.goto(`${base}/__kiro`);
await page.waitForFunction(() => window.kiroReady === true, null, {
  timeout: 120000,
});
const meta = {
  kind: "meta",
  phase,
  run: name,
  startedAt: new Date().toISOString(),
  browserVersion: browser.version(),
  executable: chromium.executablePath(),
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  cpus: os.cpus().length,
  memoryGb: Math.round(os.totalmem() / 2 ** 30),
  page: await page.evaluate(() => window.kiroInfo()),
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

const allIds = (await page.evaluate(() => window.kiroManifest())).map(
  (r) => r.id,
);
const ids = process.env.KIRO_IDS
  ? process.env.KIRO_IDS.split(",").map(Number)
  : allIds;
const started = Date.now();
if (phase === "setup")
  await page.evaluate((run) => window.kiroSetup(run, 5), name);
else if (phase === "probe")
  await page.evaluate((run) => window.kiroProbe(run), name);
else if (phase === "pass1") {
  const only = process.env.KIRO_VARIANTS?.split(",") ?? PASS1_VARIANTS;
  const plan = only.map((variant) => ({ round: 0, variant, ids }));
  await page.evaluate(([run, p]) => window.kiroRun(run, p), [name, plan]);
} else if (phase === "repeat") {
  if (!SUBSET.length) throw Error("Set KIRO_SUBSET");
  const plan = [];
  // Three rounds; variant order rotates each round to spread drift/thermal effects.
  for (let round = 1; round <= 3; round++) {
    const shift = (round - 1) * 2;
    const order = REPEAT_VARIANTS.map(
      (_, i) => REPEAT_VARIANTS[(i + shift) % REPEAT_VARIANTS.length],
    );
    for (const variant of order) plan.push({ round, variant, ids: SUBSET });
  }
  await page.evaluate(([run, p]) => window.kiroRun(run, p), [name, plan]);
} else if (phase === "controls")
  await page.evaluate(
    (run) =>
      window.kiroControls(run, [
        "production",
        "full1600",
        "full3000",
        "roiHard",
        "cascade",
      ]),
    name,
  );
else throw Error(`Unknown phase ${phase}`);
clearInterval(timer);
console.log(`done ${phase} in ${Math.round((Date.now() - started) / 1000)}s`);
await browser.close();
