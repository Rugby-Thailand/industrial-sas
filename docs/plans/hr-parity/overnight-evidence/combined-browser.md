# combined-browser evidence

Status: harness reviewed and integrated on the combined base; real browser suite
run against actual Next + worktree-owned loopback Convex + genuine Clerk TEST
identity. **No employee (slice 03) release-readiness claim**: F1–F6 remain open in
hardening task b34ea0d2, which had not delivered commits at handback. No test here
works around those findings.

## Source

- Checkout `/Users/macbook/.t3/worktrees/industrial-sas/t3-e6864960`, branch
  `t3/hr-browser-harness-validation`.
- Combined base fast-forwarded `a2e964e2..88c2f1d5` (13 commits, unchanged).
- Harness commits cherry-picked cleanly (no conflicts), foundation/protocol
  cherry-picks from the harness branch NOT duplicated:
  `b2054a71`→`5e4fa090`, `85d29bf6`→`12bbe970`, `052a9877`→`1bd98f03`,
  `b584f1ba`→`ed1bf4ee`.
- Incremental commits from this lane (distinct from source dependencies):
  - `a2c3ed32` fix(hr-e2e): wildcard listener refusal, dirty-source metadata,
    zero-write clock case reported as skipped.
  - `03795a87` test(hr-e2e): HR employee / supervisor role coverage with the
    genuine identity (guarded local role fixture).
  - final docs commit: this file (records results; no code change after run 2).

## Independent harness findings

| #   | Severity                     | Finding                                                                                                                                                                                                                                                                   | Reproducer                                                                                                                                                                                                                                                                                                                                               | Resolution                                                                                                                                                                                   |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Material                     | Port preflight (`scripts/lib/hr-e2e-ports.mjs`) bound only `127.0.0.1` and `::1`. On macOS an exact loopback bind succeeds beside another process's `0.0.0.0`/`::` listener, which is the Node/Next default bind, so occupied ports were reported free.                   | Node listeners with no host, `0.0.0.0`, `::`, `::` ipv6Only, and Python no-SO_REUSEADDR `0.0.0.0`/`::` all returned FREE from the original guard; loopback-specific listeners were refused. Added `it.each` cases for `0.0.0.0` and `::` in `tests/integration/hr-e2e-environment.integration.test.ts`: against original guard **2 failed / 19 passed**. | Loopback connect probe plus specific and wildcard bind checks. Same probes all refused; regression file green (23/23 with seed file). `a2c3ed32`.                                            |
| H2  | Material (evidence validity) | `workflows.spec.ts` clock case counted as passed with zero clock actions once the single daily cycle was consumed. In every fresh run the mobile project follows desktop on the same employee/day, so the historic 38/38 credited one case that performed no clock write. | Run 1 annotation `real-clock-writes` = 2 desktop / 0 mobile.                                                                                                                                                                                                                                                                                             | Case now calls `test.skip` with an explicit reason when no clock action ran (retained timestamps are still asserted first). Correct fresh-run ceiling: N passed / **1 skipped**. `a2c3ed32`. |
| H3  | Minor                        | Report metadata recorded HEAD only; a dirty tree would carry an exact-looking but inexact SHA.                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                        | `sourceDirty` metadata from `git status --porcelain`. Both runs below recorded `sourceDirty: false`.                                                                                         |

Reviewed without finding a defect: fail-closed env guard (exact loopback URLs,
`anonymous:` deployment, `sk_test_`/`pk_test_` with issuer-host match, refusal of
deploy/admin/self-hosted/Clerk API overrides, ambient-vs-file conflict refusal);
run lock (`wx`, refuses stale lock, removed only by its owner); process-group-only
signalling of groups the runner spawned; backend instance/config/port check before
seeding; seed functions internal + `ALLOW_LOCAL_TEST_SEED` + loopback +
confirmation; `localRun` allowlist; Clerk user-by-email and org-membership
verification before any sign-in ticket; per-test revocation of only the created
session; console reporter emits static titles/statuses only; artifacts under
ignored `test-results/`, `playwright/.auth/`, `.cache/`. Specs perform real UI
actions and reload/backend read-backs; direct registered-API calls (legacy
client shape, logo ABA) use the real Clerk Convex JWT and are disclosed as such.
The only injection is delaying editor A's genuine `File.arrayBuffer` in the logo
protocol case and `context.setOffline` in the pending-save case; auth, backend and
network transport remain real. Discovery: `--list` skips env loading only for
listing; no CI exclusion or file exemption was added.

## Lower-role coverage (new)

`convex/staging/hrDemo.ts` `setLocalTestRoles` (internal; same guard as the seed;
only a `local-membership-*` bootstrap membership; only ORG_ADMIN / HR_ADMIN /
HR_SUPERVISOR / HR_EMPLOYEE; returns previous grants). `roles.spec.ts` uses the
same verified Clerk account, asserts the starting grants are exactly
ORG_ADMIN+HR_ADMIN+HR_EMPLOYEE, lowers them, and restores the exact previous grants
in `finally` (asserting the restore result), then re-verifies admin UI access.

- HR employee only: My day + `hr/self:today` work; backend
  `AUTHORIZATION_DENIED` for `hr/setup:employeesPage`, `hr/org:getCompanyProfile`,
  `hr/org:saveDepartment` and `hr/review:queue`; employees/settings/review pages
  show `hr-denied`, no Add employee/company form; denied department never persisted.
- HR supervisor + employee: review page renders, `hr/review:queue` ok; admin
  reads/writes/pages denied as above.
- Mutation check: granting HR_ADMIN in the employee case made it fail
  (`Expected: "AUTHORIZATION_DENIED"`), exit 1, retained as evidence.
- Integration (convex-test): refuses without seed flag; refuses a non-local
  (webhook-style) membership; lowers/restores and checks real handler denial.
  Anonymous denial is NOT counted as lower-role coverage.

## Real browser runs (actual Next + loopback Convex + genuine Clerk TEST)

Designated identity `local.tester@example.com` / pinned user+org, verified via
the Clerk backend before seeding. Allowlisted test keys/issuer only (privately
copied into this checkout's ignored `.env.local`, 9 fixed names, no other env
values copied). Fresh worktree-owned anonymous Convex DB created by run 1 on
3320/3321 (`precompiled-2026-10-06-a3538c6`); Next dev on localhost:3100 with
`.next-e2e`. Chromium Desktop Chrome + Pixel 7 emulation (not a physical
device), English/Bangkok, workers 1, retries 0.

| Run | Command                                                                         | Source                                                                                   | Exit  | Result                                                                           | Duration |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- | -------- |
| 1   | `pnpm test:e2e:hr:local` (fresh DB)                                             | `a2c3ed32e93cfb92df52fad2118fc87373f612e0`, `sourceDirty:false`                          | 0     | **38 cases / 4 files: 37 passed, 0 failed, 1 skipped** (mobile clock: 0 actions) | 491.0 s  |
| R   | `pnpm test:e2e:hr:local roles.spec.ts`                                          | `a2c3ed32` + uncommitted role fixture (dirty; identical content committed as `03795a87`) | 0     | 4 passed (desktop+mobile)                                                        | ~2 min   |
| M   | same, `--project hr-desktop --grep "HR employee"`, deliberate HR_ADMIN mutation | dirty, mutation reverted afterwards                                                      | 1     | 1 failed as intended (`Expected: "AUTHORIZATION_DENIED"`)                        | ~1.5 min |
| 2   | `pnpm test:e2e:hr:local` (DB reused from run 1, same day)                       | `03795a87bf953b86396075c9e31ed2d5570a68f2`, `sourceDirty:false`                          | **1** | **42 cases / 5 files: 39 passed, 1 failed, 2 skipped**, 0 flaky                  | 788.95 s |

Run 2 details:

- **Failure (retained, not rerun to green):** `hr-desktop` "roles HR employee keeps
  self-service while real backend denies admin reads, writes and pages",
  43.9 s. After roles were lowered, `page.goto("/en/hr/today")` showed the Clerk
  **Sign in** page; `My day` heading not found within 30 s. A role denial
  renders the in-app `hr-denied` notice, not a sign-in redirect, so this is a
  genuine Clerk browser-session loss at that moment; cause not established. The
  same case passed on mobile in run 2 and on both projects in run R. The
  `finally` restore ran (a failed restore would replace the error) and later
  role cases asserted the exact admin grants at start. Observation only: the
  designated account had concurrent non-lane Safari/Chrome-on-macOS sign-ins
  around that time (e.g. 23:44:57); no causal claim.
- **Skips (2):** desktop and mobile clock cases, both `real-clock-writes: 0`;
  run 1 had already consumed today's single clock cycle in this DB. Retained
  timestamps were asserted, but these are no-action skips, not clock coverage.
- All other 39 cases passed, including all 4 role cases except the failure above
  (3 of 4 passed), Phase 1 foundation, protocol, workflows and baseline cases.
- Real clock writes in this lane: **2** (run 1 desktop clock-in + clock-out).

The historical "38/38 on `052a9877`" from the source lane counted one zero-action
clock case as passed (H2); the corrected fresh-run figure is 37 passed / 1 skipped.

## Serialized gates (no browser runner active)

| Command                                                                                                                                                  | Exit | Outcome                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `node scripts/ci/install-bun-checker.mjs`                                                                                                                | 0    | Bun 1.4.3 / TS 7.0.2, zip sha256 `80afd4c0…3403`, into ignored `.cache/bun-checker/` |
| `pnpm typecheck` (first attempt)                                                                                                                         | 1    | my PATH error (pointed at parent dir): "bun 1.4.3 is not on PATH"; no type result    |
| `pnpm typecheck` (pinned Bun first on PATH)                                                                                                              | 0    | No type errors in 1,109 files                                                        |
| `pnpm typecheck:ts6`                                                                                                                                     | 0    | passed                                                                               |
| `pnpm lint`                                                                                                                                              | 0    | `eslint . --max-warnings=0`                                                          |
| `pnpm check:navigation`                                                                                                                                  | 0    | 68 Node fixtures; 58 route/error policies; 304 owners; 26 intents                    |
| `pnpm ci:test-discovery`                                                                                                                                 | 0    | 386 Vitest files, 22 Playwright spec files                                           |
| `prettier --check` on the 19 files changed since `88c2f1d5`                                                                                              | 0    | clean (first invocation exit 2 was my zsh argument-splitting error)                  |
| `git diff --check 88c2f1d5 HEAD`                                                                                                                         | 0    | clean                                                                                |
| focused Vitest: env guard, HR + annex seed, combined-integration, 01-org-positions, org model, HrOrgSettings, EmployeeForm.employment (`--maxWorkers=2`) | 0    | **8 files / 123 tests passed** (convex-test/jsdom, separate from browser)            |

Earlier in the lane: guard + seed files 23/23 then 24/24 (with the role test).
Not run: full repository Vitest suite, production build.

## Cleanup

- Runner journal `.cache/hr-browser/processes.jsonl`: 4 invocations, 16 process
  groups (Convex 50767/60867/63710/64888, Playwright 50822/61053/63735/64917,
  plus 8 short `convex env set` commands); every group has exit + cleanup
  records, none alive. No survivor process with this checkout as cwd. No
  listener on 3100/3320/3321; no run lock. Other lanes' services (e.g. 3140,
  3340, 3350) were observed and not touched.
- Clerk: each test revoked the session it created in `finally`. The designated
  user's 6 active sessions created after 23:20 are Safari/Chrome on macOS; this
  suite's browsers present Windows (Desktop Chrome) and Android (Pixel 7) user
  agents, so none are attributed to this lane and none were revoked. No Clerk
  user/membership changes.
- Local roles: restored to ORG_ADMIN + HR_ADMIN + HR_EMPLOYEE (last role case in
  run 2 asserted restore). Retained private local DB under ignored `.convex/`.
- Private, unpublished: `.cache/hr-browser/` (logs, journal,
  `run2-failed-report.json`), `test-results/hr-local/` (incl. failure screenshot),
  `playwright/.auth/`. No secrets in commits/reports.

## Limitations and dependency

- Employee hardening (b34ea0d2) arrived only after this checkpoint scope was
  closed; it is **not integrated or tested here**. Employee profile/payment
  persistence, dirty/pending query refresh, lost-response recovery and
  offboard/overnight browser cases remain for the follow-up acceptance task.
- Leave submission/approval, Thai UI, physical devices, production build not covered.
- Run 2 is red (1 failure) and is reported as such.
