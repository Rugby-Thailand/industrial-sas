# Quality architecture for a sub-two-minute release — plan only

The quality gate must finish in roughly 70–80 seconds from push, leaving about 40 seconds for the release critical path. The credible first experiment is preinstalled immutable ephemeral runner images with additional CPU, followed by selective sharding. Changing shard counts on ordinary cold runners alone does not address the largest observed delay. This is an engineering target, not an achieved result or promise. Disabling staging is a proposed release-policy change owned by the main plan; nothing was disabled here.

## Evidence and target budget

This analysis uses the parent’s measured live-run timings: navigation 189 s (browser install 80, build 16, tests 44, setup approximately 35); smoke 147 s (build 42, install 25, tests 38); slowest Vitest shard at most 108 s. Step subtotals omit runner waiting, checkout, upload and other overhead and must not be treated as exact job-duration decompositions. Browser installation is navigation’s largest removable on-path operation. Simply overlapping its 80 s installation with its 16 s build saves at most 16 s, leaving the job far beyond the goal.

Source was inspected read-only using `git show origin/main:...`; the remote-tracking ref at this inspection was `c425dd80f70feae6c2a4a75e03e8831daa42b4dc`. It contains smoke, navigation, workspace-1 and workspace-2 browser legs, three Vitest shards, Node/pnpm/Bun setup, and a separate Next navigation harness build. Local dirty-suite timings are not used to predict Linux performance. Earlier local tests and guard results remain in tests.md; no expensive tests were rerun for this architecture plan.

These are proposed elapsed budgets, all unproven on the proposed runner:

| Lane                 | Ready/setup including checkout | Build                           | Execute | Reports/finish | Lane target |
| -------------------- | ------------------------------ | ------------------------------- | ------- | -------------- | ----------- |
| Navigation           | 15 s                           | 16 s                            | 35 s    | 5 s            | 71 s        |
| Application smoke    | 15 s                           | 25 s                            | 25 s    | 5 s            | 70 s        |
| Each workspace shard | 15 s                           | Vite startup counted in execute | 40 s    | 5 s            | 60 s        |
| Each Vitest shard    | 15 s                           | None                            | 45 s    | 5 s            | 65 s        |
| Validate and codegen | 15 s                           | Existing independent checks     | 45 s    | 5 s            | 65 s        |

Allocate a further 5 s for the aggregate gate. The initial navigation sketch therefore totals 76 s including the gate and still misses the main plan's 75 s requirement by 1 s; every lane must ultimately fit within 70 s. Queue/startup is charged inside readiness; if a managed pool cannot meet it, the target fails even when test execution is fast. Validate/codegen budgets must be measured too: optimizing browsers cannot beat an independent slower gate. Preserve all these jobs and checks initially.

## Runner architecture

Preferred pilot: an 8-core Linux runner with an immutable image containing exact Node, pnpm, Bun, the Linux browser libraries, and the locked Playwright Chromium headless shell, Firefox and WebKit. Publish the image outside the push-to-live path. Include an image manifest containing tool versions, browser revisions, OS version and dependency lock hash. Run one job per disposable instance; do not retain mutable project workspaces or release credentials across jobs. Start every quality job in parallel with enough pool capacity; hardware sharing that makes every shard slower defeats the design.

GitHub larger runners support custom images and preinstalled software; management requires an organization on Team or Enterprise Cloud. Availability for this repository/account is unverified. This is a real prerequisite and might require an account migration. [GitHub larger runners](https://docs.github.com/en/actions/concepts/runners/larger-runners), [management prerequisites](https://docs.github.com/en/actions/how-tos/manage-runners/larger-runners/manage-larger-runners).

Bake a reviewed pnpm store or a lock-specific dependency seed into the image; still execute `pnpm install --frozen-lockfile` against the checked-out commit. If the hash changes, build a new dependency image asynchronously or use the ordinary installation path and report that run as an SLA miss. Do not claim dependency updates will meet the warm-image budget automatically. Fast tool verification replaces repeated archive downloads, without dropping checksum/version checks. Image generation must use trusted source and must not allow a fork PR to poison a shared image. Release runners stay separate from quality runners and retain their existing trust rules.

Alternative: a prewarmed self-hosted ephemeral VM pool with one-job runners, clean snapshots and forwarded logs. This can offer controlled ready capacity but adds provisioning, patching, disposal, monitoring and idle-capacity costs. GitHub recommends ephemeral runners for autoscaling and requires keeping runner software current. A long-lived shared host is not equivalent to a disposable prewarmed instance. [Official self-hosted runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

A job container on an ordinary GitHub runner is a lower-administration experiment, not automatically a warm runner. The job still needs a runner and must acquire/extract the image; large browser/dependency layers may recreate the delay. Pin its digest and measure pull/start separately, including a cold pull. Use it only if total ready time stays under 15 s. Running multiple container jobs does not remove per-job acquisition overhead. [GitHub container jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container).

## Execution and sharding

Navigation: retain desktop/mobile Chromium, Firefox and WebKit. First test all four projects on the 8-core image with four workers versus the existing two. If execution remains above 35 s, split project ownership into Chromium desktop/mobile, Firefox and WebKit jobs; each owns an independent harness build and unique report. Duplicating a 16 s harness build across three warm jobs may improve wall time but increases runner usage. An artifact-build fan-out adds a scheduling/upload/download barrier; benchmark before adopting it. Exact test ID/project unions must match the unsplit run, with no missing or duplicate ownership.

Smoke: keep the application production-mode build, both desktop/mobile projects and every test. Benchmark four workers on 8 cores; targeting build 25 s and test 25 s requires actual observed improvement, not linear core-count arithmetic. Do not reuse a credential-free smoke build as the production deployment artifact: environment inputs and release provenance differ.

Workspace: retain both existing test-level shards initially. Each starts three Vite servers; additional shards repeat that overhead. Evaluate workers 2/4 before adding a third shard. The config already uses fullyParallel, permitting individual tests to be distributed across shards; runtime balance still requires real duration data. [Playwright sharding](https://playwright.dev/docs/test-sharding).

Vitest: retain three native shards and every project; trial workers 2/4/6 on 8 cores, recording memory and per-file latency. If the 45 s execution budget fails, try four shards on the same warm image. Keep process isolation and jsdom/Node/edge-runtime semantics. Node-only pure-test partitioning and separate scheduled coverage already exist, so they are not new savings. The prior 72-assertion local guard comparison showed only 53 ms variation and supports no performance claim. [Vitest performance guidance](https://vitest.dev/guide/improving-performance).

Run independent validation commands concurrently only with preserved exit statuses and clear logs. Do not overlap generators with lint/typecheck/build readers unless generated-file ownership proves no race. Native GitHub background/wait syntax needs validator compatibility work: the parent's pinned actionlint 1.7.12 probe rejected it. Preinstalled browsers make browser-install overlap largely irrelevant in the warm-image target; use the established safe orchestration for a cold fallback.

## Cost and experiment decision

Compare three candidates on one fixed remote commit: ordinary runner plus headless-only installation; 8-core managed custom image; 8-core prewarmed ephemeral pool. Add a container-image candidate only when pull measurements justify it. No prices or account eligibility were verified here. Use actual billing rates and charge image builds, startup, rounded billable duration, logs/storage and idle pool capacity. Larger GitHub runners are billed even for public repositories. [GitHub billing distinction](https://docs.github.com/en/actions/concepts/runners/larger-runners).

Keep correctness identical across candidates: complete test inventory/project coverage, zero retries, no extra skips, guarded report ownership, workflow mutation tests, discovery, codegen freshness, security checks and credential separation. Cold-image and changed-lockfile runs belong in the results rather than being discarded.

Pilot five comparable pushes per candidate and report median/range plus runner-seconds and cost. Reject a candidate whose quality critical path exceeds 80 s, whose ready time exceeds 15 s, or whose coverage differs. Once viable, collect at least 20 runs including cold start and ordinary source/dependency changes before reporting p95. For acceptance, require quality p95 at most 75 s and the complete push-to-verified-live p95 below 120 s using timestamps from the same runs. A quality pass alone cannot certify the release objective. If release needs more than the remaining 40 s, the separate release architecture must change; tests must not be silently postponed or removed to make the chart green.
