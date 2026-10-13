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
  typecheckScriptProblems,
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

/** Extract an actual named step so omission/duplication tests need no YAML copy. */
function namedStep(file: keyof typeof owned, name: string) {
  const text = owned[file];
  const heading = `      - name: ${name}\n`;
  const start = text.indexOf(heading);
  expect(start, `step missing: ${name}`).toBeGreaterThanOrEqual(0);
  const bodyStart = start + heading.length;
  const boundary = text.slice(bodyStart).search(/\n(?= {0,7}\S)/);
  return text.slice(start, boundary < 0 ? text.length : bodyStart + boundary);
}

function expectJobFailure(
  file: keyof typeof owned,
  job: string,
  edits: ReadonlyArray<readonly [string, string]>,
) {
  expect(
    problemsWith(file, edits).filter((problem) =>
      problem.startsWith(`${file}:${job}:`),
    ),
  ).not.toEqual([]);
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
  it.each([
    ["missing shard", "shard: [1, 2, 3]", "shard: [1, 2]"],
    ["duplicate shard", "shard: [1, 2, 3]", "shard: [1, 2, 2]"],
    [
      "fail-fast cancellation",
      "      fail-fast: false\n      matrix:\n        shard: [1, 2, 3]",
      "      fail-fast: true\n      matrix:\n        shard: [1, 2, 3]",
    ],
    [
      "mismatched total",
      "--shard=${{ matrix.shard }}/3",
      "--shard=${{ matrix.shard }}/2",
    ],
    [
      "filtered projects",
      "pnpm exec vitest run\n",
      "pnpm exec vitest run --project unit\n",
    ],
    ["missing JUnit reporter", "          --reporter=junit\n", ""],
    [
      "missing-report warning",
      "          if-no-files-found: error\n",
      "          if-no-files-found: warn\n",
    ],
    [
      "report upload skipped after failure",
      "        if: ${{ !cancelled() }}\n",
      "        if: ${{ success() }}\n",
    ],
    ["rerun artifact collision", "          overwrite: true\n", ""],
    [
      "unstable shard artifact",
      "name: vitest-junit-${{ matrix.shard }}",
      "name: vitest-junit-${{ matrix.shard }}-${{ github.run_attempt }}",
    ],
    [
      "wrong report path",
      "path: test-results/vitest-junit/shard-${{ matrix.shard }}-3.xml",
      "path: test-results/vitest-junit/shard-${{ matrix.shard }}-2.xml",
    ],
  ])("rejects %s in native test shards", (_reason, from, to) => {
    expectJobFailure("quality.yml", "test", [[from, to]]);
  });

  it("requires exactly one test run and one shard report upload", () => {
    for (const name of ["Vitest shard", "Upload shard JUnit"]) {
      const step = namedStep("quality.yml", name);
      for (const replacement of ["", `${step}\n${step}`])
        expectJobFailure("quality.yml", "test", [[step, replacement]]);
    }
  });

  it.each([
    [
      "omitted browser shard",
      "          - suite: workspace-2\n            shard: 2\n",
      "",
    ],
    [
      "duplicate browser shard",
      "          - suite: workspace-2\n            shard: 2\n",
      "          - suite: workspace-1\n            shard: 1\n",
    ],
    [
      "wrong shard total",
      "--shard=${{ matrix.shard }}/2",
      "--shard=${{ matrix.shard }}/3",
    ],
    [
      "shared shard report",
      "WORKSPACE_REPORT_NAME: ${{ matrix.suite }}",
      "WORKSPACE_REPORT_NAME: workspace",
    ],
    [
      "wrong report path",
      "path: test-results/${{ matrix.suite }}-junit.xml",
      "path: test-results/smoke-junit.xml",
    ],
    [
      "unrequired production build",
      'PLAYWRIGHT_REQUIRE_BUILD: "1"',
      'PLAYWRIGHT_REQUIRE_BUILD: "0"',
    ],
  ])("rejects %s in the browser matrix", (_reason, from, to) => {
    expectJobFailure("quality.yml", "browser", [[from, to]]);
  });

  it("requires both builds, clean-tree check and each browser suite", () => {
    for (const name of [
      "Production-mode build (credential-free)",
      "Navigation harness build (credential-free)",
      "Clean tree after build",
      "Install Playwright Chromium",
      "Navigation regressions (desktop engines and mobile Chromium)",
      "Anonymous smoke (desktop and mobile)",
      "Storage workspace (PR subset)",
      "Upload browser JUnit",
    ]) {
      const step = namedStep("quality.yml", name);
      for (const replacement of ["", `${step}\n${step}`])
        expectJobFailure("quality.yml", "browser", [[step, replacement]]);
    }
  });

  it("rejects skipped builds and browser suites or missing-report warnings", () => {
    for (const name of [
      "Production-mode build (credential-free)",
      "Navigation harness build (credential-free)",
      "Navigation regressions (desktop engines and mobile Chromium)",
      "Anonymous smoke (desktop and mobile)",
      "Storage workspace (PR subset)",
    ]) {
      const step = namedStep("quality.yml", name);
      const skipped = step.replace(/if: \$\{\{[^\n]+\}\}/, "if: ${{ false }}");
      expectJobFailure("quality.yml", "browser", [[step, skipped]]);
    }
    const upload = namedStep("quality.yml", "Upload browser JUnit");
    expectJobFailure("quality.yml", "browser", [
      [
        upload,
        upload.replace("if-no-files-found: error", "if-no-files-found: warn"),
      ],
    ]);
  });

  it("requires headless-only Chromium installation without omitting other engines", () => {
    for (const name of ["Install Playwright Chromium"]) {
      const step = namedStep("quality.yml", name);
      expectJobFailure("quality.yml", "browser", [
        [step, step.replace(" --only-shell", "")],
      ]);
      expectJobFailure("quality.yml", "browser", [
        [step, step.replace("--only-shell", "--no-shell")],
      ]);
    }
  });

  it("requires the navigation matrix leg and all three installed engines", () => {
    expectJobFailure("quality.yml", "browser", [
      ["          - suite: navigation\n            shard: 0\n", ""],
    ]);
    expectJobFailure("quality.yml", "browser", [
      [
        "node scripts/ci/prepare-browser-suite.mjs --suite=navigation",
        "node scripts/ci/prepare-browser-suite.mjs --suite=smoke",
      ],
    ]);
    const navigation = namedStep(
      "quality.yml",
      "Navigation regressions (desktop engines and mobile Chromium)",
    );
    expectJobFailure("quality.yml", "browser", [
      [
        navigation,
        navigation.replace(
          "test:e2e:navigation",
          "test:e2e:navigation --project=desktop-chromium",
        ),
      ],
    ]);
  });

  it("keeps informational coverage complete and separate from PR checks", () => {
    for (const [from, to] of [
      ["pnpm exec vitest run\n", "pnpm exec vitest run --project unit\n"],
      ["pnpm exec vitest run\n", "pnpm exec vitest run --shard=1/3\n"],
      ["          --coverage\n", ""],
      [
        "          if-no-files-found: error\n",
        "          if-no-files-found: warn\n",
      ],
      [
        "    name: Full-suite coverage\n",
        "    name: Full-suite coverage\n    needs: [matrix]\n",
      ],
    ] as const)
      expectJobFailure("workspace-matrix.yml", "coverage", [[from, to]]);
    for (const name of ["Vitest with coverage", "Upload coverage and JUnit"]) {
      const step = namedStep("workspace-matrix.yml", name);
      expectJobFailure("workspace-matrix.yml", "coverage", [[step, ""]]);
    }
    expect(owned["quality.yml"]).not.toContain("--coverage");
    expect(owned["quality.yml"]).not.toContain("  test-report:");
    expect(owned["quality.yml"]).not.toContain("  build:");
  });

  it("keeps the stable check complete and event-aware", () => {
    expect(
      problemsWith("quality.yml", [
        [
          "[validate, codegen, test, browser, dependency-review]",
          "[validate, codegen, test, browser]",
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
          "    name: Browser (${{ matrix.suite }})\n",
          "    name: Browser (${{ matrix.suite }})\n    if: ${{ github.event_name == 'push' }}\n",
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

  it("captures the staging flag only after successful CI", () => {
    const policy = namedStep("quality.yml", "Capture staging policy");
    const aggregate = namedStep(
      "quality.yml",
      "Require all quality jobs to pass",
    );
    for (const edits of [
      [[policy, ""]],
      [[policy, `${policy}\n${policy}`]],
      [[policy, policy.replace("id: release-policy", "id: other")]],
      [
        [
          policy,
          policy.replace(
            "STAGING_ENABLED: ${{ vars.STAGING_ENABLED }}",
            "STAGING_ENABLED: false",
          ),
        ],
      ],
      [
        [
          policy,
          policy.replace(
            "id: release-policy",
            "id: release-policy\n        if: ${{ always() }}",
          ),
        ],
      ],
      [[`${aggregate}\n${policy}`, `${policy}\n${aggregate}`]],
      [
        [
          "staging_enabled: ${{ steps.release-policy.outputs.staging_enabled }}",
          "staging_enabled: false",
        ],
      ],
    ] as const)
      expectJobFailure("quality.yml", "check", edits);
  });

  it("gates production on successful CI and captured staging policy for main only", () => {
    // On main, the PR-only dependency review is intentionally skipped. With
    // no status function GitHub adds an implicit success() over the whole
    // ancestor chain, so a green `check` would still skip both releases.
    // `!cancelled()` is the only accepted status function; the trusted
    // predicates then decide, and nothing may widen them.
    const guard = "if: ${{ !cancelled() && needs.check.result == 'success' && ";
    const stagingIf =
      "${{ !cancelled() && needs.check.result == 'success' && needs.check.outputs.staging_enabled == 'true' && github.repository == 'Rugby-Thailand/industrial-sas' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}";
    const releaseIf =
      "${{ !cancelled() && needs.check.result == 'success' && ((needs.check.outputs.staging_enabled == 'false' && needs.staging.result == 'skipped') || (needs.check.outputs.staging_enabled == 'true' && needs.staging.result == 'success' && needs.staging.outputs.outcome == 'STAGING_PASSED')) && github.repository == 'Rugby-Thailand/industrial-sas' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}";
    const stagingProblem = `quality.yml:staging: if must be exactly ${stagingIf}`;
    const releaseProblem = `quality.yml:release: if must be exactly ${releaseIf}`;
    const forJob = (problems: string[], job: string) =>
      problems.filter((problem) => problem.startsWith(`quality.yml:${job}:`));

    expect(owned["quality.yml"]).toContain(`    if: ${stagingIf}\n`);
    expect(owned["quality.yml"]).toContain(`    if: ${releaseIf}\n`);
    // Whitespace-only reformatting keeps the trusted expression.
    expect(
      forJob(
        problemsWith("quality.yml", [
          [
            guard,
            "if: ${{  !cancelled()  &&  needs.check.result == 'success' && ",
          ],
        ]),
        "staging",
      ),
    ).toEqual([]);

    // Missing guard: the skipped-ancestor bug this test exists for.
    expect(
      problemsWith("quality.yml", [
        [guard, "if: ${{ needs.check.result == 'success' && "],
      ]),
    ).toContain(stagingProblem);
    for (const status of ["always()", "success()", "failure()", "cancelled()"])
      expect(
        problemsWith("quality.yml", [
          [guard, `if: \${{ ${status} && needs.check.result == 'success' && `],
        ]),
      ).toContain(stagingProblem);
    for (const predicate of [
      " && github.repository == 'Rugby-Thailand/industrial-sas'",
      " && github.ref == 'refs/heads/main'",
      " || github.event_name == 'workflow_dispatch'",
    ])
      expect(problemsWith("quality.yml", [[predicate, ""]])).toContain(
        stagingProblem,
      );
    expect(
      problemsWith("quality.yml", [
        [
          "'workflow_dispatch') }}\n    runs-on: ubuntu-24.04\n    timeout-minutes: 60",
          "'workflow_dispatch') || true }}\n    runs-on: ubuntu-24.04\n    timeout-minutes: 60",
        ],
      ]),
    ).toContain(stagingProblem);

    for (const [from, to] of [
      [" && needs.staging.outputs.outcome == 'STAGING_PASSED'", ""],
      [" && needs.staging.result == 'success'", ""],
      [
        "needs.staging.result == 'skipped'",
        "needs.staging.result != 'failure'",
      ],
      ["needs.check.outputs.staging_enabled == 'false' && ", ""],
      [releaseIf, releaseIf.replace("!cancelled()", "always()")],
      [releaseIf, releaseIf.replace("!cancelled() && ", "")],
      [
        "'workflow_dispatch') }}\n    runs-on: ubuntu-24.04\n    timeout-minutes: 90",
        "'workflow_dispatch') || true }}\n    runs-on: ubuntu-24.04\n    timeout-minutes: 90",
      ],
    ] as const)
      expect(problemsWith("quality.yml", [[from, to]])).toContain(
        releaseProblem,
      );
    expect(
      problemsWith("quality.yml", [
        ["    needs: [check, staging]\n", "    needs: [check]\n"],
      ]),
    ).toContain("quality.yml:release: must need staging");
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
          '          CI_EXTERNAL_TYPECHECK: "1"\n',
          '          CI_EXTERNAL_TYPECHECK: "1"\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}\n',
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        "quality.yml:browser: secret VERCEL_TOKEN is not allowlisted",
        "quality.yml:browser: quality jobs must stay secret-free",
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
          '          ref: ${{ github.sha }}\n          persist-credentials: false\n      - uses: ./.github/actions/setup-node-pnpm\n        with:\n          cache: "false"\n      - name: Install release tools\n        run: pnpm -C tools/release install --frozen-lockfile\n      - name: Install Playwright Chromium\n        run: pnpm exec playwright install --with-deps --only-shell chromium\n      # Production',
          '          persist-credentials: false\n      - uses: ./.github/actions/setup-node-pnpm\n        with:\n          cache: "true"\n      - name: Install release tools\n        run: pnpm -C tools/release install --frozen-lockfile --ignore-workspace\n      - name: Install Playwright Chromium\n        run: pnpm exec playwright install --with-deps --only-shell chromium\n      # Production',
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
      problemsWith("quality.yml", [["          retention-days: 7\n", ""]]),
    ).toContain(
      "quality.yml:test: upload vitest-junit-${{ matrix.shard }} needs retention-days 1–30",
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

  it("installs the pinned Bun once in the shared setup action", () => {
    const action = actions["actions/setup-node-pnpm/action.yml"];
    const install = "      run: node scripts/ci/install-bun-checker.mjs";
    const frozen = "      run: pnpm install --frozen-lockfile";
    expect(action).toContain(install);
    const withAction = (text: string) =>
      workflowPolicyProblems({
        workflows: owned,
        actions: { "actions/setup-node-pnpm/action.yml": text },
        exceptions,
        now: NOW,
      });
    const rule =
      "actions/setup-node-pnpm/action.yml: must run node scripts/ci/install-bun-checker.mjs once, after pnpm install --frozen-lockfile";
    expect(withAction(action)).toEqual([]);
    expect(
      withAction(action.replace(install, "      run: echo skip")),
    ).toContain(rule);
    // Before the frozen install: swap the two commands.
    expect(
      withAction(
        action
          .replace(frozen, "      run: __FROZEN__")
          .replace(install, frozen)
          .replace("      run: __FROZEN__", install),
      ),
    ).toContain(rule);
    expect(
      withAction(
        action.replace(
          install,
          `${install}\n    - name: Again\n      shell: bash\n${install}`,
        ),
      ),
    ).toContain(rule);
  });

  it("joins smoke and navigation preparation before clean-tree and test execution", () => {
    const clean = namedStep("quality.yml", "Clean tree after build");
    expectJobFailure("quality.yml", "browser", [
      [
        clean,
        clean.replace("steps.smoke-preparation.outcome", "steps.setup.outcome"),
      ],
    ]);
    for (const [preparation, testTitle, owner] of [
      [
        "Production-mode build (credential-free)",
        "Anonymous smoke (desktop and mobile)",
        "smoke-preparation",
      ],
      [
        "Navigation harness build (credential-free)",
        "Navigation regressions (desktop engines and mobile Chromium)",
        "navigation-preparation",
      ],
    ]) {
      const prep = namedStep("quality.yml", preparation!);
      const test = namedStep("quality.yml", testTitle!);
      expectJobFailure("quality.yml", "browser", [
        [test, test.replace(`steps.${owner}.outcome`, "steps.setup.outcome")],
      ]);
      expectJobFailure("quality.yml", "browser", [
        [
          prep,
          prep.replace("        run:", "        shell: echo {0}\n        run:"),
        ],
      ]);
    }
  });

  it("requires browser installation before both release targets", () => {
    for (const target of ["staging", "production"] as const) {
      const title =
        target === "staging"
          ? "Deploy and verify staging"
          : "Release production";
      const runner = namedStep("quality.yml", title);
      const install =
        "      - name: Install Playwright Chromium\n        run: pnpm exec playwright install --with-deps --only-shell chromium\n";
      const runnerAt = owned["quality.yml"].indexOf(runner);
      const installAt = owned["quality.yml"].lastIndexOf(install, runnerAt);
      const block = owned["quality.yml"].slice(
        installAt,
        runnerAt + runner.length,
      );
      for (const replacement of [
        block.replace(install, ""),
        `${install}${block}`,
        block.replace(" --only-shell", ""),
        `${block.replace(install, "")}\n${install}`,
        block.replace(
          "        run: pnpm exec playwright",
          "        if: ${{ always() }}\n        run: pnpm exec playwright",
        ),
        block.replace(
          runner,
          runner.replace(
            "        id: release",
            "        id: release\n        if: ${{ always() }}",
          ),
        ),
      ])
        expectJobFailure(
          "quality.yml",
          target === "staging" ? "staging" : "release",
          [[block, replacement]],
        );
    }
  });

  it("requires the exact TS6 gate before allowing the external smoke typecheck", () => {
    const ts6 = namedStep(
      "quality.yml",
      "TypeScript 6 gate (cold generated route types)",
    );
    for (const replacement of [
      "",
      `${ts6}\n${ts6}`,
      ts6.replace("matrix.lane == 'types'", "matrix.lane == 'style'"),
      ts6.replace("!cancelled()", "false"),
    ])
      expect(problemsWith("quality.yml", [[ts6, replacement]])).toContain(
        "quality.yml:validate: pnpm typecheck:ts6 must run exactly once in types",
      );
    for (const override of [
      "        shell: echo {0}\n",
      "        working-directory: /tmp\n",
      "        env:\n          NODE_OPTIONS: --version\n",
    ])
      expect(
        problemsWith("quality.yml", [[ts6, `${ts6}\n${override.trimEnd()}`]]),
      ).toContain(
        "quality.yml:validate: pnpm typecheck:ts6 must run exactly once in types",
      );
    for (const [from, to] of [
      [
        "permissions:\n  contents: read",
        "defaults:\n  run:\n    shell: echo {0}\npermissions:\n  contents: read",
      ],
      [
        "    name: Validate (${{ matrix.lane }})",
        "    name: Validate (${{ matrix.lane }})\n    defaults:\n      run:\n        shell: echo {0}",
      ],
    ])
      expect(problemsWith("quality.yml", [[from!, to!]])).toContain(
        "quality.yml:validate: required check execution must not override default shell or directory",
      );
    const smoke = namedStep(
      "quality.yml",
      "Production-mode build (credential-free)",
    );
    expectJobFailure("quality.yml", "browser", [
      [
        smoke,
        smoke.replace(
          'CI_EXTERNAL_TYPECHECK: "1"',
          'CI_EXTERNAL_TYPECHECK: "0"',
        ),
      ],
    ]);
    expectJobFailure("quality.yml", "browser", [
      [
        smoke,
        smoke.replace(
          '        env:\n          CI_EXTERNAL_TYPECHECK: "1"\n',
          "",
        ),
      ],
    ]);
    const manifest = JSON.parse(read("package.json"));
    expect(typecheckScriptProblems(manifest)).toEqual([]);
    for (const script of [
      "echo passed",
      "bun --check",
      "tsc --noEmit",
      "next typegen && tsc --noEmit || true",
    ])
      expect(
        typecheckScriptProblems({
          ...manifest,
          scripts: { ...manifest.scripts, "typecheck:ts6": script },
        }),
      ).toContain(
        "package.json: typecheck:ts6 must generate route types and run tsc --noEmit",
      );
    expect(
      typecheckScriptProblems({
        ...manifest,
        devDependencies: { ...manifest.devDependencies, typescript: "^6.0.3" },
      }),
    ).toContain(
      "package.json: external typecheck requires pinned TypeScript 6",
    );
  });

  it("fails closed when validation lanes are missing, duplicated or skipped", () => {
    for (const lanes of ["[style, types, lint]", "[style, types, lint, lint]"])
      expect(
        problemsWith("quality.yml", [
          ["lane: [style, types, lint, audit]", `lane: ${lanes}`],
        ]),
      ).toContain(
        "quality.yml:validate: exact complete validation lanes required",
      );
    const lint = namedStep("quality.yml", "Lint");
    for (const replacement of [
      "",
      `${lint}\n${lint}`,
      lint.replace("matrix.lane == 'lint'", "matrix.lane == 'style'"),
    ])
      expect(problemsWith("quality.yml", [[lint, replacement]])).toContain(
        "quality.yml:validate: pnpm lint must run exactly once in lint",
      );
    const clean = namedStep("quality.yml", "Clean tree after generators");
    expect(
      problemsWith("quality.yml", [
        [clean, clean.replace("steps.setup.outcome == 'success'", "false")],
      ]),
    ).toContain(
      "quality.yml:validate: clean tree must join each lane after all checks",
    );
  });

  it("keeps the validate job on the shared Bun without a second install", () => {
    const typecheck = namedStep(
      "quality.yml",
      "Typecheck (cold next typegen + Bun checker)",
    );
    expect(owned["quality.yml"]).not.toContain(
      "run: node scripts/ci/install-bun-checker.mjs",
    );
    expect(
      problemsWith("quality.yml", [
        [
          `${typecheck}\n`,
          `      - name: Install pinned Bun checker\n        run: node scripts/ci/install-bun-checker.mjs\n${typecheck}\n`,
        ],
      ]),
    ).toContain(
      "quality.yml:validate: node scripts/ci/install-bun-checker.mjs runs in the shared setup action, not again here",
    );
    expect(problemsWith("quality.yml", [[`${typecheck}\n`, ""]])).toContain(
      "quality.yml:validate: must run pnpm typecheck",
    );
    expect(
      problemsWith("quality.yml", [
        [
          `${typecheck}\n`,
          `${typecheck}\n      - uses: oven-sh/setup-bun@0000000000000000000000000000000000000000 # v2.0.0\n`,
        ],
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "oven-sh/setup-bun is outside the selected-actions allowlist",
        ),
      ]),
    );
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
