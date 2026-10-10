import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  auditSummary,
  blobInventoryProblems,
  coverageMarkdown,
  junitProblems,
} from "../../scripts/ci/report-lib.mjs";
import {
  activeExceptionGhsas,
  actionlintAsset,
  normalizeConcurrencyQueue,
  parseYamlSubset,
  pinProblems,
  tagCommit,
  workflowPolicyProblems,
} from "../../scripts/ci/workflow-lib.mjs";

const NOW = Date.parse("2026-10-10T00:00:00Z");
const read = (path: string) => readFileSync(path, "utf8");
// Root-owned exact-chain exceptions; dependency review may allow only these.
const exceptions = JSON.parse(read("scripts/ci/dependency-exceptions.json"));
const owned = {
  "quality.yml": read(".github/workflows/quality.yml"),
  "codeql.yml": read(".github/workflows/codeql.yml"),
  "security-audit.yml": read(".github/workflows/security-audit.yml"),
  "workspace-matrix.yml": read(".github/workflows/workspace-matrix.yml"),
};
const actions = {
  "actions/setup-node-pnpm/action.yml": read(
    ".github/actions/setup-node-pnpm/action.yml",
  ),
};

/** Policy problems after applying literal edits to one owned workflow. */
function problemsWith(
  file: keyof typeof owned,
  edits: ReadonlyArray<readonly [string, string]>,
  now = NOW,
) {
  let text = owned[file];
  for (const [from, to] of edits) {
    expect(text, `edit target missing: ${from}`).toContain(from);
    text = text.replace(from, to);
  }
  return workflowPolicyProblems({
    workflows: { ...owned, [file]: text },
    actions,
    exceptions,
    now,
  });
}

describe("YAML subset reader", () => {
  it("reads block maps, sequences, flow lists, quoting and block scalars", () => {
    expect(
      parseYamlSubset(
        [
          "name: x # comment",
          "on:",
          "  push:",
          "    branches: [main, 'release']",
          "jobs:",
          "  a:",
          "    needs:",
          "      [b, c]",
          "    steps:",
          "      - uses: actions/checkout@abc # v1.0.0",
          "        with:",
          '          persist-credentials: "false"',
          "      - run: >-",
          "          one",
          "          two",
          "      - run: |",
          "          first",
          "          # kept",
          "list:",
          "- top",
        ].join("\n"),
      ),
    ).toEqual({
      name: "x",
      on: { push: { branches: ["main", "release"] } },
      jobs: {
        a: {
          needs: ["b", "c"],
          steps: [
            {
              uses: "actions/checkout@abc",
              with: { "persist-credentials": "false" },
            },
            { run: "one two" },
            { run: "first\n# kept\n" },
          ],
        },
      },
      list: ["top"],
    });
  });

  it("fails closed on constructs it does not understand", () => {
    for (const text of [
      "a: &anchor 1",
      "a: *alias",
      "a: {b: 1}",
      "a:\n\tb: 1",
      "a: 1\na: 2",
      "a:\n  b: 1\n    c: 2",
      "a: 'open",
    ])
      expect(() => parseYamlSubset(text)).toThrow();
  });
});

describe("owned workflows", () => {
  it("satisfy the repository workflow policy", () => {
    expect(
      workflowPolicyProblems({
        workflows: owned,
        actions,
        exceptions,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("share the production lock with the daily backup workflow", () => {
    const problems = workflowPolicyProblems({
      workflows: {
        ...owned,
        "production-backup.yml": read(
          ".github/workflows/production-backup.yml",
        ),
      },
      actions,
      exceptions,
      now: NOW,
    });
    expect(
      problems.filter((problem) => problem.includes("must share")),
    ).toEqual([]);
  });
});

describe("workflow policy rejects regressions", () => {
  it("replaces rerun shard reports while retaining untouched same-run shards", () => {
    expect(
      problemsWith("quality.yml", [["          overwrite: true\n", ""]]),
    ).toContain(
      "quality.yml:test: shard reports need one stable per-shard artifact name and overwrite true for failed-job reruns",
    );
    expect(
      problemsWith("quality.yml", [
        [
          "name: vitest-blob-${{ matrix.shard }}",
          "name: vitest-blob-${{ matrix.shard }}-${{ github.run_attempt }}",
        ],
      ]),
    ).toContain(
      "quality.yml:test: shard reports need one stable per-shard artifact name and overwrite true for failed-job reruns",
    );
    for (const line of [
      "          run-id: 123\n",
      "          repository: external/repository\n",
      "          github-token: token\n",
    ])
      expect(
        problemsWith("quality.yml", [
          [
            "          pattern: vitest-blob-*\n",
            `          pattern: vitest-blob-*\n${line}`,
          ],
        ]),
      ).toContain(
        "quality.yml:test-report: merge all per-shard artifacts from this same workflow run only",
      );
    expect(
      problemsWith("quality.yml", [
        [
          "          pattern: vitest-blob-*\n",
          "          pattern: vitest-blob-*-${{ github.run_attempt }}\n",
        ],
      ]),
    ).toContain(
      "quality.yml:test-report: merge all per-shard artifacts from this same workflow run only",
    );
  });

  it("keeps the stable check complete and event-aware", () => {
    expect(
      problemsWith("quality.yml", [
        [
          "[validate, codegen, test, test-report, build, browser, dependency-review]",
          "[validate, codegen, test, test-report, build, browser]",
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("quality.yml:check: needs must be exactly"),
        "quality.yml:check: REQUIRED_JOBS must equal needs",
      ]),
    );
    expect(
      problemsWith("quality.yml", [
        ["if: ${{ always() }}", "if: ${{ success() }}"],
      ]),
    ).toContain("quality.yml:check: if must be ${{ always() }}");
    expect(
      problemsWith("quality.yml", [
        [
          "    name: Browser smoke\n",
          "    name: Browser smoke\n    if: ${{ github.event_name == 'push' }}\n",
        ],
      ]),
    ).toContain("quality.yml:browser: mandatory job has a skipping if");
  });

  it("keeps PR cancellation and unique non-PR quality groups", () => {
    expect(
      problemsWith("quality.yml", [
        ["format('planner-quality-run-{0}', github.run_id)", "github.ref"],
      ]),
    ).toContain(
      "quality.yml: concurrency must group PRs by number (cancelling) and every other run by run_id",
    );
  });

  it("gates production on successful check and staging for main only", () => {
    expect(
      problemsWith("quality.yml", [
        [" && needs.staging.outputs.outcome == 'STAGING_PASSED'", ""],
      ]),
    ).toContain(
      "quality.yml:release: if must require needs.staging.outputs.outcome == 'STAGING_PASSED'",
    );
    expect(
      problemsWith("quality.yml", [
        ["    needs: [check, staging]\n", "    needs: [check]\n"],
      ]),
    ).toContain("quality.yml:release: must need staging");
    const alwaysStaging = problemsWith("quality.yml", [
      [
        "if: ${{ needs.check.result == 'success' && github.repository",
        "if: ${{ always() && needs.check.result == 'success' && github.repository",
      ],
    ]);
    expect(alwaysStaging).toContain(
      "quality.yml:staging: if must not run after failures or on PRs",
    );
  });

  it("scopes release credentials to the runner step", () => {
    expect(
      problemsWith("quality.yml", [
        [
          "          CONVEX_BACKUP_ADMIN_KEY: ${{ secrets.CONVEX_BACKUP_ADMIN_KEY }}\n",
          "          CONVEX_BACKUP_ADMIN_KEY: ${{ secrets.CONVEX_BACKUP_ADMIN_KEY }}\n          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}\n",
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        "quality.yml:release: secret CONVEX_DEPLOY_KEY is not allowlisted",
        "quality.yml:release: production deploy credentials stay in Vercel",
      ]),
    );
    expect(
      problemsWith("quality.yml", [
        [
          "      - run: pnpm build\n",
          "      - run: pnpm build\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n",
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        "quality.yml:build: secret VERCEL_TOKEN is not allowlisted",
        "quality.yml:build: quality jobs must stay secret-free",
      ]),
    );
    expect(
      problemsWith("quality.yml", [
        [
          "    runs-on: ubuntu-24.04\n    timeout-minutes: 90\n",
          "    runs-on: ubuntu-24.04\n    timeout-minutes: 90\n    env:\n      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n",
        ],
      ]),
    ).toContain("quality.yml:release: secrets outside a step env");
  });

  it("keeps the exact release locks, permissions and checkout", () => {
    expect(
      problemsWith("quality.yml", [
        [
          "      group: industrial-sas-production-release\n      cancel-in-progress: false\n      queue: max\n",
          "      group: industrial-sas-production-release\n      cancel-in-progress: false\n",
        ],
      ]),
    ).toContain(
      "quality.yml:release: concurrency must be group industrial-sas-production-release, cancel-in-progress false, queue max",
    );
    expect(
      problemsWith("quality.yml", [["      id-token: write\n", ""]]),
    ).toContain(
      'quality.yml:staging: permissions must be exactly {"contents":"read","id-token":"write"}',
    );
    expect(
      problemsWith("quality.yml", [
        [
          "    permissions:\n      contents: read\n    steps:",
          "    permissions:\n      contents: read\n      id-token: write\n    steps:",
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        "quality.yml:release: id-token: write is not allowlisted",
      ]),
    );
    expect(
      problemsWith("quality.yml", [
        [
          '          ref: ${{ github.sha }}\n          persist-credentials: false\n      - uses: ./.github/actions/setup-node-pnpm\n        with:\n          cache: "false"\n      - name: Install release tools\n        run: pnpm -C tools/release install --frozen-lockfile\n      - name: Install Playwright Chromium\n        run: pnpm exec playwright install --with-deps chromium\n      # Production',
          '          persist-credentials: false\n      - uses: ./.github/actions/setup-node-pnpm\n        with:\n          cache: "true"\n      - name: Install release tools\n        run: pnpm -C tools/release install --frozen-lockfile --ignore-workspace\n      - name: Install Playwright Chromium\n        run: pnpm exec playwright install --with-deps chromium\n      # Production',
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        "quality.yml:release: checkout must use ref ${{ github.sha }}",
        'quality.yml:release: setup must pass cache: "false"',
        "quality.yml:release: must install the locked release tools",
        "quality.yml:release: step 3 uses a forbidden flag",
      ]),
    );
  });

  it("limits release artifacts to public metadata", () => {
    expect(
      problemsWith("quality.yml", [
        [
          "            release-output/smoke-live.json\n",
          "            release-output/smoke-live.json\n            test-results/\n",
        ],
      ]),
    ).toContain(
      "quality.yml:release: uploads only release-output/backup-metadata.json, release-output/manifest.json, release-output/smoke-candidate.json, release-output/smoke-live.json",
    );
    expect(
      problemsWith("quality.yml", [["          retention-days: 3\n", ""]]),
    ).toContain(
      "quality.yml:test: upload vitest-blob-${{ matrix.shard }} needs retention-days 1–30",
    );
  });

  it("requires credential-free checkouts and pinned allowlisted actions", () => {
    expect(
      problemsWith("codeql.yml", [
        ["persist-credentials: false", "persist-credentials: true"],
      ]),
    ).toContain(
      "codeql.yml:analyze: checkout must set persist-credentials: false",
    );
    expect(
      pinProblems(
        "x.yml",
        [
          "      - uses: actions/checkout@v7",
          "      - uses: someone/action@3d3c42e5aac5ba805825da76410c181273ba90b1 # v1.0.0",
          "      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6",
          "      - uses: ./.github/actions/setup-node-pnpm",
        ].join("\n"),
      ),
    ).toEqual([
      "x.yml:1: actions/checkout@v7 is not pinned to a full commit SHA",
      'x.yml:1: actions/checkout@v7 needs an exact "# vX.Y.Z" comment',
      "x.yml:2: someone/action is outside the selected-actions allowlist",
      'x.yml:3: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 needs an exact "# vX.Y.Z" comment',
    ]);
    expect(
      problemsWith("quality.yml", [
        ["  pull_request:\n", "  pull_request_target:\n"],
      ]),
    ).toEqual(
      expect.arrayContaining([
        "quality.yml: trigger pull_request_target is not allowed",
      ]),
    );
  });

  it("ties dependency-review allow-ghsas to active, unexpired exceptions", () => {
    expect(
      problemsWith("quality.yml", [
        [
          "allow-ghsas: GHSA-vfj7-8cjw-p6xm",
          "allow-ghsas: GHSA-vfj7-8cjw-p6xm, GHSA-2g4f-4pwh-qvx6",
        ],
      ]),
    ).toContain(
      "quality.yml:dependency-review: GHSA-2g4f-4pwh-qvx6 lacks an active entry in scripts/ci/dependency-exceptions.json",
    );
    expect(
      problemsWith("quality.yml", [], Date.parse("2026-11-10T00:00:00Z")),
    ).toContain(
      "quality.yml:dependency-review: GHSA-vfj7-8cjw-p6xm lacks an active entry in scripts/ci/dependency-exceptions.json",
    );
  });

  it("rejects a backup workflow that could cancel a pending release", () => {
    const backup = read(".github/workflows/production-backup.yml");
    expect(backup).toContain("queue: max");
    expect(
      workflowPolicyProblems({
        workflows: {
          ...owned,
          "production-backup.yml": backup.replace("      queue: max\n", ""),
        },
        actions,
        exceptions,
        now: NOW,
      }),
    ).toContain(
      "production-backup.yml:backup: must share industrial-sas-production-release with cancel-in-progress false and queue max, or it can cancel a pending release",
    );
  });

  it("keeps the scheduled matrix, SAST languages and enforced runtime audit", () => {
    expect(
      problemsWith("workspace-matrix.yml", [
        ['WORKSPACE_FULL_MATRIX: "1"', 'WORKSPACE_FULL_MATRIX: "0"'],
      ]),
    ).toContain("workspace-matrix.yml: must run with WORKSPACE_FULL_MATRIX=1");
    expect(
      problemsWith("codeql.yml", [
        ["[javascript-typescript, actions]", "[javascript-typescript]"],
      ]),
    ).toContain("codeql.yml: analyze javascript-typescript and actions");
    expect(
      problemsWith("security-audit.yml", [
        [
          "run: node scripts/ci/audit-dependencies.mjs --scope=release",
          "run: node scripts/ci/audit-summary.mjs --dir=tools/release",
        ],
      ]),
    ).toContain(
      "security-audit.yml: must run node scripts/ci/audit-dependencies.mjs --scope=release",
    );
    expect(
      problemsWith("quality.yml", [
        [
          "        run: node scripts/ci/audit-dependencies.mjs --scope=app\n",
          "        run: echo skipped\n",
        ],
      ]),
    ).toContain(
      "quality.yml:validate: must run node scripts/ci/audit-dependencies.mjs --scope=app",
    );
    expect(
      problemsWith("quality.yml", [
        [
          '          PLAYWRIGHT_REQUIRE_BUILD: "1"\n',
          '          PLAYWRIGHT_REQUIRE_BUILD: "1"\n          PLAYWRIGHT_DIAGNOSTIC_RETRIES: "2"\n',
        ],
      ]),
    ).toContain("quality.yml: required browser runs keep zero retries");
  });
});

describe("pin and tool helpers", () => {
  it("resolves the peeled commit of an annotated tag", () => {
    const output = [
      "cee97f86b972a3ded3c58d04148362b193ddc518\trefs/tags/v4.38.3",
      "24c54180a607b1449ed407dd24f251e4e9147c8d\trefs/tags/v4.38.3^{}",
    ].join("\n");
    expect(tagCommit(output, "v4.38.3")).toBe(
      "24c54180a607b1449ed407dd24f251e4e9147c8d",
    );
    expect(
      tagCommit(
        "3d3c42e5aac5ba805825da76410c181273ba90b1\trefs/tags/v7.0.1",
        "v7.0.1",
      ),
    ).toBe("3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(tagCommit("", "v1.0.0")).toBeNull();
  });

  it("maps runner platforms to checksum-pinned actionlint archives", () => {
    expect(actionlintAsset("linux", "x64")).toEqual({
      name: "actionlint_1.7.12_linux_amd64.tar.gz",
      sha256:
        "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
      url: "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz",
    });
    expect(() => actionlintAsset("win32", "x64")).toThrow();
  });
});

describe("concurrency queue normalization", () => {
  const block = (lines: string[]) =>
    ["jobs:", "  a:", "    concurrency:", ...lines, "    steps: []"].join("\n");

  it("blanks only valid queue lines inside concurrency, preserving line numbers", () => {
    const text = block([
      "      group: lock",
      "      cancel-in-progress: false",
      "      queue: max",
    ]);
    const result = normalizeConcurrencyQueue("x.yml", text);
    expect(result.problems).toEqual([]);
    expect(result.text.split("\n")).toHaveLength(text.split("\n").length);
    expect(result.text).not.toContain("queue");
    expect(result.text).toContain("cancel-in-progress: false");
  });

  it("leaves invalid queue usage in place and reports it", () => {
    expect(
      normalizeConcurrencyQueue(
        "x.yml",
        block(["      group: lock", "      queue: unlimited"]),
      ).problems,
    ).toEqual(["x.yml:5: queue must be max or single"]);
    expect(
      normalizeConcurrencyQueue(
        "x.yml",
        block([
          "      group: lock",
          "      cancel-in-progress: true",
          "      queue: max",
        ]),
      ).problems,
    ).toEqual([
      "x.yml:6: queue max cannot be combined with cancel-in-progress true",
    ]);
    const outside = normalizeConcurrencyQueue(
      "x.yml",
      "jobs:\n  a:\n    queue: max\n",
    );
    expect(outside.problems).toEqual([
      "x.yml:3: queue is only valid inside a concurrency mapping",
    ]);
    expect(outside.text).toContain("queue: max");
  });
});

describe("dependency-review exception list", () => {
  it("allows only unexpired root-owned exact-chain exceptions", () => {
    expect(activeExceptionGhsas(exceptions, NOW)).toEqual([
      "GHSA-vfj7-8cjw-p6xm",
    ]);
    const expiry = Date.parse(exceptions.exceptions[0].expiresAt);
    expect(activeExceptionGhsas(exceptions, expiry)).toEqual([]);
    expect(activeExceptionGhsas({ exceptions: [{ ghsa: "x" }] }, NOW)).toEqual(
      [],
    );
  });
});

describe("informative full audit summary", () => {
  const vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 1,
    high: 1,
    critical: 0,
  };
  it("lists every advisory by severity with public identifiers only", () => {
    expect(
      auditSummary({
        advisories: {
          a: {
            github_advisory_id: "GHSA-2g4f-4pwh-qvx6",
            module_name: "ajv",
            severity: "moderate",
            findings: [{ version: "8.6.3", paths: [".>vercel>ajv"] }],
          },
          b: {
            github_advisory_id: "GHSA-vfj7-8cjw-p6xm",
            module_name: "braces",
            severity: "high",
            findings: [{ version: "3.0.3", paths: [".>x>braces"] }],
          },
        },
        metadata: { vulnerabilities },
      }),
    ).toEqual({
      counts: { critical: 0, high: 1, moderate: 1, low: 0, info: 0 },
      advisories: [
        {
          ghsa: "GHSA-vfj7-8cjw-p6xm",
          package: "braces",
          severity: "high",
          versions: ["3.0.3"],
        },
        {
          ghsa: "GHSA-2g4f-4pwh-qvx6",
          package: "ajv",
          severity: "moderate",
          versions: ["8.6.3"],
        },
      ],
    });
  });

  it("treats registry errors and malformed reports as outages", () => {
    for (const report of [
      null,
      { error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" } },
      { advisories: {} },
      { advisories: [], metadata: { vulnerabilities } },
      {
        advisories: { a: { severity: "severe" } },
        metadata: { vulnerabilities },
      },
    ])
      expect(() => auditSummary(report)).toThrow();
  });
});

describe("merged test report", () => {
  it("requires every shard blob exactly once", () => {
    expect(
      blobInventoryProblems(["blob-1-2.json", "blob-2-2.json"], 2),
    ).toEqual([]);
    expect(
      blobInventoryProblems(["blob-1-2.json", "blob-1-3.json"], 2),
    ).toEqual([
      "blob-1-3.json: unexpected report",
      "blob-2-2.json: shard report missing",
    ]);
  });

  it("rejects empty, failed or errored merged reports", () => {
    expect(
      junitProblems({ tests: 10, failures: 0, errors: 0, skipped: 1 }),
    ).toEqual([]);
    expect(
      junitProblems({ tests: 0, failures: 1, errors: 2, skipped: 0 }),
    ).toEqual([
      "merged JUnit report has no tests",
      "1 failed test(s) in the merged report",
      "2 errored test(s) in the merged report",
    ]);
  });

  it("reports combined coverage without thresholds", () => {
    const metric = { covered: 5, total: 10, pct: 50 };
    expect(
      coverageMarkdown({
        total: {
          lines: metric,
          statements: metric,
          functions: metric,
          branches: metric,
        },
      }),
    ).toContain("| lines | 50% | 5/10 |");
    expect(coverageMarkdown({})).toBe("Combined coverage summary unavailable.");
  });
});

describe("aggregate entrypoint", () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/ci/aggregate.mjs"], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
    });
  const needs = (review: string) =>
    JSON.stringify({
      validate: { result: "success" },
      build: { result: "success" },
      "dependency-review": { result: review },
    });
  const env = {
    REQUIRED_JOBS: "validate,build,dependency-review",
    PULL_REQUEST_ONLY: "dependency-review",
  };

  it("passes main with the intentional PR-only skip and fails otherwise", () => {
    expect(
      run({ ...env, EVENT_NAME: "push", NEEDS_JSON: needs("skipped") }).status,
    ).toBe(0);
    expect(
      run({ ...env, EVENT_NAME: "pull_request", NEEDS_JSON: needs("skipped") })
        .status,
    ).toBe(1);
    expect(
      run({ EVENT_NAME: "push", NEEDS_JSON: needs("skipped") }).status,
    ).toBe(1);
    expect(
      run({ ...env, EVENT_NAME: "push", NEEDS_JSON: "not json" }).status,
    ).toBe(1);
  });
});
