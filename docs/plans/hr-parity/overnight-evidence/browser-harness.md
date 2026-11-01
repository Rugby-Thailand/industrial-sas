# browser-harness evidence

Status: active verification; not a completion claim. Updated during the lane.

Baseline full run completed at 22:24 Bangkok: `pnpm test:e2e:hr:local`, exit 1,
21 passed / 1 failed / 0 skipped (22 cases; 5.4 minutes). The failed mobile
holiday reload remained on the real app's `Loading Preparing this page` shell
for 30 seconds, rather than showing an incorrect saved value. Kept as a real
readiness failure. Private report and failure screenshot copied under
`.cache/hr-browser/baseline-full-*` before subsequent runs.

Coordinator steering: cherry-pick foundation `92fe30f0` then `857d9f8e` after
checkpointing this harness; add real Phase 1 browser tests and report the exact
foundation revision covered. Baseline full run above covers `a2e964e2` only.

Latest independent guard/seed run: exit 0, 21 tests / 2 files, including real
occupied IPv4 and IPv6 socket refusal. The first runner port preflight checked
only IPv6 and missed an IPv4 backend; a concurrent-run probe failed closed in
Convex itself, without stopping the original run. Fixed preflight checks both
families and a run lock; repeated probe now exits 1 with
`HR_E2E_PORT_IN_USE: 3100` before starting any service. Full normal lint, TSC,
format check and discovery (375 Vitest / 19 Playwright files) passed before
foundation integration. Final reporter/session cleanup will be exercised in
the foundation run.

- Checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-2a0c98b6`
- Branch: `t3/hr-playwright-harness`
- Base: `a2e964e2045269231fc0df429d52cc51f53e2658`
- Scoped commit: pending final verification.
- Scope: opt-in `playwright.hr-local.config.ts`, `tests/e2e/hr-local`, safe environment validation and owned-service runner. No production feature port, route, navigation policy, default smoke/release config, or original checkout edits.

## Environment and isolation

Read the original overnight plan, README local setup, dev-login/seed scripts, existing Playwright support, installed Next 16.3.8 environment/CLI guides, navigation contract/inventory, and original Phase 1 e2e source. Original Phase 1 company/branches/employment tests remain inactive: this checkout does not implement those screens.

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

Initial real desktop passes: authenticated employee read/reload, Cancel + next native Back with origin locale/query/hash, dirty native Back Keep/Discard, and unconfigured leave policy gate/reload. Second verification includes real clock and correction/settings/pending cases; full result pending. Initial clock attempt actually wrote clock-in/out, then failed an incorrect receipt locator; those server records are retained, not reset for a green test.

## Process ownership (active until final cleanup)

- Dependency install session 50271: exited 0.
- Failed first Convex setup session 65485: exited 1, no backend started (deployment name shape corrected).
- Convex session 75882: wrapper PID 65040, Convex CLI PID 65293, backend PID 68823. Worktree-owned ports 3320/3321. Active while tests run.
- Manual Next session 80735: CLI PID 88634, server PID 88971, wrapper 88319. Stopped CLI 88634 with SIGTERM before Playwright claimed port 3100; wrappers exited.
- Playwright initial session 87976: exited 1, Playwright-owned Next process stopped with runner teardown.
- Subsequent Playwright session 84636: running; Playwright owns its web server.
- Scoped ESLint initial session 72025: exited 1 (fixture callback named `use` triggered React hook lint; renamed without exemption).
- Vitest session 2504: exited 0.
- Normal lint session 93312 and navigation session 82892: exited 0.

Private ignored artifacts: `.cache/hr-browser/` logs and process journal, `test-results/hr-local/` report/failure screenshots, `playwright/.auth/` fixture IDs. Do not publish/upload these credentialed browser artifacts.

## Limits and port selection

Keep this harness independent of the foundation production port. Integrate its scoped commit after review, then add company/branch tests only against implemented features and deliberate seed data. This suite tests the existing baseline, not all 124 research fixmes. Leave submit/approval is intentionally not enabled by choosing an unreviewed legal policy; the real inactive-policy gate is covered. Current designated account is an HR/organization admin; anonymous denial and real tenant filtering do not establish lower-role coverage. Pending case uses the real Convex client with browser offline/reconnect, not a fake server response. Initial Next/Clerk cold readiness and development warnings are retained as limitations.
