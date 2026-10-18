# CI/CD speed audit: release orchestration and redundant steps (Kiro)

Date: 2026-10-13. Plan only. I changed no files except this report. I ran no
deploys, dispatches, installs or test suites, and called no app endpoints.

## Scope and sources

- Remote `main` = `0bbd285f` (confirmed read-only via `gh api …/commits/main`;
  equal to the local `origin/main` ref). Remote files were read with
  `git show/archive origin/main` into a temp directory, which has been removed.
- Local `HEAD` = `733c6aca` with a heavily dirty tree. It differs from remote in
  54 files under `.github`, `scripts`, `tools`, `vercel.json` and `package.json`.
  The local `quality.yml` browser matrix has two legs (`smoke`, `workspace`).
  Remote has four: `smoke`, `navigation`, `workspace-1`, `workspace-2`. All
  recommendations target remote `main`; file:line references are to that tree.
- Measured data:
  - GitHub step timings for 10 main push runs, from the sibling
    `github-run-timings.json`, recomputed independently.
  - Release phase timings from the event timestamps in 8 runs of
    `staging-release-*` and `production-release-*` manifest artifacts, fetched
    read-only. Only aggregate durations are reported here, with no IDs, URLs or
    provider output.
- Primary docs:
  - Playwright browsers (`--only-shell`): https://playwright.dev/docs/browsers
  - Playwright CI (browser caching): https://playwright.dev/docs/ci
  - Vercel build cache: https://vercel.com/docs/deployments/troubleshoot-a-build#understanding-build-cache
  - `convex deploy --help` from the installed convex 1.46.0, the same version
    as remote.

## Where the time goes (measured)

Latest run (`0bbd285f`): 620 s from push to live.

| Segment                     | Duration | Notes                                                                                                    |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Quality jobs before `check` | 195 s    | Critical leg is now `Browser (navigation)` at 189 s. Before that leg existed, it was smoke at 112–157 s. |
| `check` + scheduling        | ~10 s    |                                                                                                          |
| Staging job                 | 232 s    | 10-run median 230 s, range 152–299                                                                       |
| Production job              | 179 s    | 10-run median 184 s, range 127–327                                                                       |

Release jobs therefore take about 67% of push-to-live time.

Inside the release jobs (8 runs, median and range):

| Phase                                      | Staging                 | Production                   |
| ------------------------------------------ | ----------------------- | ---------------------------- |
| Checkout                                   | 7 s                     | 7 s                          |
| Setup action (fresh install, no cache)     | 17 s                    | 16 s                         |
| `tools/release` install                    | 3 s                     | 3 s                          |
| Playwright Chromium `--with-deps`          | 23.5 s (20–28)          | 24.5 s (21–30)               |
| Run step before the first controller event | ~1.5 s                  | ~1.4 s                       |
| Native backup (create + verify)            | —                       | 2.5 s (2.2–2.7)              |
| CLI upload → deployment created            | 4.8 s                   | 3.2 s                        |
| Remote Vercel build, created → READY       | 124.7 s (83–185)        | 120.0 s (92–230)             |
| Candidate alias, promote, serving polls    | 0.1 s                   | 0.5 + 0.6 s                  |
| Smoke                                      | 45.9 s (39–69), staging | 7.3 s candidate + 5.4 s live |

Conclusions:

- The two sequential remote Vercel builds (about 245 s) are the dominant cost.
- Fixed runner preparation costs about 50 s per release job, about 100 s per
  release.
- Backup, preflight, stale-SHA checks, alias binding and promotion together
  cost under 5 s. They are not worth weakening.
- Dependency audits take 0–1 s each. `validate` (79–109 s) is not on the
  critical path.

## Recommendations

Savings labels:

- **M**: a measured upper bound (the duration of the step removed or
  overlapped).
- **C**: conjecture until the listed experiment is run.

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Files                                                                                                                                                                                         | Saving                                                                                                                       | Risk                                                                                                                                                                    | Invariants preserved                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Staging only: overlap the Chromium install with the remote build. Remove the staging `Install Playwright Chromium` step. In `run.mjs`, after `deploy-created` (when the source upload is complete), spawn `pnpm exec playwright install --with-deps --only-shell chromium` with a scrubbed env (`PATH`, `HOME`, `CI` only, as `deploy()` already does). `smoke()` waits for that child before starting, within a bound. If the install fails, the outcome is `STAGING_FAILED`.                                   | `quality.yml` staging job; `scripts/release/run.mjs` `deploy()`/`smoke()`                                                                                                                     | M ≤ 23.5 s per release; realistic C 20 s, because the build is longer than the install                                       | Low–medium. Staging is an isolated project/backend and already mutates before its smoke. A failed install blocks production through the existing `STAGING_PASSED` gate. | The secret env never reaches the installer. The install does not run during the upload, so uploaded source still matches the gated SHA. `releaseJobProblems` (`workflow-lib.mjs` 523–613) does not require a Chromium step, so the validator needs no change. |
| R2  | Use `--only-shell` on every Chromium-only install. All Chromium projects use `devices[...]` with no `channel` and no `headless:false` (`playwright.config.ts:40-41`, `playwright.navigation.config.ts:25-26`, `playwright.staging.config.ts:35`, `playwright.production.config.ts:29`, `playwright.workspace.config.ts:48-62`). They already run the headless shell, so the full Chromium download is unused.                                                                                                    | `quality.yml` browser, staging and release jobs; `workspace-matrix.yml`; `BROWSER_STEPS` exact strings in `workflow-lib.mjs` ~752–770, in lockstep                                            | C: part of the 20–32 s install per leg and release job. The download/apt split is unmeasured.                                | Low                                                                                                                                                                     | Same browser revision (the locked `@playwright/test`); no behaviour change                                                                                                                                                                                    |
| R3  | Lower `pollIntervalMs` in the build wait loop from 10 s to 3–5 s. The alias and serving loops already finish in ≤1.3 s, so only the build loop matters.                                                                                                                                                                                                                                                                                                                                                          | `scripts/release/lib/release.mjs` `runRelease` limits (line 56)                                                                                                                               | C: about 2.5–3.5 s average per job (half the interval saved), about 5–7 s per release                                        | Low. About 40 GET calls per 120 s build.                                                                                                                                | Monotonic deadlines, identity re-checks per poll and timeout outcomes are unchanged                                                                                                                                                                           |
| R4  | Record Vercel `buildingAt` and `ready` timestamps in the manifest next to `createdAt`. These are documented deployment fields; check that `deploymentFacts` carries them. Queue time and build time can then be separated without reading provider logs.                                                                                                                                                                                                                                                         | `scripts/release/lib/vercel-api.mjs` `deploymentFacts` (~255; reads `readyState` and `createdAt`; confirm it has no build timestamps); `release.mjs` `record("deploy-ready")`; `manifest.mjs` | None by itself. It is the prerequisite for R5 and R9.                                                                        | Low. These are public timing fields only.                                                                                                                               | The manifest stays allowlisted, with no raw provider metadata                                                                                                                                                                                                 |
| R5  | Verify the Vercel warm build cache. Per Vercel's docs, the cache key includes the Git branch, and a deploy reuses the previous build's `node_modules` and `.next/cache` (Next.js preset). Releases deploy through the CLI from a detached `ref: ${{ github.sha }}` checkout (`quality.yml` staging/release checkout), and `deploy()` passes no `--force`. Whether either project actually restores its cache is unverified. Remote builds vary 83–230 s, compared with 9–49 s for the GitHub smoke `pnpm build`. | Operator review of the Vercel dashboard; possibly the `vercelDeployArgs` metadata                                                                                                             | C: unknown, potentially the largest saving                                                                                   | Low to investigate. Any fix must keep `--prod --skip-domain`, the `releaseSha`/`releaseRunId` metadata and the gated `vercel.json`.                                     | Do not enable native Git builds and do not use deploy hooks                                                                                                                                                                                                   |
| R6  | Optional: skip the pinned Bun install in jobs that never run Bun locally (staging, release, production backup). These jobs build remotely or run Node-only scripts. Add a `bun: "false"` input to the setup action, and update `setupActionProblems` (`workflow-lib.mjs` 1117) to require Bun everywhere else. First confirm that `tests/e2e/production/bun-runtime.spec.ts` checks only the hosted runtime and does not spawn a local `bun`.                                                                    | `.github/actions/setup-node-pnpm/action.yml` (last step); `workflow-lib.mjs`                                                                                                                  | C: a few seconds per job. The step is inside the composite and was not timed separately.                                     | Low                                                                                                                                                                     | The hosted Bun is still set by `vercel.json bunVersion`                                                                                                                                                                                                       |
| R7  | Quality legs (secret-free): start the browser install in the background before `pnpm build`/`pnpm build:navigation`, and wait for it before the suite. Measured sequential pairs: smoke build 42 s + install 25 s; navigation build 16 s + install 80 s.                                                                                                                                                                                                                                                         | `quality.yml` browser job; `BROWSER_STEPS` order in `workflow-lib.mjs` 711–826                                                                                                                | M ≤ 16 s on the current critical leg (navigation), ≤ 25 s on smoke. C: CPU and apt contention on the runner may reduce this. | Low                                                                                                                                                                     | `ci:clean-tree` still runs after the build. Playwright writes to `~/.cache/ms-playwright`, outside the checkout.                                                                                                                                              |
| R8  | For the timing owners: the 80 s, three-engine `--with-deps` install is the largest fixed step on the current critical path. Splitting WebKit/Firefox into their own leg would move it off the path, at the cost of about 25 s more setup on another runner.                                                                                                                                                                                                                                                      | `quality.yml` browser matrix; validator matrix check (`browserProblems`, 827)                                                                                                                 | C: 30–40 s on the critical path                                                                                              | Low; adds compute minutes                                                                                                                                               | All legs still gate `check`                                                                                                                                                                                                                                   |
| R9  | Low priority: add `--codegen disable` to `convex deploy` inside `GATED_BUILD_COMMAND`. `convex/_generated` is committed, and the `codegen` job checks its freshness for the same SHA (`check-convex-codegen.mjs:347`).                                                                                                                                                                                                                                                                                           | `scripts/release/lib/vercel-config.mjs:8-12` and `vercel.json`, in one commit                                                                                                                 | C: seconds; measure through R4 and the build log first                                                                       | Medium–low. A mismatch fails closed: `cutoverState` returns `NOT_READY` before any mutation.                                                                            | `assert-deploy-env` pre/build phases are unchanged                                                                                                                                                                                                            |

A conservative combined estimate for R1–R3 and R7 is about 30–60 s from push to
live, roughly 5–10%. That figure is conjecture. Changes of a larger magnitude
can only come from the Vercel build (R5) or from moving the navigation install
off the critical path (R8).

## Rejected (would weaken a contract, or there is nothing to save)

- **Overlapping the production Chromium install with the remote build.** This
  would create a new, flake-driven failure after the Convex push
  (`CANDIDATE_FAILED`, mutation `backend`). Recovery would require
  reconciliation and acknowledgement under `BLOCKED_UNRECONCILED`. The saving
  would be ≤ 24.5 s. Production keeps its install before the controller runs.
- **Production preparation in parallel with staging** (`release` needing only
  `check`, then polling for staging). This replaces the declarative staging
  gate (`RELEASE_CONDITIONS`, `workflow-lib.mjs` 517–520, plus "release must
  need staging" at 1053). It would also hold the production lock during staging
  and block the daily backup.
- **Moving or splitting the backup out of the locked job.** The backup takes
  2.5 s (measured). A split would allow another deployment between the snapshot
  and the deploy.
- **GitHub caches in release or backup jobs.** These are forbidden on purpose
  (`releaseJobProblems` cache checks; the setup action's `cache: "false"`) to
  prevent cache poisoning of trusted jobs. The fresh install costs 16–17 s,
  which is acceptable.
- **Reusing the staging build for production.** The two use different projects,
  backends and baked `NEXT_PUBLIC_*` values, and environment separation would
  break.
- **Deduplicating `pnpm audit:prod`, the app/release exact-chain audits and
  dependency review.** Each takes 0–1 s, `validate` is not critical, and the
  policies differ: the runtime audit allows no exceptions, the exact-chain
  audits allow expiring exceptions, and dependency review is a PR diff.
- **`convex deploy --typecheck disable`.** This is not a duplicate. CI never
  runs `tsc` against `convex/tsconfig.json`: codegen uses `--typecheck disable`,
  and the root project uses different options.
- **Disabling the type check in the Vercel `next build`** (`next.config.ts:21-22`
  sets `ignoreBuildErrors: false`). This would add config divergence for an
  unmeasured saving.
- **Caching Playwright browsers.** Playwright's CI docs say restoring the cache
  takes about as long as downloading, and OS dependencies cannot be cached.
- **Removing `setup-node` from `check`** (1 s median) and **parallelising the
  staging smoke.** The staging smoke deliberately uses one worker against a
  shared synthetic fixture (`playwright.staging.config.ts:21-22`).

## Experiments (in order; each needs explicit approval where marked)

1. R4 instrumentation in a PR. Then read two release manifests to split the
   Vercel queue time from the build time. Read-only after merge.
2. R5 (operator, private): for the last few staging and production deployments,
   check in the Vercel dashboard whether the build log reports a restored
   cache, and note the install, `convex deploy` and `next build` durations. Do
   not copy logs into the repo.
3. R2 and R7 on a PR branch, through the existing manual `Planner quality`
   dispatch on that branch, which runs CI only and never releases. Compare
   install and leg durations with the medians above over at least 5 runs. Run
   `node scripts/ci/validate-workflows.mjs` locally first; the validator strings
   change in the same commit.
4. R1 and R3 can be checked only on `main`. Compare the staging job duration
   against the 230 s median over 5 or more releases. Confirm in the manifest
   that `smoke-staging-start` follows install completion, and that a forced
   install failure in a unit test of the controller maps to `STAGING_FAILED`
   with no production job.
5. R6 and R9 only after experiments 1 and 2 show that they matter.

## Validator coupling

`scripts/ci/workflow-lib.mjs` encodes exact step strings, ordering and matrix
shape for the browser job, the release jobs, the setup action and the backup
lock. Every change above except R1, R3, R4 and R5 must update the validator and
its tests in the same commit. Otherwise `validate` (and therefore `check`) fails
closed.
