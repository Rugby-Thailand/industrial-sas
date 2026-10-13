# Quality feasibility prerequisite check

Read-only account checks against the clean integration checkout based on c425dd80, 2026-10-13:

```sh
gh api repos/Rugby-Thailand/industrial-sas --jq '{owner:.owner.login,ownerType:.owner.type,private:.private}'
gh api orgs/Rugby-Thailand/actions/hosted-runners
gh api repos/Rugby-Thailand/industrial-sas/actions/runners
gh api orgs/Rugby-Thailand --jq '{plan:.plan.name}'
```

Results: repository belongs to organization Rugby-Thailand and is public. The organization plan is `free`. The hosted-runners endpoint returned HTTP 404 with the explicit response `GitHub hosted runners are not supported for this organization`. Repository self-hosted runner inventory returned `total_count: 0`.

The under-two-minute design's proposed managed custom 8-core image or prewarmed self-hosted pool is not currently available. Provisioning/upgrading would require a separate explicit user decision; no changes were made. Existing timing evidence therefore cannot certify the quality gate under 75 seconds. Navigation currently spends approximately 80 seconds installing browsers, before build and tests. A standard cold-runner shell-only optimization may reduce that operation, but no result proves the target.

The current remote navigation discovery guard includes all five browser configurations. Navigation still requires desktop/mobile Chromium, desktop Firefox and desktop WebKit. No channel, headless=false, or executablePath overrides were found in current Playwright configs/support; shell-only installation can preserve the existing Chromium headless runtime. Keep all browser engines and test ownership if piloting it. At that prerequisite checkpoint no workflow, source or configuration changes had been made.

## Scoped shell-only prototype

In the clean worktree only, the two quality browser installation commands now request `--only-shell`. The navigation command retains Chromium, Firefox and WebKit. Exact policy strings in `scripts/ci/workflow-lib.mjs` match the change; regression mutation tests reject removal of shell-only mode, switching to no-shell, and omission of browser engines. Release installation and setup actions are unchanged.

Verification: three focused integration files (`ci-workflows`, `ci-test-discovery`, `ci-guards`) passed all 79 assertions in 3.51 s; scoped ESLint passed; source policy validation and pinned actionlint 1.7.12 passed. The current installed Vitest reports v4.1.11. Dry-run installation on native macOS and simulated `ubuntu24.04-x64` both retain headless shell revision 1234, FFmpeg 1011, Firefox 1538 and WebKit 2336 while omitting the ordinary full-Chrome artifact. The Linux dry run verifies artifact selection, not apt installation or actual Linux browser execution.

Exact commands:

```sh
pnpm exec playwright install --with-deps --only-shell chromium firefox webkit --dry-run
pnpm exec playwright install --with-deps chromium firefox webkit --dry-run
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm exec playwright install --with-deps --only-shell chromium firefox webkit --dry-run
pnpm exec vitest run tests/integration/ci-workflows.integration.test.ts tests/integration/ci-test-discovery.integration.test.ts tests/integration/ci-guards.integration.test.ts --maxWorkers=2
pnpm exec eslint scripts/ci/workflow-lib.mjs tests/integration/ci-workflows.integration.test.ts --max-warnings=0
node scripts/ci/validate-workflows.mjs --skip-actionlint
node scripts/ci/validate-workflows.mjs
```

Component verdict: selected existing headless Chromium binary is preserved and its unused full-Chrome download is omitted. No download duration or under-two-minute live-release claim follows from this dry run. A Linux CI pilot and runner architecture decision remain necessary. No branch push, merge, paid provisioning or variable changes were performed by this audit.

## Updated free-runner evidence and next pilot

Read-only latest successful run `38350247746` at c425dd80 gives navigation job 129 s: checkout 7 s, shared setup 14 s, harness build 16 s, engine installation 59 s, tests 30 s and remaining reporting/job overhead. Browser installation logs show apt starting 05:13:35.326 UTC, final system-package triggers around 05:14:15, then browser downloads ending 05:14:32.905. Full Chrome download/extraction is 05:14:15.755–05:14:20.736, approximately five seconds. Shell-only is a valid component optimization but does not remove approximately 40 seconds of apt overhead.

Same run smoke job takes 155 s: checkout 11, setup 19, Next cache restore 6, build 48, browser install 24 and tests 39 s. Even removing browser installation entirely does not approach a 75 s full-job target. Validate takes 76 s, including formatting 17, lint 26, discovery 5, typechecking 3 and shared setup/checkout 19 s; independent check concurrency is a plausible roughly 50 s lane hypothesis, subject to actual CPU contention. No repeat expensive local tests were used for these results.

Next coherent hosted pilot on existing free runners: compare current navigation with a separate digest-pinned official Playwright job container, retaining all four projects, same source/lock and 2 workers. The image supplies browser engines and apt libraries; keep frozen application install and pinned Node/Bun verification, omit browser downloads only after exact revisions match. Charge pull/extraction as job preparation; require less than 15 s for useful target feasibility. Use a benchmark branch/PR with separate named reports, zero retries and unchanged discovery inventory; parent owns execution authorization. Then benchmark smoke workers 2 versus 4 using the same runner and build before drawing a new full-quality conclusion. Engine-specific navigation legs are a later experiment if execution, rather than preparation, remains dominant; retain each project's exact test union.

The official `mcr.microsoft.com/playwright:v1.62.1-noble` exists. Read-only registry lookup returned index digest `sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e` and Linux amd64 manifest `sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac`. The amd64 layers total **905.4 MiB compressed**, so this is emphatically not a guaranteed faster startup. Full Chromium-only smoke may be better served by an independently built smaller trusted image, but building/publishing such an image adds infrastructure scope and has not been authorized or measured. [Official Playwright container contents and version matching](https://playwright.dev/docs/docker).

Native-step parallelism remains unsupported by pinned actionlint. A tested Node coordinator could start independent validation commands, label/capture each result, wait for all, and fail closed; clean-tree must execute after typegen completes. It must not overlap generated-file writers/readers or suppress workflow policy. This is a proposed next change, not implemented in the shell-only prototype.

## Free-runner prototype ready for hosted measurement

The user now accepts 3–4 minutes when two minutes is impractical and requests free runners. No paid infrastructure is proposed for this pilot. Validation is split into three independent matrix lanes: formatting; typegen/Bun typechecking then lint; and workflow pins, all dependency audits and discovery. Every original command and named step remains; exact matrix membership, per-command lane ownership, one clean-tree check at the end of each lane, and aggregate failure behavior are enforced by policy and mutation tests. Generated files remain isolated to each runner, so lint still follows typegen in its own lane.

Branch-only ci-speed-probe.yml compares navigation at 2 workers and smoke at 2/4 workers on the exact official image. All tests and engines run; no release depends on this probe, and it receives no environment credentials. Container acquisition overhead belongs in full job timing. These three probe jobs plus three validate lanes, three Vitest shards, four browser legs, codegen, gate/dependency review and CodeQL use roughly 18 concurrent slots when overlapping (event-dependent); the parent's additional prebuilt probe may approach 20. Queue delay must be reported, not attributed solely to test speed.

Local sequential versus lane experiment was inconclusive: sequential 121.739 s, lanes 98.146 s, but lint failed after approximately 94 s in both and discovery failed on concurrently added untracked tests. This checkout also contains generated .vercel output from the separate prebuilt spike; ESLint does not ignore that directory. Source changed during measurement. Those observations neither prove a stable speedup nor establish a CI failure; do not use them as acceptance evidence. Use a committed hosted pilot for correctness and timing. No full suite timing rerun was made.
