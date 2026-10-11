# Optional staging and faster CI

## Objective

Ship quickly while the application has no users. Keep CI, CodeQL, production
backups, candidate smoke, promotion checks, and live smoke. Make the separate
staging deployment reversible through a repository setting, and reduce the
slowest browser suite without removing tests.

## Baseline

The main run for `9675ae7` took 9m25s: 2m16s through `check`, 3m45s in staging,
3m15s in production, and 9s between jobs. CodeQL ran in parallel. Removing
staging from that run would have reduced merge-to-release time to roughly
5m35s; this is an estimate, not a guaranteed release duration.

The workspace browser report had 44 cases: 42 passed and two intentional
mobile skips. Barcode scanning/decoding consumed most of its test time. The
suite already uses two workers and full test parallelism. pnpm and Next.js
build caches and three Vitest shards already exist.

Evidence: [main run](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38108938145)
and its `browser-junit-workspace-1` artifact.

## Implementation

1. Create an isolated worktree from current `origin/main`, preserving the
   original workspace's uncommitted work, including the concurrent Bun work.
2. Capture the repository variable `STAGING_ENABLED` once in `check`, after
   the quality aggregate succeeds. Export `staging_enabled` as a job output.
   Only the exact string `false` disables staging. An unset, misspelled, or
   other value keeps staging enabled. Using one captured value prevents a
   mid-run settings change from changing the meaning of a skipped job.
3. Keep staging in the workflow and retain its infrastructure, credentials,
   tests, controller output, lock, and artifacts. Its condition requires the
   captured value `true`, successful CI, the owned repository, and a main
   push/manual run. When disabled, it is visibly skipped and consumes no runner.
4. Keep production dependent on `check` and `staging`. Allow exactly two paths:
   - captured `false` plus staging result `skipped`;
   - captured `true` plus staging result `success` and `STAGING_PASSED`.
     Both paths require successful CI, `!cancelled()`, and the existing trusted
     main source predicates. Neither failed nor cancelled staging can bypass
     the enabled gate. Missing policy output must block production.
5. Split the credential-free workspace browser suite into two native
   Playwright shards, alongside the existing unsharded smoke job. Keep all
   desktop/mobile and locale cases, two workers per runner, zero retries,
   failure-only diagnostics, and the single anonymous Next.js build. Give
   each shard separate JUnit and diagnostic paths so reports cannot overwrite
   each other. Leave the scheduled full matrix unchanged.
6. Update the repository workflow validator to enforce the new conditions,
   captured output, complete shard matrix, command total, and report mapping.
   Add behavioral release-condition cases and regression mutation tests.
7. Update the release runbook with the flag's exact values, coverage tradeoff,
   re-enable procedure, and browser shard/report layout.

## Verification

- Execute the policy step with unset, false, true, invalid, and differently
  cased inputs. Only `false` may produce `staging_enabled=false`.
- Exercise the actual YAML conditions across enabled/disabled/missing policy,
  successful/failed/cancelled/skipped CI and staging, missing or incorrect
  controller outcomes, cancellation, PRs, other branches, and foreign repos.
- Run workflow policy/actionlint/pin validation, the focused CI and release
  integration suites, formatting, lint, and type checking.
- Compare Playwright discovery for the unsharded suite with the union of both
  shards: identical cases, no duplicates. Execute both shards locally and
  require the same passing/skipped counts and separate JUnit files.
- Run the full required GitHub PR checks. Inspect shard reports and timings;
  report total CI time rather than adding parallel job durations.

## Rollout and merge

Open and register a PR with the plan, implementation, and validation evidence.
Wait for every required check and keep the PR up to date with main. Set the
repository variable `STAGING_ENABLED=false` before merging; the old workflow
ignores the variable, so this does not alter existing runs. Merge through the
normal protected-branch path. Verify that the merge run captures `false`, skips
staging, and completes the ordinary production release. Confirm main CI and
release timings and preserve the original local working tree.

To restore staging, set `STAGING_ENABLED=true` (or delete the variable) before
a new run. An already-running workflow keeps its captured policy. Re-enable
before onboarding real users or undertaking changes that need authenticated
staging verification. Production read-only smoke does not replace staging's
authenticated write/webhook/tenant tests, and the candidate still uses the
production Convex backend.

## Local verification results

- Workflow policy, actionlint 1.7.12, and all eight action pins passed.
- All 113 focused CI-policy/release integration checks passed.
- Full-tree formatting and lint passed. The pinned Bun checker reported no
  type errors in 764 files. Test discovery found 250 Vitest files and 11
  Playwright spec files with no mismatches.
- Discovery proved exact browser coverage: 44 cases split into 22 + 22,
  with no missing or duplicated cases. Local shard reports recorded 22 passes
  in 44.96s and 20 passes/two intentional skips in 31.56s, with zero failures,
  errors, or retries. These local durations are not a GitHub runner benchmark.
- GitHub required checks and the post-merge release are verified during rollout.

## Deferred optimization

Do not combine or remove CodeQL merely to reduce the number of workflow rows.
Do not remove post-merge checks, share anonymous builds with credentialed
production builds, add retries, or restore shared PR caches in release jobs.
A pinned browser container and documentation-only fast path need independent
benchmarks/policy work; neither is needed for this rollout.
