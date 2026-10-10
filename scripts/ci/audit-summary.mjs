#!/usr/bin/env node
// Informative all-severity dependency audit for the scheduled Security audit
// workflow (S12). High/critical findings are enforced separately by the
// root-owned exact-chain wrapper (scripts/ci/audit-dependencies.mjs); this
// step reports every advisory as a warning while the dev/tool baseline is
// established. It exits 1 only on an audit outage — never a silent pass.
//
//   node scripts/ci/audit-summary.mjs --dir=.|tools/release
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditSummary } from "./report-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = process.argv[2] ?? "";
const match = /^--dir=(.+)$/.exec(arg);
if (!match || process.argv.length !== 3) {
  console.error("Usage: audit-summary.mjs --dir=<path inside the repository>");
  process.exit(2);
}
const cwd = resolve(root, match[1]);
const directory = relative(root, cwd) || ".";
if (directory.startsWith("..")) {
  console.error("--dir must stay inside the repository");
  process.exit(2);
}

const result = spawnSync("pnpm", ["audit", "--json"], {
  cwd,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: 3 * 60_000,
  stdio: ["ignore", "pipe", "pipe"],
});
let summary;
try {
  if (result.error || ![0, 1].includes(result.status ?? -1))
    throw new Error("pnpm audit did not complete");
  summary = auditSummary(JSON.parse(result.stdout));
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
  if ((result.status === 0) !== (total === 0))
    throw new Error("pnpm audit exit status contradicts its report");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error::Audit outage in ${directory}: ${message}`);
  process.exit(1);
}

const counts = Object.entries(summary.counts)
  .map(([severity, count]) => `${severity} ${count}`)
  .join(", ");
for (const advisory of summary.advisories) {
  console.log(
    `::warning::${directory}: ${advisory.ghsa} ${advisory.package}@${advisory.versions.join("|")} (${advisory.severity})`,
  );
}
console.log(`pnpm audit ${directory} (all severities, informative): ${counts}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Full dependency audit: \`${directory}\` (informative)`,
      "",
      `Advisories: ${counts}.`,
      "",
      ...summary.advisories.map(
        (a) =>
          `- ${a.severity}: ${a.ghsa} \`${a.package}@${a.versions.join("|")}\``,
      ),
      "",
    ].join("\n"),
  );
}
