import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { parseYamlSubset } from "../../scripts/ci/workflow-lib.mjs";

const workflow = parseYamlSubset(
  readFileSync(".github/workflows/quality.yml", "utf8"),
);
type Result = "success" | "failure" | "cancelled" | "skipped";
const results: Result[] = ["success", "failure", "cancelled", "skipped"];

// These actual YAML conditions use only operators shared with JavaScript and
// the explicit cancelled() status function. Policy tests also require that
// function, so GitHub's implicit success() cannot hide a skipped-ancestor bug.
function decision(
  job: "staging" | "release",
  input: {
    policy?: string;
    check?: Result;
    staging?: Result;
    outcome?: string;
    repository?: string;
    ref?: string;
    event?: string;
    cancelled?: boolean;
  } = {},
) {
  const condition = workflow.jobs[job].if;
  return runInNewContext(condition.slice(3, -2).trim(), {
    cancelled: () => input.cancelled ?? false,
    github: {
      repository: input.repository ?? "Rugby-Thailand/industrial-sas",
      ref: input.ref ?? "refs/heads/main",
      event_name: input.event ?? "push",
    },
    needs: {
      check: {
        result: input.check ?? "success",
        outputs: { staging_enabled: input.policy ?? "true" },
      },
      staging: {
        result: input.staging ?? "success",
        outputs: { outcome: input.outcome ?? "STAGING_PASSED" },
      },
    },
  });
}

describe("captured staging policy", () => {
  it.each([
    [undefined, "true"],
    ["", "true"],
    ["true", "true"],
    ["false", "false"],
    ["FALSE", "true"],
    ["invalid", "true"],
  ])(
    "captures %s as %s without overwriting earlier outputs",
    (value, expected) => {
      const directory = mkdtempSync(join(tmpdir(), "ci-release-policy-"));
      const output = join(directory, "outputs");
      const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: output };
      delete env.STAGING_ENABLED;
      if (value !== undefined) env.STAGING_ENABLED = value;
      try {
        writeFileSync(output, "other=value\n");
        const result = spawnSync(
          process.execPath,
          ["scripts/ci/release-policy.mjs"],
          {
            env,
            encoding: "utf8",
          },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(output, "utf8")).toBe(
          `other=value\nstaging_enabled=${expected}\n`,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("actual release job conditions", () => {
  it("requires staging success and its controller outcome when enabled", () => {
    expect(decision("staging")).toBe(true);
    for (const staging of results)
      for (const outcome of ["STAGING_PASSED", "STAGING_FAILED", ""])
        expect(decision("release", { staging, outcome })).toBe(
          staging === "success" && outcome === "STAGING_PASSED",
        );
  });

  it("accepts only intentionally skipped staging when disabled", () => {
    expect(decision("staging", { policy: "false" })).toBe(false);
    for (const staging of results)
      expect(
        decision("release", { policy: "false", staging, outcome: "" }),
      ).toBe(staging === "skipped");
  });

  it("blocks both jobs if the captured policy is missing or invalid", () => {
    for (const policy of ["", "invalid"])
      for (const staging of results)
        for (const job of ["staging", "release"] as const)
          expect(decision(job, { policy, staging })).toBe(false);
  });

  it("blocks failed, cancelled or skipped CI under either policy", () => {
    for (const policy of ["true", "false"])
      for (const check of results.filter((result) => result !== "success"))
        for (const job of ["staging", "release"] as const)
          expect(decision(job, { policy, check, staging: "skipped" })).toBe(
            false,
          );
  });

  it("blocks cancellation and untrusted sources under either policy", () => {
    for (const policy of ["true", "false"])
      for (const source of [
        { cancelled: true },
        { repository: "foreign/repo" },
        { ref: "refs/heads/feature" },
        { event: "pull_request" },
        { event: "schedule" },
      ])
        for (const job of ["staging", "release"] as const)
          expect(
            decision(job, {
              policy,
              staging: policy === "false" ? "skipped" : "success",
              ...source,
            }),
          ).toBe(false);
  });

  it("allows trusted main dispatch and ignores a mid-run variable change", () => {
    for (const event of ["push", "workflow_dispatch"])
      expect(
        decision("release", { policy: "false", staging: "skipped", event }),
      ).toBe(true);
    // Downstream conditions must read the captured check output, never vars.
    for (const job of ["staging", "release"] as const)
      expect(workflow.jobs[job].if).not.toContain("vars.");
  });
});
