# Quality feasibility prerequisite check

This file records successive experiments. The final selection uses four validation lanes, standard free runners and two browser workers; temporary probes are removed. The [implementation plan](../../plans/ci-cd-speed-plan-2026-10-13.md) defines the final scope.

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

## Exact TS6 gate and free-runner comparison revision

The later prototype separates validation into four lanes: style, types, lint and audit. Types executes both the original Bun checker and `pnpm typecheck:ts6`; the latter remains exactly `next typegen && tsc --noEmit` against a pinned TypeScript 6 package. The validation CLI checks that package alias and compiler pin, and mutation tests reject missing/duplicate/incorrectly conditioned TS6 runs, a no-op alias, missing typegen, Bun substitution, failure suppression and an unpinned compiler. Clean-tree remains the last command in every lane. Actual local `pnpm typecheck:ts6` passed; no Linux duration is inferred from that run.

Anonymous application smoke build now sets the exact `CI_EXTERNAL_TYPECHECK=1` input to the separately guarded Next configuration helper. Its independent types lane still gates aggregate quality, so the repeated in-build compiler can be removed without dropping TS6 coverage. Navigation keeps its own in-build typecheck. Production gate attestation and environment enforcement are separate parent/B-owned changes; this document does not certify them from the smoke workflow alone.

The first hosted container probe (`38353981184`) failed because the official image has no `unzip`, which the pinned integrity-checked Bun installer requires. The probe now explicitly installs `unzip` before unchanged setup. Its apt overhead is charged to preparation. Measured initialization/container acquisition was 39 s for navigation and 37/27 s for the two smoke legs, already exceeding the original 15 s assumption. Therefore the updated three-job probe retains only navigation in the container; smoke now compares 2 versus 4 workers on ordinary free Ubuntu runners with identical caches, guarded external-typecheck builds, Chromium shell installation and every test. Neither experiment gates or deploys production; required quality remains independent.

After these revisions: 83 focused workflow/discovery/guard assertions pass, pinned actionlint 1.7.12 accepts seven workflows, source policy and scoped ESLint pass, and diff checks pass. The actual hosted worker/container and complete release timings remain necessary before accepting the user's 180–240 second push-to-live objective.

## First complete hosted quality result and expanded worker pilot

Parent-reported hosted PR run `38354107441` passed every required quality job, aggregate gate at 141 s. Longest underlying job was workspace shard 1 at 126 s (test body 80 s), followed by navigation 122 s; workspace shard 2 was 115 s (tests 71 s), and smoke 115 s (warm-cache build 13 s, tests 44 s). This is one successful pilot, not a percentile guarantee. It changes the next priority from cold installation alone to workspace worker throughput.

The probe now adds exactly two ordinary-runner workspace jobs at 2/4 workers, each running identical shard 1 of 2 with the same desktop/mobile/locale ownership, fixture servers, shell installation and isolated unique JUnit artifact. Required quality still runs both workspace shards; selecting shard 1 for a paired throughput experiment removes no required coverage. No production worker setting is changed until this paired hosted result passes and timing improves.

The separate prebuilt deployment alternative proved portable Linux output but its 131 s job/92 s build did not justify environment/credential redesign for the relaxed target. Parent removed that experiment workflow/helpers; their dedicated policy fixtures were removed only after its workflow was absent. Remaining quality, worker/container probes and release policy remain enforced. The new complete state passes 83 focused assertions and pinned actionlint on six workflows. Source-scoped ESLint and diff checks pass. Probe concurrency increased by two while the separate prebuilt job disappeared; record any hosted queue delay separately.

## Final pilot decisions and release integration

Hosted probe `38355028866` did not support increasing worker counts: workspace test body was 73 s at 2 workers versus 71 s at 4; smoke was 33 s at 2 versus 39 s at 4. Installation/setup varied substantially (17–42 s), so a single job-total comparison would be misleading. Keep the existing 2 workers. Navigation container acquisition was 27 s, unzip preparation 4 s and harness build 17 s, followed by an ownership failure rather than a verified complete browser run. Reject that container proposal; it proved neither complete coverage nor a useful target improvement. The temporary probe workflow, image assertion helper, and their dedicated policy/tests were removed after recording the evidence. Ordinary required browser jobs remain.

The actual required quality run `38355035310` exposed an isolated cache-test fixture that mocked workflow-lib without its new typecheckScriptProblems export/package manifest. The fixture now supplies both inputs while preserving the real checksum/cache/extraction execution under test. Formatting was also corrected in prebuilt-spike.md.

Required TS6 execution now rejects custom per-step shell, working-directory and environment overrides, as well as workflow/job run defaults; these could otherwise make a literal required command report success without executing the intended compiler. Mutation tests cover those bypasses, in addition to the existing exact command/lane/manifest checks.

The attempted release-controller overlap was rejected after review showed that browser installation could fail after a Convex mutation. The final release path therefore restores one exact shell-only Chromium installation before each staging/production controller runs. Policy rejects missing, duplicate, skipped, reordered or non-shell installs and rejects a controller condition that would run after installation failure. No credentials, release conditions, environment locks, backup or staging decision were changed by this quality edit.

The earlier, subsequently rejected release-overlap prototype passed 100 focused assertions in 3.05 s; that result does not validate the final selected architecture. For the final credential-free quality overlap and restored pre-controller installs, 86 assertions across workflow policy, actionlint cache integrity, discovery and aggregate guards pass in 3.08 s. The helper owner separately reports six real subprocess fixtures passing. Pinned actionlint 1.7.12 and source policy accept five workflows; source-scoped ESLint and diff checks pass. Full hosted quality and eventual live release measurement remain the parent's final gate.

## Final safe overlap selection

Overlap is limited to credential-free quality preparation. Smoke and navigation each invoke the reviewed prepare-browser-suite helper, which starts their exact build and browser installation, owns both child processes and joins their outcomes. Smoke retains desktop/mobile Chromium; navigation retains Chromium desktop/mobile, Firefox and WebKit. Workspace installation and both shards are unchanged. The helper does not contact providers or perform application mutations. Clean-tree and the corresponding browser tests require successful joined preparation; any failed child fails the job. The aggregate still waits for the independent mandatory Bun and TS6 validation lane. Production waits for that completed aggregate before using its typecheck contract.

The only projected savings from overlapping two measured independent operations is at most the smaller operation's duration, before CPU contention: roughly a 13–16 s build on a warm quality run. This is a hypothesis pending the hosted helper result, not evidence for a 180–240 s complete release. Release preparation remains sequential before any controller/provider mutation. Temporary container and four-worker experiments remain rejected.
