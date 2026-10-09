# CI/CD workflow implementation — 2026-10-10

Kiro implementation pass for the workflow scope of the [consolidated audit](ci-cd-kiro-audit-2026-10-09.md). Platform facts come from [verified platform evidence](../operations/ci-cd-platform-evidence.md). No workflow in this change has run on GitHub yet. Everything below is checked locally only, and nothing here is live proof.

## Files

| File                                                                              | Purpose                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `.github/workflows/quality.yml`                                                   | PR/main quality gate, stable `check`, automatic staging → production release                     |
| `.github/workflows/codeql.yml`                                                    | Advanced CodeQL setup: `javascript-typescript` and `actions`; PR, main, weekly                   |
| `.github/workflows/security-audit.yml`                                            | Daily: mandatory runtime and high/critical audits; informative all-severity audit                |
| `.github/workflows/workspace-matrix.yml`                                          | Weekly `WORKSPACE_FULL_MATRIX=1`: 4 widths × 2 locales × 2 themes, synthetic fixtures            |
| `.github/actions/setup-node-pnpm/action.yml`                                      | Adds `cache` input. Release jobs pass `"false"`, so they use no GitHub cache                     |
| `.github/CODEOWNERS`                                                              | Owners for gate/release/backup/privacy/fixture tests, `vitest.config.mts` and critical snapshots |
| `scripts/ci/aggregate.mjs`, `lib.mjs` (`aggregateProblems` only)                  | Event-aware `check`; `REQUIRED_JOBS` must equal `needs`                                          |
| `scripts/ci/validate-workflows.mjs`, `workflow-lib.mjs`                           | Repository workflow policy, upstream pin verification, checksum-pinned actionlint                |
| `scripts/ci/test-report.mjs`, `report-lib.mjs`                                    | Merged shard inventory, JUnit failure/empty checks, informational coverage, audit summary        |
| `scripts/ci/audit-summary.mjs`                                                    | Informative all-severity audit; any audit outage fails                                           |
| `tests/integration/ci-workflows.integration.test.ts`, `ci-guards` aggregate cases | Policy regressions against the real workflow files                                               |

## Behaviour

- **Concurrency.** Each PR has its own group, and newer pushes cancel older runs. Every other quality run gets a unique `run_id` group. Staging uses the fixed `industrial-sas-staging-release` lock. Production uses `industrial-sas-production-release`, shared with the root daily backup. Both locks use `cancel-in-progress: false` and `queue: max`. The controller still rejects stale SHAs because queue order is not commit order.
- **`check`.** `if: always()` and needs `validate, codegen, test, test-report, build, browser, dependency-review`. The step fails on any failure, cancellation, missing job or unexpected skip. It also fails if `needs` and `REQUIRED_JOBS` drift apart. `dependency-review` may be skipped only on `push` and `workflow_dispatch`, and it must succeed on PRs. Any other event fails, so `merge_group` has to be reviewed before a merge queue is adopted.
- **validate.** Runs workflow policy with upstream pin verification and actionlint, format check, cold `next typegen && tsc`, lint, `audit:prod`, and the root exact-chain audits (`--scope=app`, `--scope=release`). Then test discovery and a clean-tree check. After a successful setup, every step runs, so independent defects all show in one run.
- **codegen.** Runs the isolated credential-free `ci:codegen`, then a clean-tree check.
- **test / test-report.** Two Vitest shards, each writing a blob with coverage. Stable per-shard artifact names use `overwrite: true`: failed-job reruns replace the rerun shard's report and retain an untouched successful shard from the same run and SHA. The report job also runs after a failed shard. It merges results into JUnit plus combined coverage and fails on a missing shard, an empty report, failures or errors. Coverage has no thresholds.
- **build / browser.** Credential-free production builds, each followed by a clean-tree check. The browser job installs Chromium at the locked `@playwright/test` revision and runs the anonymous desktop/mobile smoke and the PR workspace subset, with zero retries. Policy rejects `PLAYWRIGHT_DIAGNOSTIC_RETRIES`. JUnit is kept for 7 days; synthetic traces/screenshots are uploaded on failure only and kept for 5 days.
- **staging.** Runs only when `check` succeeded, for this repository, on `refs/heads/main`, and the event is push or dispatch. Uses environment `staging`, `id-token: write`, and checks out `github.sha` with `persist-credentials: false`. Setup runs with `cache: "false"`. Release tools are installed with `pnpm -C tools/release install --frozen-lockfile`, without `--ignore-workspace`. Only the runner step gets `RELEASE_ENVIRONMENT=staging` and `VERCEL_TOKEN`/`CONVEX_DEPLOY_KEY`/`CLERK_SECRET_KEY`. It outputs the controller outcome.
- **release.** Additionally requires staging `success` with outcome `STAGING_PASSED`. A superseded staging run releases nothing. Uses environment `production-release` with `contents: read` only. Only the runner step gets `RELEASE_ENVIRONMENT=production`, `VERCEL_TOKEN`, `CONVEX_BACKUP_ADMIN_KEY` and the read-only `GITHUB_TOKEN`. It never receives Convex or Clerk deploy secrets. The controller takes the mandatory backup itself, so there is no separate backup or preflight step.
- **Release uploads.** Only `manifest.json`, `backup-metadata.json` and `smoke-{staging,candidate,live}.json` from `release-output/`, kept 30 days. Policy rejects any other path.
- **Dependency review.** PR-only, `fail-on-severity: high`, runtime/development/unknown scopes, and no PR comment. `allow-ghsas: GHSA-vfj7-8cjw-p6xm` must match an unexpired entry in the root-owned `scripts/ci/dependency-exceptions.json`. Once that entry expires, validation fails until a reviewed change renews or removes it.
- **Workflow policy.** Enforces the selected-actions allowlist, full-SHA pins with exact `# vX.Y.Z` comments, and workflow-level read permissions. It also checks write-permission and secret allowlists per job, with secrets only in step `env`. It requires `persist-credentials: false`, timeouts and bounded artifact retention. It forbids `continue-on-error`, `pull_request_target`, `workflow_run`, `--ignore-unfixable` and `--ignore-workspace`.

## actionlint and `queue`

`actionlint` is the exact 1.7.12 build for the runner's platform, and its archive is checked against a pinned SHA-256 before anything runs. Version 1.7.12 predates the documented `concurrency.queue` key. The validator therefore lints a temporary copy in which only `queue: max|single` lines directly inside a `concurrency:` mapping are blanked, keeping line numbers. A misplaced queue, an unknown value, or `max` combined with `cancel-in-progress: true` is reported and left in the copy, so actionlint flags it too. No actionlint message is ignored.

## Local evidence (2026-10-10)

- `node scripts/ci/validate-workflows.mjs --verify-pins`: exit 0. All 8 action pins match upstream tags, actionlint 1.7.12 reports no problems, and policy passes for 5 workflows and 1 composite action. A temporary repository containing a bad expression, and separately `queue: max` with `cancel-in-progress: true`, exited 1.
- Vitest: `ci-workflows`, `ci-guards`, `ci-codegen-isolation`, `ci-test-discovery`, `dependency-exceptions`, `release-entrypoint`, `vercel-ignore-build`, 107 tests, exit 0.
- Two local shards with blob and coverage, then `--merge-reports` and `test-report.mjs`: exit 0. The negative run (wrong shard count, missing JUnit, failed shard) exited 1.
- `audit-dependencies.mjs --scope=app|release` exit 0; `audit-summary.mjs` for both directories exit 0 (findings shown as warnings); `pnpm audit:prod` exit 0.
- `tsc --noEmit` exit 0; eslint and prettier pass on the owned files.

## Remaining limitations and root follow-ups

- Nothing has run on GitHub: required `check` emission, fork/Dependabot behaviour, OIDC to Vercel Trusted Sources, `queue: max` semantics, staging/production execution, CodeQL upload, and dependency-review `allow-ghsas` all still need real runs.
- CodeQL default setup must stay disabled; GitHub rejects advanced-setup uploads while it is enabled. Whether fork PR uploads work with the downgraded token is not verified.
- `RELEASE_ACKNOWLEDGED_DEPLOYMENTS` is read from an optional environment variable (`vars`) for operator reconciliation. It is unset by default.
- The scheduled all-severity summary is informative. High/critical app and release-tool audits are mandatory in both quality and scheduled security workflows, using the single exact-chain, expiring exception policy. Making lower-severity findings mandatory or adding coverage floors needs a measured baseline.
