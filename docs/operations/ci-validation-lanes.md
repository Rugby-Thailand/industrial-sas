# Validation lane consolidation

Phase 1 preserves full validation on PR, main push and dispatch. Five independent
validation runners become two matrix lanes, with fail-fast disabled. The stable
`check` still requires success from validate, all Vitest shards, all browser
suites and PR dependency review. CodeQL and release behavior are unchanged.

| Previous owner          | New owner  | Preserved commands                                                                                                        |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| style                   | static     | `pnpm format:check`                                                                                                       |
| types                   | static     | `pnpm typecheck`, `pnpm typecheck:ts6`                                                                                    |
| lint                    | static     | `pnpm lint`, `pnpm check:navigation`                                                                                      |
| audit                   | contracts  | workflow lint/pins, production audit, app and release exact-chain audits                                                  |
| audit                   | contracts  | `pnpm -C tools/release install --frozen-lockfile`, `node tools/release/check-compatibility.mjs`, `pnpm ci:test-discovery` |
| codegen                 | contracts  | `pnpm ci:codegen`                                                                                                         |
| every validation runner | both lanes | final `pnpm ci:clean-tree`                                                                                                |

Each independent step uses `!cancelled()` and successful setup rather than
implicit success of preceding checks. A failed check remains fatal while later
checks report their own defects. Codegen retains its private local backend,
credential rejection and finally cleanup. It runs after contract checks; Next
route generation runs sequentially through the two unchanged static typechecks.
Each lane checks the tree after all generators, including on earlier failures.
The policy enforces exact lane membership and commands, no execution overrides,
no continue-on-error, and the final clean-tree position.

This is a measured rollout experiment, not a guaranteed speedup. It removes
three checkout/setup executions and reduces initially runnable quality runners
from 13 to 10; the dependent aggregate is not initially runnable. Existing
runner waits do not establish account-cap saturation. Wall time minus the
longest job is not queue time. Existing ruleset 24799747 already protects main;
no settings changes are needed.

Before accepting performance claims, compare hosted job created/start/completion
timestamps, runner-seconds and end-to-end elapsed time under comparable load.
Observe at least 20 PR runs for gate regressions and lane imbalance. Revert this
workflow/policy/test change if serial lanes worsen the critical path. Workspace
selection remains unimplemented here: all browser suites always run. Per-module
Vitest, partial releases and cache trust changes remain deferred.

## Local measurements (2026-11-03)

Measured in the isolated macOS arm64 worktree with Node 24, pnpm 10.33.2,
Bun 1.4.3 and warm dependencies. Commands ran sequentially within each lane;
static ran before contracts. Every command exited 0, including both final
clean-tree checks. No hosted-runner checkout/setup time is included.

| Lane      | Command                                                                                       |    Seconds |
| --------- | --------------------------------------------------------------------------------------------- | ---------: |
| static    | `pnpm format:check`                                                                           |      28.48 |
| static    | `pnpm typecheck`                                                                              |       4.66 |
| static    | `pnpm typecheck:ts6`                                                                          |      15.39 |
| static    | `pnpm lint`                                                                                   |      55.02 |
| static    | `pnpm check:navigation`                                                                       |       4.79 |
| static    | `pnpm ci:clean-tree`                                                                          |       0.69 |
| static    | **Total**                                                                                     | **109.03** |
| contracts | `node scripts/ci/validate-workflows.mjs --verify-pins`                                        |       6.07 |
| contracts | `pnpm audit:prod`                                                                             |       1.25 |
| contracts | `node scripts/ci/audit-dependencies.mjs --scope=app`                                          |       1.24 |
| contracts | `node scripts/ci/audit-dependencies.mjs --scope=release`                                      |       1.01 |
| contracts | `pnpm -C tools/release install --frozen-lockfile; node tools/release/check-compatibility.mjs` |       1.02 |
| contracts | `pnpm ci:test-discovery`                                                                      |       5.08 |
| contracts | `pnpm ci:codegen`                                                                             |      12.28 |
| contracts | `pnpm ci:clean-tree`                                                                          |       0.67 |
| contracts | **Total**                                                                                     |  **28.62** |

The initial frozen application install took 10.6 seconds; the initial frozen
release-tool install took 6.5 seconds. The timed release-tool step above reused
that installation. Earlier cold typechecks took 12.60 and 43.87 seconds;
the table contains warm reruns, so it must not predict cold hosted duration.
Three removed setup executions represent a structural reduction, not measured
hosted savings. No claim of faster wall time or queue reduction is established.

Validation: 108 focused workflow/aggregate/release-policy/codegen-isolation tests,
normal ESLint, all 68 navigation architecture fixtures and inventory check,
both typechecks, full formatting, workflow lint and remote pin verification,
all dependency audits, release schema compatibility, discovery (381 Vitest files,
17 Playwright specs), anonymous codegen freshness and final clean-tree checks.
Browser and full application suites are unchanged and remain required in hosted
CI; they were not rerun locally for this workflow-only change.
