import { describe, expect, it } from "vitest";

import {
  aggregateProblems,
  junitSummary,
  parsePorcelainZ,
  presentSecretNames,
  testDiscoveryProblems,
} from "../../scripts/ci/lib.mjs";

describe("clean-tree parsing", () => {
  it("lists modified, untracked and renamed paths", () => {
    expect(
      parsePorcelainZ(
        " M convex/_generated/server.js\0?? next-env.d.ts\0R  new.ts\0old.ts\0",
      ),
    ).toEqual([
      { status: " M", path: "convex/_generated/server.js" },
      { status: "??", path: "next-env.d.ts" },
      { status: "R ", path: "new.ts" },
    ]);
    expect(parsePorcelainZ("")).toEqual([]);
  });
});

describe("test discovery guard", () => {
  const tracked = [
    "src/a.test.tsx",
    "tests/integration/b.integration.test.ts",
    "tests/e2e/smoke/c.spec.ts",
    "README.md",
  ];

  it("passes when every tracked test is collected exactly once", () => {
    expect(
      testDiscoveryProblems({
        tracked,
        vitest: [
          { file: "src/a.test.tsx", projectName: "unit" },
          {
            file: "tests/integration/b.integration.test.ts",
            projectName: "integration",
          },
        ],
        playwright: ["tests/e2e/smoke/c.spec.ts", "tests/e2e/smoke/c.spec.ts"],
      }),
    ).toEqual([]);
  });

  it("reports silently excluded, doubly collected and untracked tests", () => {
    expect(
      testDiscoveryProblems({
        tracked,
        vitest: [
          { file: "src/a.test.tsx", projectName: "unit" },
          { file: "src/a.test.tsx", projectName: "a11y" },
          { file: "src/untracked.test.ts", projectName: "unit-node" },
        ],
        playwright: [],
      }),
    ).toEqual([
      "src/a.test.tsx: collected more than once (vitest:unit, vitest:a11y)",
      "src/untracked.test.ts: collected but not tracked by git",
      "tests/e2e/smoke/c.spec.ts: not collected by any runner",
      "tests/integration/b.integration.test.ts: not collected by any runner",
    ]);
  });
});

describe("merged JUnit summary", () => {
  it("reads totals from the root element", () => {
    expect(
      junitSummary(
        '<?xml version="1.0"?><testsuites name="vitest" tests="12" failures="1" errors="0" skipped="2" time="1"><testsuite/></testsuites>',
      ),
    ).toEqual({ tests: 12, failures: 1, errors: 0, skipped: 2 });
  });

  it("refuses a report without a root element", () => {
    expect(() => junitSummary("")).toThrow();
  });
});

describe("secret presence", () => {
  it("returns names of set variables only", () => {
    expect(
      presentSecretNames({ CONVEX_DEPLOY_KEY: " ", CONVEX_ADMIN_KEY: "x" }, [
        "CONVEX_DEPLOY_KEY",
        "CONVEX_ADMIN_KEY",
        "CONVEX_DEPLOYMENT",
      ]),
    ).toEqual(["CONVEX_ADMIN_KEY"]);
  });
});

describe("aggregate quality gate", () => {
  const base = { validate: "success", test: "success", build: "success" };

  it("passes only when every mandatory job succeeded", () => {
    expect(aggregateProblems({ event: "push", results: base })).toEqual([]);
    for (const state of ["failure", "cancelled", "skipped", ""]) {
      expect(
        aggregateProblems({ event: "push", results: { ...base, test: state } }),
      ).toHaveLength(1);
    }
    expect(aggregateProblems({ event: "push", results: {} })).toEqual([
      "no jobs reported",
    ]);
  });

  it("requires PR-only jobs on pull requests and an intentional skip elsewhere", () => {
    const pullRequestOnly = ["dependency-review"];
    const withReview = (state: string) => ({
      ...base,
      "dependency-review": state,
    });
    expect(
      aggregateProblems({
        event: "pull_request",
        results: withReview("success"),
        pullRequestOnly,
      }),
    ).toEqual([]);
    for (const state of ["skipped", "failure", "cancelled"]) {
      expect(
        aggregateProblems({
          event: "pull_request",
          results: withReview(state),
          pullRequestOnly,
        }),
      ).toHaveLength(1);
    }
    for (const event of ["push", "workflow_dispatch"]) {
      expect(
        aggregateProblems({
          event,
          results: withReview("skipped"),
          pullRequestOnly,
        }),
      ).toEqual([]);
      expect(
        aggregateProblems({
          event,
          results: withReview("success"),
          pullRequestOnly,
        }),
      ).toHaveLength(1);
    }
  });

  const required = [
    "validate",
    "codegen",
    "test",
    "test-report",
    "build",
    "browser",
    "dependency-review",
  ];
  const all = (overrides: Record<string, string> = {}) => ({
    validate: "success",
    codegen: "success",
    test: "success",
    "test-report": "success",
    build: "success",
    browser: "success",
    "dependency-review": "success",
    ...overrides,
  });

  it("requires every declared job on pull requests, including dependency review", () => {
    const pullRequestOnly = ["dependency-review"];
    expect(
      aggregateProblems({
        event: "pull_request",
        results: all(),
        required,
        pullRequestOnly,
      }),
    ).toEqual([]);
    for (const job of required) {
      for (const state of ["failure", "cancelled", "skipped"]) {
        expect(
          aggregateProblems({
            event: "pull_request",
            results: all({ [job]: state }),
            required,
            pullRequestOnly,
          }),
        ).toEqual([`${job}: ${state} (expected success)`]);
      }
    }
  });

  it("accepts the PR-only skip only on push and workflow_dispatch", () => {
    const pullRequestOnly = ["dependency-review"];
    for (const event of ["push", "workflow_dispatch"]) {
      expect(
        aggregateProblems({
          event,
          results: all({ "dependency-review": "skipped" }),
          required,
          pullRequestOnly,
        }),
      ).toEqual([]);
      // A mandatory job may never be skipped on main.
      expect(
        aggregateProblems({
          event,
          results: all({ "dependency-review": "skipped", browser: "skipped" }),
          required,
          pullRequestOnly,
        }),
      ).toEqual(["browser: skipped (expected success)"]);
    }
    for (const event of [
      "schedule",
      "merge_group",
      "pull_request_target",
      "",
    ]) {
      expect(
        aggregateProblems({
          event,
          results: all({ "dependency-review": "skipped" }),
          required,
          pullRequestOnly,
        }),
      ).toContain(`event ${event || "missing"}: not an aggregate event`);
    }
  });

  it("fails when needs and the declared required jobs drift apart", () => {
    const withoutBrowser = Object.fromEntries(
      Object.entries(all()).filter(([job]) => job !== "browser"),
    );
    expect(
      aggregateProblems({
        event: "push",
        results: withoutBrowser,
        required,
        pullRequestOnly: [],
      }),
    ).toEqual(["browser: missing (expected success)"]);
    expect(
      aggregateProblems({
        event: "push",
        results: { ...all(), extra: "success" },
        required,
      }),
    ).toEqual(["extra: reported but not declared required"]);
    expect(
      aggregateProblems({
        event: "push",
        results: all(),
        required: required.filter((job) => job !== "dependency-review"),
        pullRequestOnly: ["dependency-review"],
      }),
    ).toEqual([
      "dependency-review: PR-only job is not a required job",
      "dependency-review: reported but not declared required",
    ]);
  });
});
