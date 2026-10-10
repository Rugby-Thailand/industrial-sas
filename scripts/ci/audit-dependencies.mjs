#!/usr/bin/env node
// Explicit, expiring, exact-chain exceptions; registry errors fail closed.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function auditProblems(report, exceptions, scope, now = Date.now()) {
  if (
    report?.error !== undefined ||
    !Array.isArray(exceptions) ||
    !report?.metadata?.vulnerabilities ||
    !report.advisories ||
    typeof report.advisories !== "object" ||
    Array.isArray(report.advisories)
  ) {
    return ["Audit registry response or exception configuration is invalid."];
  }
  const severities = new Set(["info", "low", "moderate", "high", "critical"]);
  const advisories = Object.values(report.advisories);
  if (
    advisories.some(
      (row) =>
        row === null ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        !severities.has(row.severity) ||
        !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(
          row.github_advisory_id ?? "",
        ) ||
        typeof row.module_name !== "string" ||
        !row.module_name ||
        !Array.isArray(row.findings) ||
        !row.findings.length ||
        row.findings.some(
          (finding) =>
            !finding ||
            typeof finding.version !== "string" ||
            !finding.version ||
            !Array.isArray(finding.paths) ||
            !finding.paths.length ||
            finding.paths.some((path) => typeof path !== "string" || !path),
        ),
    )
  ) {
    return ["Audit contains an unsupported or malformed advisory."];
  }
  const problems = [];
  for (const entry of exceptions) {
    if (
      !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(entry.ghsa ?? "") ||
      !entry.owner ||
      !entry.reason ||
      !Array.isArray(entry.paths?.[scope]) ||
      !Number.isFinite(Date.parse(entry.expiresAt)) ||
      Date.parse(entry.expiresAt) <= now
    ) {
      problems.push("A dependency exception is invalid or expired.");
    }
  }
  const high = advisories.filter((entry) =>
    ["high", "critical"].includes(entry.severity),
  );
  const metadata = report.metadata.vulnerabilities;
  if (
    ![metadata.high, metadata.critical].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    high.length !== metadata.high + metadata.critical
  ) {
    problems.push("Audit severity totals do not match its advisory inventory.");
  }
  for (const advisory of high) {
    const permitted = exceptions.find(
      (entry) =>
        entry.ghsa === advisory.github_advisory_id &&
        entry.package === advisory.module_name &&
        entry.severity === advisory.severity &&
        Date.parse(entry.expiresAt) > now &&
        Array.isArray(advisory.findings) &&
        advisory.findings.length > 0 &&
        advisory.findings.every(
          (finding) =>
            finding.version === entry.version &&
            Array.isArray(finding.paths) &&
            finding.paths.length > 0 &&
            finding.paths.every((path) => entry.paths?.[scope]?.includes(path)),
        ),
    );
    if (!permitted)
      problems.push(
        "A high or critical advisory has no valid exact-chain exception.",
      );
  }
  return problems;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const scope = process.argv[2]?.replace(/^--scope=/, "");
  if (!["app", "release"].includes(scope) || process.argv.length !== 3) {
    console.error("Usage: audit-dependencies.mjs --scope=app|release");
    process.exit(2);
  }
  const result = spawnSync(
    "pnpm",
    ["audit", "--json", "--audit-level", "high"],
    {
      cwd: scope === "release" ? "tools/release" : process.cwd(),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  try {
    if (![0, 1].includes(result.status) || result.error) throw new Error();
    const report = JSON.parse(result.stdout);
    const exceptions = JSON.parse(
      readFileSync(
        new URL("./dependency-exceptions.json", import.meta.url),
        "utf8",
      ),
    ).exceptions;
    const problems = auditProblems(report, exceptions, scope);
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exitCode = 1;
    else
      console.log(
        `Dependency audit passed (${scope}); exact-chain exceptions checked against their expiry. Unpatched risk remains documented in docs/operations/dependency-exceptions.md.`,
      );
  } catch {
    console.error(
      "Dependency audit failed; invalid registry response, command failure, or exception configuration.",
    );
    process.exitCode = 1;
  }
}
