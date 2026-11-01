# browser-harness evidence

Status: active combined verification. **Not release-ready**: independent review
found old-client field loss and stale logo commands; correction protocols pending.

## Foundation integration and current results

- Harness checkpoint: `b2054a71`.
- Authorized source `92fe30f0` and `857d9f8e` cherry-picked as `84cc04e7` and `c2b19ec1`.
- Parent shape fix `eb5542ac` cherry-picked as **`d1577678da79032f5fe8c782b4ef826a188d8b47`**.
- No original production implementation was written in this lane. The production
  changes here are those authorized cherry-picks; scoped browser additions pending commit.
- Read foundation evidence and the independent review in checkout `t3-e98679ab`.
- Combined command: `pnpm test:e2e:hr:local`, 34 cases, production source
  **`d1577678da79032f5fe8c782b4ef826a188d8b47`**: exit 1, **33 passed / 1 failed /
  0 skipped**, including all 12 Phase 1 cases passed. The mobile Forward case failed.
  It did not assert route commitment before traversal. Added explicit editor/list/
  restored URL assertions to distinguish test synchronization from navigation defects;
  `pnpm test:e2e:hr:local --grep 'employee selection survives'` then exited 0,
  2 passed / 0 failed / 0 skipped (desktop + mobile) on the same production head.
  The full failed run is retained; rapid unsettled traversal is not claimed fixed.

| Actual command                                                                                                                                                                       | Exit | Measured outcome                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------- |
| `pnpm test:e2e:hr:local foundation.spec.ts --project hr-desktop`                                                                                                                     | 1    | 5 passed / 1 failed; `c2b19ec1`                                           |
| `pnpm test:e2e:hr:local foundation.spec.ts` (first matrix)                                                                                                                           | 1    | 10 passed / 2 failed / 0 skipped; `c2b19ec1`                              |
| `pnpm test:e2e:hr:local --project hr-mobile --grep 'Phase1 company\|Phase1 masters\|employee create'`                                                                                | 1    | 2 passed / 1 failed; company and expanded employment passed; `d1577678`   |
| `pnpm test:e2e:hr:local --project hr-mobile --grep 'employee create\|pending employee'`                                                                                              | 0    | 2 passed / 0 failed / 0 skipped; `d1577678`                               |
| `pnpm exec vitest run tests/integration/hr-e2e-environment.integration.test.ts tests/integration/hr-demo-seed.integration.test.ts` (latest guard run)                                | 0    | 2 files / 21 tests passed, including real occupied IPv4/IPv6 sockets      |
| same plus `tests/integration/hr-parity/01-org-positions.test.ts convex/model/hr/org.test.ts src/features/hr/HrOrgSettings.test.tsx src/features/hr/EmployeeForm.employment.test.tsx` | 0    | 6 files / 97 tests passed; model/Convex-test/jsdom, separate from browser |
| `pnpm check:navigation` after foundation integration                                                                                                                                 | 0    | 68 Node fixtures; 58 route/error policies, 301 owners, 26 action intents  |
| `pnpm lint` after foundation integration                                                                                                                                             | 0    | Normal repository ESLint passed                                           |
| `pnpm exec tsc --noEmit --pretty false` after foundation integration                                                                                                                 | 0    | Passed                                                                    |
| `pnpm ci:test-discovery`                                                                                                                                                             | 0    | 379 Vitest files / 20 Playwright spec files                               |

Concurrent runner probe exited 1 as expected with `HR_E2E_RUN_LOCKED`, without
starting or stopping any service. `pnpm typecheck:ts6` run concurrently with the
browser recheck exited 2 because `.next-e2e/dev/types` files disappeared while TSC
was reading them. No source errors were reported. The serial idle rerun of
`pnpm typecheck:ts6` exited 0. Mutable Next type generation and type checking must
be serialized in this checkout. Latest normal `pnpm lint` also exited 0.

Failed attempts remain failures. Counts overlap and must not be added as unique coverage.
Phase 1 cases cover company/bank persistence, real PNG upload/readback/removal,
branch write/reload/completion, nested branch dirty/Cancel dismissal, master creation,
department/position/level/branch/workplace assignment, fixed-term/probation persistence
and edits, and legacy **unassigned** employee editing. Both browser projects use
English/Bangkok; mobile is Pixel 7 Chromium emulation, not a physical device.

The first company test used a direct `page.goto` hub entry without referrer and tried
to use a nonexistent synthetic header Back. It now enters through the actual settings
sidebar link, preserving real origin query/hash. The mobile menu helper originally
probed visibility before hydration; it now waits for the known mobile menu control.
Revised company cases passed. An immediate mobile refresh after employee form closure
reopened `mode=new`: form disappearance precedes owned history traversal by a frame.
Tests now additionally assert removal of editor URL parameters and retained list query
before reload; revised employment passed. Baseline new employees now choose and verify
real active master options rather than inferring requiredness from a visual asterisk.
Revised mobile create/edit and pending save passed. These are stronger harness checks,
not source fixes or relaxed assertions.

Current fixtures revoke only their own created Clerk session, including on failure.
Console reporting emits static titles/statuses and omits SDK diagnostics/token URLs;
full diagnostics stay private. Successful company, branch, employment and employee
cases save private screenshots. A bounded cleanup identified 23 earlier owned sessions
from private harness request logs, verified user/time, and revoked exactly those;
no identifiers were printed and no unrelated sessions touched.

Node 24.19.0 / pnpm 10.33.2 / Next 16.3.8 / Playwright 1.62.1. Next uses its documented
Node fallback and isolated `.next-e2e`. No production build, physical-device, Thai UI,
active leave submission/approval or non-admin authenticated coverage is claimed.
The review's old-client omission and stale logo races remain unverified until the
correction protocol lands. A green current combined run would not establish release readiness.

Baseline full run completed at 22:24 Bangkok: `pnpm test:e2e:hr:local`, exit 1,
21 passed / 1 failed / 0 skipped (22 cases; 5.4 minutes). The failed mobile
holiday reload remained on the real app's `Loading Preparing this page` shell
for 30 seconds, rather than showing an incorrect saved value. Kept as a real
readiness failure. Private report and failure screenshot copied under
`.cache/hr-browser/baseline-full-*` before subsequent runs.

The baseline full run above covers `a2e964e2` only; later foundation results are
separately identified above. Reports/screenshots are retained per run under the
ignored `.cache/hr-browser/` directory before the next run replaces the latest output.

Latest independent guard/seed run: exit 0, 21 tests / 2 files, including real
occupied IPv4 and IPv6 socket refusal. The first runner port preflight checked
only IPv6 and missed an IPv4 backend; a concurrent-run probe failed closed in
Convex itself, without stopping the original run. Fixed preflight checks both
families and a run lock; repeated probe now exits 1 with
`HR_E2E_PORT_IN_USE: 3100` before starting any service. Full normal lint, TSC,
format check and discovery (375 Vitest / 19 Playwright files) passed before
foundation integration. Reporter/session cleanup was subsequently exercised by the
real foundation and focused mobile runs above.

- Checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-2a0c98b6`
- Branch: `t3/hr-playwright-harness`
- Base: `a2e964e2045269231fc0df429d52cc51f53e2658`
- Scoped commit: checkpoint `b2054a71`; Phase 1 browser additions pending final verification.
- Scope: opt-in config, HR browser tests, guarded seed/auth support and owned-service runner; authorized foundation cherry-picks as listed above. No default smoke/release config or original checkout edits.

## Environment and isolation

Read the original overnight plan, README local setup, dev-login/seed scripts, existing Playwright support, installed Next 16.3.8 environment/CLI guides, navigation contract/inventory, and original Phase 1 e2e source. The original fixmes remain inactive; new bounded tests cover the implemented foundation controls.

Verified the exact designated `local.tester@example.com` Clerk test account and its exact configured organization membership through the real Clerk backend API. Reused only existing test-key/issuer settings, privately allowlisted into this checkout's ignored `.env.local`; no secret values are reported. No fake authentication, mock backend, production deployment, or HRZoft writes.

Fresh worktree-owned anonymous Convex database on ports 3320/3321; real Next app on localhost:3100. The original checkout's local database was not reused. Guards require exact loopback URLs, test-key/issuer consistency, seed opt-in, matching worktree state and running backend instance. Remote/production selectors and ambient credential overrides are refused. Foreign fixture organization contains seeded HR records but no fabricated Clerk session is issued for it. Only the positively verified account authenticates.

## Actual commands so far

| Command                                                                                                                            | Result                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                   | exit 0, 900 packages installed                                                                             |
| `pnpm exec playwright test --config playwright.hr-local.config.ts --list` (initial suite)                                          | exit 0, 12 executable cases discovered; discovery is not a browser pass                                    |
| `pnpm exec vitest run tests/integration/hr-e2e-environment.integration.test.ts tests/integration/hr-demo-seed.integration.test.ts` | exit 0, 2 files / 19 tests passed; guard/convex-test coverage, separate from browser evidence              |
| `pnpm exec playwright test --config playwright.hr-local.config.ts --project hr-desktop` (initial baseline)                         | exit 1, 4 passed / 2 failed; foreign-response assertion corrected, employee final reload was still loading |
| `pnpm lint`                                                                                                                        | exit 0 at initial harness revision                                                                         |
| `pnpm check:navigation`                                                                                                            | exit 0; 68 Node fixtures, 58 route/error policies, 292 owners, 26 navigation intents                       |

Initial real desktop passes: authenticated employee read/reload, Cancel + next native Back with origin locale/query/hash, dirty native Back Keep/Discard, and unconfigured leave policy gate/reload. Expanded desktop run exited 1 with 8 passed / 2 failed. Initial clock attempt actually wrote clock-in/out, then failed an incorrect receipt locator; records were retained, not reset for a green test. Later same-day clock cases report zero new writes through their annotations and assert retained server timestamps.

## Process ownership (active until final cleanup)

- Dependency install session 50271: exited 0.
- Failed first Convex setup session 65485: exited 1, no backend started (deployment name shape corrected).
- Convex session 75882: wrapper PID 65040, Convex CLI PID 65293, backend PID 68823. Stopped CLI 65293 with SIGTERM after baseline runs; ports 3320/3321 had no listener before the owned runner started.
- Manual Next session 80735: CLI PID 88634, server PID 88971, wrapper 88319. Stopped CLI 88634 with SIGTERM before Playwright claimed port 3100; wrappers exited.
- Playwright initial session 87976: exited 1, Playwright-owned Next process stopped with runner teardown.
- Subsequent Playwright session 84636: exited 1; its owned Next server stopped.
- Scoped ESLint initial session 72025: exited 1 (fixture callback named `use` triggered React hook lint; renamed without exemption).
- Vitest session 2504: exited 0.
- Normal lint session 93312 and navigation session 82892: exited 0.
- Owned runner journals every PID/start/exit/cleanup in `.cache/hr-browser/processes.jsonl`. Completed groups include Convex 57901 / Playwright 58064 (baseline), Convex 58973 (failed preflight probe), Convex 69687 / Playwright 69727 (foundation desktop), Convex 73133 / Playwright 73155 (foundation matrix). Each has cleanup records. Later focused/current groups are in the same journal; final no-listener/process verification pending.

Private ignored artifacts: `.cache/hr-browser/` logs and process journal, `test-results/hr-local/` report/failure screenshots, `playwright/.auth/` fixture IDs. Do not publish/upload these credentialed browser artifacts.

## Limits and port selection

Integrate the scoped harness commits alongside the specified foundation dependencies after review. This suite does not establish all 124 research fixmes or 222 parity rows. Leave submission/approval is not enabled by choosing an unreviewed legal policy; the real inactive-policy gate is covered. The designated account is an HR/organization admin; anonymous denial and tenant filtering do not establish lower-role coverage. Pending cases use real Convex offline/reconnect, not fake responses. Initial app readiness timeouts are observations without an established cause.
