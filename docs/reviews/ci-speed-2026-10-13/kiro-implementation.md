# Kiro implementation: B1 smoke credential boundary

Scope: `smokeEnvironment` in `scripts/release/lib/entrypoint.mjs` and its
regressions in `tests/integration/release-entrypoint.integration.test.ts`.
Worktree from `c425dd80`; no commit, push, deploy, provider call or secret read.

## Change

`smokeEnvironment(env, target)` now builds the Playwright child's inherited
environment from exact-name allowlists instead of copying the parent and
deleting known keys. Unknown targets throw.

- `SMOKE_SYSTEM_ENV` (both targets): `PATH`, `HOME`, `USER`, `TMPDIR`, `LANG`,
  `LC_ALL`, `TZ`, `TERM`, `CI`, `PNPM_HOME`, `XDG_CACHE_HOME`,
  `PLAYWRIGHT_BROWSERS_PATH`. `NODE_OPTIONS`/`BUN_OPTIONS` are excluded.
- `SMOKE_STAGING_ENV` (staging only): `GITHUB_ACTIONS`, `GITHUB_REPOSITORY`,
  `GITHUB_REF`, `GITHUB_EVENT_NAME`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`
  (exactly what `assertStagingInputs` checks) plus the documented fixture keys
  `CLERK_SECRET_KEY` and `CONVEX_DEPLOY_KEY`.

The caller (`run.mjs` `smoke()`, unchanged) still adds `SMOKE_PHASE`,
`SMOKE_BASE_URL`, `SMOKE_EXPECTED_SHA`, `SMOKE_DEPLOYMENT_ID`, `SMOKE_TARGET`,
`PLAYWRIGHT_JSON_OUTPUT_FILE` and, for staging, the refreshed
`STAGING_VERCEL_OIDC_TOKEN_FILE`. Ambient versions of those, the raw
`STAGING_VERCEL_OIDC_TOKEN`, `CONVEX_RELEASE_DEPLOY_KEY`, GitHub/Vercel/backup/
OIDC-request tokens and any prefix-shaped name (`GITHUB_*_TOKEN`,
`CLERK_*_SECRET_KEY`, `SMOKE_*_TOKEN`, …) are no longer inherited.

Behaviour changes versus `c425dd80`: production no longer inherits
`CLERK_SECRET_KEY` (the production job does not set it) or any other
non-essential variable.

## Sources inspected

`playwright.{staging,production}.config.ts`, `tests/e2e/support/{policy,release-env,protected-origin,protection,release-fixtures}.ts`,
`tests/e2e/staging/{support,global-setup}.ts`,
`tests/e2e/production/release-smoke.spec.ts`, the `staging`/`release` jobs in
`.github/workflows/quality.yml` (read only) and `.github/actions/setup-node-pnpm`.

## Evidence

| Check                                                                                       | Result                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `vitest run --project integration tests/integration/release-entrypoint.integration.test.ts` | 12/12 passed (was 8; 4 new, 1 updated)                                   |
| Same file against the previous denylist implementation                                      | 4 failed, 8 passed (the updated test and three new regressions catch it) |
| `browser-release-safety`, `release-orchestration`, `staging-flow` integration files         | 3 files, 116/116 passed                                                  |
| `eslint` and `prettier --check` on both owned files                                         | clean                                                                    |
| `tsc` (TS 6, root config) scoped to the test file                                           | no errors                                                                |

New regressions: renamed/prefixed/unknown secrets stripped for both targets
and allowlist contains no other secret-shaped name; staging output plus
caller fields passes the real `assertStagingInputs` with no problems and
`stagingProtection().readToken()` reads the refreshed file, not an ambient raw
token; a missing fixture key fails the staging check with exactly that name;
production output equals the system set exactly.

## Open interface points

- `SMOKE_IDENTITY_EMAIL` (optional production identity test) is no longer
  inherited. The workflow never sets it, and the test would also need Clerk
  testing credentials that production does not receive, so it stays skipped.
  Enabling it later needs an explicit, reviewed addition here.
- `PLAYWRIGHT_DIAGNOSTIC_RETRIES` and `STAGING_E2E_LOCAL_REHEARSAL` are not
  inherited; release runs need zero retries and run only under GitHub Actions.
- Non-Linux runner essentials (e.g. Windows `SYSTEMROOT`) are not included;
  release jobs run on `ubuntu-24.04`.
- `PLAYWRIGHT_BROWSERS_PATH` is allowlisted, so a release job moved into the
  Playwright container (`/ms-playwright`, as in the parallel
  `ci-speed-probe.yml` experiment) keeps finding its browsers.
- Not verified: a real staging/production Playwright run on the runner image
  (no provider calls in scope).
