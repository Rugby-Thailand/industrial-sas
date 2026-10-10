import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { auditProblems } from "../../scripts/ci/audit-dependencies.mjs";

const exceptions = JSON.parse(
  readFileSync("scripts/ci/dependency-exceptions.json", "utf8"),
).exceptions;
const exception = exceptions[0];
const now = Date.parse("2026-10-10T00:00:00Z");
const advisory = {
  github_advisory_id: exception.ghsa,
  module_name: exception.package,
  severity: "high",
  findings: [{ version: "3.0.3", paths: exception.paths.release }],
};
const report = {
  advisories: { example: advisory },
  metadata: { vulnerabilities: { high: 1, critical: 0 } },
};

describe("scoped dependency risk exceptions", () => {
  it("accepts only the documented version and exact trusted-tool chain before expiry", () => {
    expect(auditProblems(report, exceptions, "release", now)).toEqual([]);
    expect(auditProblems(report, exceptions, "app", now)).not.toEqual([]);
    expect(
      auditProblems(
        report,
        exceptions,
        "release",
        Date.parse(exception.expiresAt),
      ),
    ).not.toEqual([]);
  });

  it("refuses a new advisory, critical severity, changed version or application runtime chain", () => {
    for (const change of [
      { github_advisory_id: "GHSA-aaaa-bbbb-cccc" },
      { severity: "critical" },
      { module_name: "other" },
      { findings: [{ version: "3.0.2", paths: exception.paths.release }] },
      { findings: [{ version: "3.0.3", paths: [".>next>braces"] }] },
      { findings: [] },
    ]) {
      expect(
        auditProblems(
          { ...report, advisories: { example: { ...advisory, ...change } } },
          exceptions,
          "release",
          now,
        ),
      ).not.toEqual([]);
    }
  });

  it("refuses registry errors, omitted inventories, unmatched totals and malformed exceptions", () => {
    expect(auditProblems({}, exceptions, "release", now)).not.toEqual([]);
    expect(
      auditProblems({ ...report, advisories: {} }, exceptions, "release", now),
    ).not.toEqual([]);
    expect(
      auditProblems(
        report,
        [{ ...exception, expiresAt: "invalid" }],
        "release",
        now,
      ),
    ).not.toEqual([]);
    expect(
      auditProblems(report, [{ ...exception, owner: "" }], "release", now),
    ).not.toEqual([]);
  });

  it("rejects every malformed or unsupported advisory before severity filtering", () => {
    const clean = { metadata: { vulnerabilities: { high: 0, critical: 0 } } };
    for (const row of [
      null,
      {},
      { ...advisory, severity: "unknown" },
      { ...advisory, severity: "moderate", findings: [] },
      { ...advisory, severity: "low", github_advisory_id: "invalid" },
      { ...advisory, severity: "low", module_name: "" },
      { ...advisory, severity: "low", findings: [{ version: "", paths: [] }] },
    ]) {
      expect(
        auditProblems(
          { ...clean, advisories: { malformed: row } },
          [],
          "app",
          now,
        ),
      ).not.toEqual([]);
    }
    expect(
      auditProblems(
        { ...clean, advisories: {}, error: { code: "REGISTRY_FAILURE" } },
        [],
        "app",
        now,
      ),
    ).not.toEqual([]);
  });
});
