import { describe, expect, it } from "vitest";

import { auditProblems } from "../../scripts/ci/audit-dependencies.mjs";

// Policy fixtures stay test-owned when the live exception list is empty.
const exception = {
  ghsa: "GHSA-aaaa-bbbb-cccc",
  package: "example",
  version: "3.0.3",
  severity: "high",
  expiresAt: "2026-11-09T00:00:00Z",
  owner: "Test maintainer",
  reason: "Exact-chain policy fixture",
  paths: {
    app: [".>linter>example"],
    release: [".>release-cli>example"],
  },
};
const exceptions = [exception];
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
      { github_advisory_id: "GHSA-dddd-eeee-ffff" },
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
