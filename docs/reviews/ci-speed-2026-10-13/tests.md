# Test architecture and local timing evidence — 2026-10-13

This is a plan, not an implementation. No production, workflow, test configuration, or release files were changed. Local HEAD is `733c6acad348f1c024ef033f9d6ae8300e45e363`; working files contain substantial unrelated changes. Origin/main has newer CI architecture. All timings below are local macOS/Apple Silicon observations, not GitHub Linux benchmarks. An unrelated Vitest process was active during the full-suite experiment, so performance comparisons would be confounded.

## Existing coverage and ownership

Local configuration collects 267 Vitest files: unit/jsdom 126, unit-node 54, integration 71, isolation 8, accessibility 5, property 2, edge-runtime 1. The local browser matrix has smoke and workspace; smoke lists 88 test instances in five files, workspace 44 in four. Origin/main adds a navigation leg and splits workspace into two shards: four browser jobs total, not four shards of the same suite. Navigation has desktop/mobile Chromium, desktop Firefox and desktop WebKit. Preserve all engines.

Vitest already separates pure Node tests from jsdom and runs every project over three native shards without coverage instrumentation. Scheduled coverage is separate. There is no duplicate full-suite PR coverage run to delete. Local smoke alone owns the credential-free Next production build; workspace uses Vite and must not wait for or consume that build. Remote navigation owns a separate Next harness build. Application smoke, navigation harness, staging and production prove different behavior; builds have different directories or environment inputs, so treating them as interchangeable artifacts is unsupported.

## Completed safe checks

| Experiment                                                     | Result                                                                             | Wall time                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ |
| `pnpm test:navigation`                                         | 64/64 Node fixtures pass                                                           | 1.349 s                  |
| `pnpm ci:test-discovery`                                       | Expected failure: collected tests are untracked in this dirty workspace            | 3.992 s                  |
| Full dirty Vitest suite, `--maxWorkers=2`                      | 3,173 tests: 3,167 pass, six fail; exit 1                                          | 127.823 s                |
| Stable CI workflow/discovery/guards subset, workers 2          | 72/72 pass                                                                         | 3.039 s                  |
| Same subset, workers 4                                         | 72/72 pass                                                                         | 2.986 s                  |
| Playwright smoke/workspace `--list --reporter=json`            | 88 / 44 instances; no browsers or web servers started                              | Count only               |
| Chromium installation `--dry-run`, with/without `--only-shell` | Ordinary install lists full Chrome, shell and FFmpeg; shell-only omits full Chrome | No download/timing claim |

Discovery runs Vitest list plus each configured Playwright list serially. Its four-second local cost is small and buys actual coverage: tracked supported extensions, duplicate Vitest ownership, cross-runner overlap, normalization, untracked files, and union of browser configs. Keep this guard. `tests/integration/ci-test-discovery.integration.test.ts` tests the executable with fake runners. The local guard does not list the newer remote navigation configuration; use origin/main's guard when implementing, never transplant stale local code.

`tests/integration/ci-workflows.integration.test.ts` mutation tests explicitly enforce shard counts, matrix membership, artifacts, required builds, zero retries and coverage placement. Any approved matrix or installation change must update `scripts/ci/validate-workflows.mjs`, relevant fixture expectations and actual workflow together, then prove missing/duplicate shards and skipped suites still fail. Do not relax validators just to make proposed YAML pass.

## Prioritized experiments for implementation later

1. Use `pnpm exec playwright install --with-deps --only-shell chromium` for Chromium-only headless legs. Local search found no channel, headed or custom executable overrides in Playwright configs/support. The pinned CLI dry run confirms supported syntax and omitted full Chrome payload. Inspect current remote configuration before applying; navigation still needs Firefox and WebKit (install separately and retain Chromium shell). Compare install duration on same runner image/version. Projected savings: one browser download per eligible job; seconds unmeasured. Keep Linux system dependencies. [Official browser installation documentation](https://playwright.dev/docs/browsers#chromium-headless-shell).
2. Benchmark workers on an isolated exact commit and actual GitHub runner class. Test 2 versus 4 only after confirming available cores/memory; run identical suites and record peak RSS, per-file durations, test counts and failures. Do not enable unlimited workers by intuition. For Vitest, hold three shards constant first; then evaluate fewer shards only when setup overhead outweighs reduced execution time. Keep isolation and jsdom/edge-runtime semantics. [Vitest performance guidance](https://vitest.dev/guide/improving-performance).
3. For remote workspace, compare two shards against one only using downloaded step timings and suite duration. Each shard starts three Vite servers and repeats dependency/browser setup; collapsing can save runner minutes yet increase wall time. Fully parallel collection already permits test-level Playwright sharding, but equal test counts do not guarantee equal runtime. Preserve unique report names and complete aggregate coverage. [Playwright sharding](https://playwright.dev/docs/test-sharding).
4. Optimize slow specific files only after profiling. Keep accessibility, property, public-API coverage, workflow security and navigation runtime tests. Node navigation fixtures take about a second and are not a credible removal target. Scope pure tests to Node when they truly need no browser globals; current config already does this extensively.
5. Keep zero retries on required runs; retries hide rather than solve performance/flakiness. Maintain scheduled coverage and full workspace width/locale/theme matrix. No removal recommendation is supported merely by tests sharing names or source modules.

Acceptance: unchanged collected suite/test inventory; zero missing/duplicate shard evidence; no extra skips/retries; all required browser engines and locale/mobile coverage retained; no credentials enter anonymous jobs; Use at least five comparable runs as a pilot and report median/range only; collect at least 20 comparable runs before claiming a p95 improvement in the end-to-end quality critical path. Report wall time separately from runner minutes. Browser shell-only and worker tuning remain hypotheses until measured on CI.

Full-suite failures are in `BarcodeLocationImage.test.tsx`, `StorageLayoutScreens.test.tsx`, `LocationPicker.ai.test.tsx` and `LocationPicker.image.test.tsx` (missing UI controls/lookup mock calls). These are observations on unrelated dirty work, not regressions attributed to CI configuration. No production fixes were attempted. Longest measured files: codegen isolation 11.2 s, PackingScreen 10.0 s, GlobalSearch 8.5 s, StorageLayoutScreens 6.8 s. File durations overlap and must not be summed as wall time. Raw reports stay in /tmp to avoid preserving full failure DOMs or unrelated data in the research documents.

The stable three-file subset passed at both worker settings. Its 0.053 s difference (1.7%) is one observation and below a credible threshold for a worker recommendation; do not claim a 4-worker CI speedup. Both configurations preserve all 72 assertions. Native GitHub parallel steps may permit build/browser-install overlap, but require explicit joining/failure propagation and a supported workflow validator; that proposal is covered by the main plan, not tested here.

## Reproduction commands

Observed local toolchain: Node `v24.19.0`, pnpm `10.33.2`. Commands ran from the repository root against the dirty workspace described above. The stable subset consists exactly of the workflow, discovery and guard integration files shown below. Wall timings were measured around subprocess execution with Python `time.monotonic()`; these commands preserve the runner arguments and report destinations used. No tests were rerun to prepare this section.

```sh
pnpm test:navigation
pnpm ci:test-discovery
pnpm exec vitest list --filesOnly --json > /tmp/ci-speed-vitest-list.json
pnpm exec playwright test --config playwright.workspace.config.ts --list --reporter=json > /tmp/ci-speed-workspace-list.json
pnpm exec playwright test --config playwright.config.ts --list --reporter=json > /tmp/ci-speed-smoke-list.json
pnpm exec playwright install chromium --dry-run
pnpm exec playwright install chromium --only-shell --dry-run
pnpm exec vitest run --maxWorkers=2 --reporter=json --outputFile=/tmp/ci-speed-vitest-2.json
pnpm exec vitest run tests/integration/ci-workflows.integration.test.ts tests/integration/ci-test-discovery.integration.test.ts tests/integration/ci-guards.integration.test.ts --maxWorkers=2 --reporter=json --outputFile=/tmp/ci-speed-subset-2.json
pnpm exec vitest run tests/integration/ci-workflows.integration.test.ts tests/integration/ci-test-discovery.integration.test.ts tests/integration/ci-guards.integration.test.ts --maxWorkers=4 --reporter=json --outputFile=/tmp/ci-speed-subset-4.json
```

The parent's pinned actionlint 1.7.12 probe accepted sequential steps but rejected both tested native background/wait and parallel syntax; see `native-parallel-probe.json`. Native parallel steps therefore require resolving validator compatibility before implementation. This is separate evidence gathered by the parent, not a command run in this test audit.
