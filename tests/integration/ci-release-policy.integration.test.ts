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
    releaseTarget?: string;
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
    inputs: { release_target: input.releaseTarget ?? "" },
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
    [undefined, undefined, "true"],
    ["", "false", "true"],
    ["true", "false", "true"],
    ["false", "false", "false"],
    ["false", "true", "true"],
    ["FALSE", undefined, "true"],
    ["invalid", undefined, "true"],
  ])(
    "captures staging flag %s with staging-only %s as %s",
    (value, stagingOnly, expected) => {
      const directory = mkdtempSync(join(tmpdir(), "ci-release-policy-"));
      const output = join(directory, "outputs");
      const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: output };
      delete env.STAGING_ENABLED;
      delete env.STAGING_ONLY;
      if (value !== undefined) env.STAGING_ENABLED = value;
      if (stagingOnly !== undefined) env.STAGING_ONLY = stagingOnly;
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
        decision("release", {
          policy: "false",
          staging: "skipped",
          event,
          releaseTarget: event === "workflow_dispatch" ? "production" : "",
        }),
      ).toBe(true);
    // Downstream conditions must read the captured check output, never vars.
    for (const job of ["staging", "release"] as const)
      expect(workflow.jobs[job].if).not.toContain("vars.");
  });

  it("allows a main staging rehearsal and blocks production after every staging outcome", () => {
    const dispatch = { event: "workflow_dispatch", releaseTarget: "staging" };
    const policyStep = workflow.jobs.check.steps.find(
      (step: { id?: string }) => step.id === "release-policy",
    );
    const stagingOnly = policyStep.env.STAGING_ONLY;
    for (const [event, target, expected] of [
      ["workflow_dispatch", "staging", true],
      ["workflow_dispatch", "production", false],
      ["push", "", false],
    ])
      expect(
        runInNewContext(stagingOnly.slice(3, -2).trim(), {
          github: { event_name: event },
          inputs: { release_target: target },
        }),
      ).toBe(expected);
    expect(decision("staging", dispatch)).toBe(true);
    expect(
      decision("staging", { ...dispatch, ref: "refs/heads/feature" }),
    ).toBe(false);
    for (const check of results.filter((result) => result !== "success"))
      expect(decision("staging", { ...dispatch, check })).toBe(false);
    expect(decision("staging", { ...dispatch, cancelled: true })).toBe(false);
    for (const staging of results)
      for (const policy of ["true", "false"])
        expect(decision("release", { ...dispatch, policy, staging })).toBe(
          false,
        );
  });

  it.each(["", "unknown"])(
    "blocks both release jobs for a dispatch with target %j",
    (releaseTarget) => {
      for (const job of ["staging", "release"] as const)
        expect(
          decision(job, { event: "workflow_dispatch", releaseTarget }),
        ).toBe(false);
    },
  );
});
