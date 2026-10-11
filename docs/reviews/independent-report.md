# Independent performance verification — 2026-10-11

Production compiler-on and compiler-off builds both passed. The actual application passed all six authenticated behavior flows under each build. React Compiler adds measurable JavaScript bytes in this released head, while these lab timings do not establish a consistent speed improvement or regression. The input probe does not isolate React render CPU, so this experiment cannot decide whether Compiler helps demanding updates.

## Scope and isolation

- Worktree: `industrial-sas-independent-perf-20261011` (sibling of the primary checkout), detached at released `9ac5da0e5ffc681e19a7dc5ad83da5d26bb61320`. Original user checkout was not modified.
- Compiler-off control changed only `reactCompiler: true` to `false` in `next.config.ts`, with identical frozen dependencies, local backend and fixture. The patch is retained in ignored `out/performance/compiler-off-control.patch`; tracked config is restored to released compiler-on state.
- These are fresh final-head compiler comparisons, not a new benchmark of the whole change against yesterday’s baseline. The original checkout advanced independently during this task; those unrelated changes were excluded and need a later integration retest.
- Fresh loopback backend on 3260/3261 with test Clerk identity. Only synthetic local fixtures were mutated. App served optimized Next builds on port 3235. All owned lab listeners were stopped afterward. No PR, commit, push or production write was performed.

## Test results

- Targeted Vitest regression/a11y: **4 files, 93 tests passed**. Coverage includes focused Table filter drafts under live row changes, Product form draft/save/error flows, optimistic updater scope and Product accessibility. Vitest did not exercise Next’s compiler transform.
- Optimized production build: **compiler-on passed; compiler-off passed**.
- Actual authenticated application checks: **6 flows passed compiler-on and 6 compiler-off**. Both exercised lazy editor opener/dialog focus, real Convex optimistic confirmation/server normalization/business rejection rollback, and complete-result search/paging/sorting/form draft recovery/confirmed save for English/Thai on desktop/mobile.
- Six off-build flows were run after all timing blocks because the verifier creates a product. This preserves matched fixtures for timing.
- Full repository quality suite, wider browser matrix, field Core Web Vitals, real phone/camera checks and release gates were not rerun: no application implementation or new PR is being proposed by this verification alone. They remain required before an implementation PR.

## Reproducible timing method

- darwin/arm64, Apple M1 Max, Node v24.19.0; Playwright 1.62.1 Chromium; Next 16.3.8 optimized production builds.
- Four sequential blocks **A(on) → B(off) → B(off) → A(on)**, preserving/restoring build artifacts rather than rebuilding between blocks. Five runs per locale/viewport per block: **10 per locale/viewport/flag**, 20 per viewport/flag when locales are pooled. **480 numeric flow rows** retained.
- Desktop 1440×900, mobile viewport 390×844, English/Thai. Mobile is desktop Chromium viewport emulation; no mobile CPU or network throttle.
- Cold catalogue means a fresh browser context; browser/OS/server caches are not all purged. Warm catalogue means same-context `goto` reload, not client navigation. Product detail is route-warm. Storage is first storage-route visit after catalogue/product in the same context, so shared assets/caches are partly warm.
- Timers include automation/readiness waits, runtime authentication SDK and loopback responses. Speed Insights/Sentry were disabled. Browser/OS background activity is not experimentally locked down. None of these numbers is a field percentile or user INP.
- Query timings are separately measured sequential HTTP requests. Total sparse-search time below sums all requests needed for the complete page; it is not the single-request median.
- Fixture contained **127 products** during all four matched blocks, verified by read-only local database count. Sparse search used **134 requests per run** in every matched block. Initial 126-product trial was excluded because authenticated verification subsequently created a synthetic product.
- Input probe fills the first editable Product textbox and waits two animation frames. It largely reflects frame timing and automation; it does not measure isolated React rendering cost or an expensive update workload.

## Confirmed JavaScript cost

Observed bytes below are **same-origin decoded JavaScript at the readiness checkpoint plus two animation frames**, with normal route prefetch included. They exclude third-party SDK bytes; they are not gzip transfer sizes or a pure critical-path bundle. Values were stable across matched samples.

| Observed route assets           | Compiler on | Compiler off | Cost with compiler on |
| ------------------------------- | ----------: | -----------: | --------------------: |
| Catalogue fresh-context         | 1,433,344 B |  1,376,639 B |    +56,705 B (+4.12%) |
| Storage after catalogue/product | 1,627,744 B |  1,511,554 B |   +116,190 B (+7.69%) |

All emitted `.next/static/chunks` JavaScript, including assets not initially visited: on **3,397,533 decoded B / 1,080,177 gzip-level-9 B**, off **3,271,890 decoded B / 1,003,741 gzip-level-9 B**. Compiler-on emits **125,643 more decoded B and 76,436 more gzip B** across all chunks. These totals must not be called initial route bundle size; gzip figures are computed artifacts, not measured network transfer.

## Lab timing results

Pooled English/Thai medians, with interquartile ranges in brackets; milliseconds. Each row has 20 observations per flag.

| Flow                       | Viewport | Compiler on median [Q1–Q3] | Compiler off median [Q1–Q3] |
| -------------------------- | -------: | -------------------------: | --------------------------: |
| catalogue cold             |      390 |     1367.1 [1341.4–1391.4] |      1377.7 [1321.2–1415.2] |
| catalogue warm             |      390 |        854.8 [851.0–856.2] |         879.2 [848.9–909.3] |
| catalogue cold             |     1440 |       950.6 [933.4–1023.8] |         954.1 [941.4–973.8] |
| catalogue warm             |     1440 |        853.5 [845.9–864.6] |         857.3 [852.7–862.7] |
| product-detail             |      390 |        844.0 [842.2–855.1] |         843.8 [841.9–846.3] |
| product-detail             |     1440 |        840.8 [839.3–865.8] |         843.6 [840.4–853.4] |
| product-fill-to-two-frames |      390 |           21.9 [21.5–23.1] |            21.8 [21.5–22.2] |
| product-fill-to-two-frames |     1440 |           23.0 [21.3–27.2] |            21.4 [21.1–21.7] |
| product-navigation         |      390 |           24.5 [23.6–25.5] |            23.9 [23.7–24.9] |
| product-navigation         |     1440 |           26.0 [25.8–33.6] |            25.8 [25.3–28.1] |
| storage                    |      390 |        850.1 [847.9–854.1] |         846.1 [843.7–848.1] |
| storage                    |     1440 |        846.7 [844.3–850.7] |         851.3 [849.2–854.4] |

Cold-catalogue block medians across locales/viewports were **on A1 1,338.7 → off B1 1,027.5 → off B2 955.7 → on A2 940.6 ms**. This substantial chronological drift prevents treating the first pair as a causal compiler regression. Warm/interaction/storage differences were mostly small or inconsistent; the mobile warm median had greater variability under off. Full ranges, per-block spread, byte/long-task metrics and raw rows are retained in JSON.

| Complete sparse-search measurement    | Compiler on | Compiler off |
| ------------------------------------- | ----------: | -----------: |
| Median sum of sequential request time |   3988.7 ms |    3780.3 ms |
| Requests/run                          |         134 |          134 |
| JSON response bytes/run               |     290,684 |      290,684 |

The backend code and deployment did not change with the frontend compiler flag. Query timing differences therefore demonstrate variability in this lab; they do not prove a backend performance improvement caused by Compiler. A complete sparse search still costs several seconds and many serial continuations, which is a higher-value next investigation than interpreting a ~30 ms individual request.

## What is good, what is costly, and what remains unproven

| Change                                           | Independent evidence                                                                                                                                                           | Decision for next plan                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing lazy Batch editor                       | On defers 90,123 decoded B; focus/draft behavior passes. One cold open 953.5 ms. Off defers 72,402 B; one open 633.8 ms. Single open timings are not causal speed comparisons. | Retain splitting; benchmark intent-triggered preloading to improve first open while preserving upfront savings.                                                                 |
| Narrow optimistic Product details                | Real local confirmation, normalization, rollback and authorization scope checks pass under both production builds.                                                             | Retain scoped behavior; do not expand to authoritative stock/status/permissions without additional failure tests. These tests prove behavior, not a measured user-latency gain. |
| Selective TanStack Table/Form                    | Actual search/page/sort/draft/save/focus behavior passes. No same-head TanStack-vs-previous-implementation ablation was run.                                                   | Keep scope narrow; treat maintainability benefits separately from performance claims. Do not credit Compiler differences to TanStack.                                           |
| Global React Compiler                            | Deterministic additional route/all-chunk bytes; no consistent timing benefit in these probes. Expensive React update CPU remains unmeasured.                                   | Perform real render/update profiling, then compare global/off/annotation options. Do not recommend a global revert solely from these latency samples.                           |
| Sparse catalogue search                          | 134 continuations and ~3.8–4.0 s summed request time under the identical backend.                                                                                              | Prioritize full-search elapsed time, continuation count and candidate read cost while preserving complete substring/filter/sort semantics.                                      |
| Storage localized-message savings from yesterday | This run compares only final-head Compiler on/off and does not remeasure locale-import ablation.                                                                               | Keep yesterday’s specific byte evidence, but do not claim a fresh route-speed gain from this run.                                                                               |
| Monitoring and additional packages               | Production transport, overhead under enabled telemetry, alerts and any unused TanStack packages were outside this experiment.                                                  | Do not call monitoring a speed improvement; evaluate only targeted additions with measured bottlenecks.                                                                         |

## Before any new application PR

1. Agree the bottleneck and meaningful user-visible/read-cost target before modifying an implementation. Capture the same exact-source baseline, matched data and caches, actual expensive update workload and production build.
2. Implement one hypothesis in an implementation worktree. Independent worktree reproduces baseline/candidate and ablation with reversed order, sample distributions and explicit costs. Preserve all scope/permission/completeness behavior.
3. Require benefit outside observed noise or a deterministic cost reduction with an accepted UX tradeoff. Report inconclusive or harmful findings and narrow/revert the candidate locally before opening a PR.
4. Run full repository checks, production build, audit/codegen/test-discovery/release-contract gates, anonymous/workspace/authenticated EN/TH desktop/mobile flows, plus targeted failure/accessibility/device checks affected by the change. No skipped mandatory checks or test weakening.
5. Only then open a small PR with exact baseline/candidate commits, raw evidence, independent report and limitations. Rerun applicable gates on final merged/integrated source; today’s detached release tests do not validate unrelated new HR/search changes.

## Evidence

Paths below are relative to the independent worktree. `out/` and `.cache/` are git-ignored there and are not part of the repository; this report was copied into the repository by T00 of the [Bun and Elysia delivery plan](../plans/bun-elysia-delivery-plan-2026-10-11.md).

- `out/performance/independent-summary.json`: aggregate distributions, query totals, block medians, source and protocol metadata.
- `out/performance/compiler-on-a1.json`, `compiler-off-b1.json`, `compiler-off-b2.json`, `compiler-on-a2.json`: four matched raw blocks. `compiler-on-before-verification-trial.json` is excluded.
- `out/performance/compiler-on-authenticated-verification.json`, `compiler-off-authenticated-verification.json`, `targeted-tests.log`: actual behavior/test results.
- `out/performance/compiler-on-chunks.json`, `compiler-off-chunks.json`, corresponding chunk-size files/build logs and `compiler-off-control.patch`: emitted asset/control evidence.
- Ignored `.cache/performance/measure-independent.mjs`, `summarize-independent.py`, local bootstrap and preserved compiler-off production build: reproduction artifacts. Private credentials/tickets/business rows are not included in this report or numeric artifacts.
