// Parent audit: keep denominators fixed, including rejected images/timeouts.
// Run after Kiro: node scripts/topgold-scan-benchmark/summarize.mjs
import { readFile, writeFile } from "node:fs/promises";
import { score } from "./kiro/analyze.mjs";

const dir = "docs/reviews/assets/topgold-scanning-2026-10-16";
const { rows: manifest } = JSON.parse(
  await readFile(`${dir}/manifest.json`, "utf8"),
);
const raw = (await readFile(`${dir}/kiro/raw/pass1.jsonl`, "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse)
  .filter((r) => r.kind === "result");
const expectedLocations = manifest.filter(
  (r) => r.category.startsWith("1_") && !r.location.includes("เลขท้ายไม่ชัด"),
).length;
const expectedJobs = manifest.filter((r) => r.job_no).length;
const audit = JSON.parse(await readFile(`${dir}/dataset-audit.json`, "utf8"));
const tooLarge = new Set(
  audit.rows.filter((r) => r.exceedsBarcodePixelLimit).map((r) => r.id),
);
const quantile = (values, fraction) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length
    ? Math.round(sorted[Math.ceil(sorted.length * fraction) - 1])
    : null;
};
const summary = {};
for (const variant of new Set(raw.map((r) => r.variant))) {
  const rows = raw.filter((r) => r.variant === variant);
  const scored = rows.map((r) => ({ ...r, score: score(r) }));
  const timings = rows.map((r) => r.wallMs);
  const eligible = rows.filter((r) => !tooLarge.has(r.id)).map((r) => r.wallMs);
  summary[variant] = {
    measured: rows.length,
    complete: rows.length === manifest.length,
    locationDenominator: expectedLocations,
    locationExact: scored.filter(
      (r) => r.target === "LOCATION" && r.score.status === "exact",
    ).length,
    locationWrongCandidates: scored
      .filter((r) => r.target === "LOCATION" && r.score.wrongCodes)
      .map((r) => ({ id: r.id, codes: r.score.wrongCodes })),
    jobDenominator: expectedJobs,
    jobExact: scored.filter((r) => r.score.jobStatus === "exact").length,
    ticketPairYield: scored.filter((r) => r.score.fullTicket).length,
    fieldRoutingOk: scored.filter((r) => r.score.productionFieldOk).length,
    inputErrors: rows.filter((r) => r.error).length,
    timeouts: rows.filter((r) => r.timeout).length,
    p50WallMsAllIncludingFailures: quantile(timings, 0.5),
    p95WallMsAllIncludingFailures: quantile(timings, 0.95),
    // Comparable input set for cold vs warm: prodWarm bypasses the pixel guard.
    under16MPMeasured: eligible.length,
    under16MPP50WallMs: quantile(eligible, 0.5),
    under16MPP95WallMs: quantile(eligible, 0.95),
  };
}
await writeFile(
  `${dir}/parent-summary.json`,
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
