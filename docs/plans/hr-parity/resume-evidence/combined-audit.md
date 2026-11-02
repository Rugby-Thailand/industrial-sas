# Combined HR audit — resume stage, 2026-11-02

Auditor: Claude Opus 5.5 via Kiro CLI (replacement for the failed Claude connection). Checkout `/Users/macbook/.t3/worktrees/industrial-sas/t3-513a7554`, branch `t3/hr-parity-recovery-audit`, base `281c1e75ec288138b3b10a2d6351efe97c120b65` (clean at start). All changes below are **uncommitted** for the coordinator's review; `281c1e75` and earlier history are untouched. No push, deploy, branch switch, worktree, delegate, browser harness, Next server or Convex dev server was started. Ports 3100/3320/3321 were not used (a `convex-local-backend` on :3320, PID 46698, belongs to checkout `t3-ad7b5fc0` and was left alone).

Logs referenced as `runs/…` live in `docs/plans/hr-parity/resume-evidence/runs/` (git-ignored, retained, including failed runs). Commands and timings are in `process-journal.md`.

## 1. Audit of `281c1e75` (employee write recovery)

Verdict: correct for the reported defect; no change made.

- **Stable durable identity.** The sessionStorage key is `hr-request:<identityKey>|<intent>` where intent is `employee-profile:<employeeId>:<section>`, `employee-payment:<employeeId>` or `employee-lifecycle:<employeeId>` (`EmployeeProfileSections.tsx`). No server version is in the key, so a COMMITTED write that advances the version leaves the record reachable after reload. Lifecycle uses one key per employee, so an unknown OFFBOARD also blocks Reinstate/Confirm until checked.
- **Fencing.** Actor and tenant: `identityKey` from `HrAccessProvider` prefixes the key (test "durable payment recovery is private to its actor…"). Employee and operation: in the intent; the stored record also carries `operation`. Server side, `convex/hr/recovery.ts` resolves by `(org, operation, requestId)`, refuses another actor's receipt (`NOT_FOUND`), and writes a permanent actor-scoped fence before answering FENCED, so a late original command cannot apply afterwards (`hrCommand` checks the fence first). The server does not bind the request to an employee; the random request ID is only ever stored under one employee key, so this is not exploitable through the client, but it is not a server-enforced employee fence.
- **Captured version.** `revision` (the opened `expectedVersion`) is stored with the request ID and the in-session pinned command keeps resending the original revision and request ID (test "a lost payment response retried after query refresh…"). After reload nothing is resent; only status reconciliation is offered.
- **Private payload.** Profile/payment/lifecycle forms call `submit` without a payload, so the record has exactly `version, requestId, operation, revision` (asserted by key list; draft text and the account number are asserted absent from session and local storage).
- **No unsafe replay.** After reload `owner.command` is absent and no payload is stored, so `retry` returns UNCERTAIN and only "Check previous write" (reconcile) is available; the original mutation mock is asserted called once.
- **Tests meaningful.** Red log `runs/payment-recovery-red.log` (7 failures before the fix: COMMITTED/FENCED × personal/payment/lifecycle and the actor case), green `runs/payment-recovery-green.log` (37/37). Rerun in this pass inside `runs/employee-callers.log` (165/165) and `runs/hr-broad.log`.
- Residual, not fixed: records written by older builds under the old version-suffixed keys become unreachable (session-scoped, pre-release); the real-browser COMMITTED-reload case still needs Sol's rerun on this source.

## 2. Pending leave versus later roster change

### Reproduction (confirmed)

The retained probe (`t3-dc4094fa/.../repro/hr-roster-leave.integration.test.ts.txt`) was copied unchanged into `tests/integration/`, run against the unmodified source and deleted again. Result `runs/roster-leave-probe-red.log`: the roster OFF on the pending request's working date was **written**, and approval then returned `written: true` (it wrote the request's captured SCHEDULED plan over the date and consumed the day) instead of refusing.

### Semantics chosen

Existing domain rule (roster header and `hr-policy-leave` test "pins the old request policy and day plan…"): a request's captured plan is authoritative and approval records it; the roster already refuses dates whose plan is captured (recorded day, closed period, frozen row). A pending request's claimed working dates are captured plans too, but the roster did not check them. So:

1. **Roster refusal** (`convex/hr/roster.ts`). `assignRoster` reads each selected employee's `hrLeaveDayClaims` for the month in one bounded range read (`leaveClaimedDates`) and refuses SHIFT, OFF and Clear on any claimed date with `ROSTER_DAY_LEAVE_CLAIMED`. Validation precedes all writes, so a batch with one claimed cell writes nothing. The roster query reports such cells with lock `LEAVE_CLAIMED` so the grid disables them. Claims exist while a request is PENDING, APPROVED or CANCELLATION_REQUESTED and are released on withdraw/return/cancel; approved dates are already refused as `ROSTER_DAY_RECORDED`.
2. **Approval employment check** (`convex/hr/leave.ts` `decide`, APPROVE). Before any write, each claimed date must still be inside employment (`isEmployedOn(employmentOf(employee), date)`, the gap-aware predicate). A separation/reinstatement recorded after submission that leaves a date in the gap refuses the whole approval with `LEAVE_EMPLOYMENT_CHANGED`; nothing is recorded or charged.
3. Messages added in `messages/en.json` and `messages/th.json` (`Hr.errors.ROSTER_DAY_LEAVE_CLAIMED`, `Hr.errors.LEAVE_EMPLOYMENT_CHANGED`, `Hr.shifts.locks.LEAVE_CLAIMED`).

Rejected attempt (retained as `runs/affected-after-1-plan-revalidation-broke-pin-test.log`): approval-time revalidation of every captured plan against the live plan (`LEAVE_PLAN_STALE`, the probe's expected code). It contradicted the existing pinned-plan test (a weekly-schedule edit after submission must not change the approved plan). It was removed rather than changing that test, because overriding the existing semantics would be an invented rule.

### Tests

`tests/integration/hr-parity/04-roster-leave-consistency.test.ts` (new, registered handlers on convex-test, adapted from the probe):

- `roster %s on a date claimed by a pending leave request is refused for the whole batch and approval keeps the captured plan` × OFF/SHIFT/CLEAR: lock `LEAVE_CLAIMED`; mixed batch refused with zero roster rows; approval records the captured 08:30–17:30 plan, `used 1 / reserved 0`; afterwards lock `RECORDED` and `ROSTER_DAY_RECORDED`; the unclaimed neighbour stays assignable.
- `a withdrawn pending request releases its claim so the roster can change the date again`.
- `approval refuses atomically when a later separation and reinstatement left one pending date outside employment`: three-day request, exit after day 2, return after day 3; approval refused, no attendance days, `reserved 3`, request still PENDING v1.

Red/green: `runs/roster-leave-red-final.log` (server fix temporarily removed via saved patch: 4 failed / 1 passed; the withdraw case passes on the old code as expected), green in `runs/roster-leave-final-green.log`, `runs/affected-after.log` and `runs/hr-broad.log`. Earlier retained setup failures: `roster-leave-red-fixture-missing-holidays.log` (fixture omitted the holiday calendar), `roster-leave-red-1-lifecycle-date-future.log` (reinstatement date in the future). `roster-leave-green.log` is the superseded green run of the rejected variant.

UI: `src/features/hr/ShiftsRoster.test.tsx` adds `a date covered by a pending leave request is shown locked and cannot be selected` (`runs/shifts-roster-ui.log`, 15/15).

## 3. Verification of carried roster/employee fixes

- **1550-cell production limit** (`f673ece0`): `04-shifts-roster-limits.test.ts` runs with convex-test deployed transaction limits and still passes with the added per-employee claim read (`runs/limits-after-lint-fix.log`, `runs/affected-after.log`). The file had a pre-existing ESLint error (`import()` type annotation) that made `pnpm lint` fail; fixed with a type-only import (`runs/lint-1-preexisting-limits-import-type.log` → `runs/lint.log`).
- **Locked selection deselect** (`1ff1e1d0`): `a selected cell that becomes locked can be removed while retaining the other observed revisions` passes.
- **Catalogue 99** (`15204919`): `MAX_SITE_SHIFTS = 99`, `SHIFT_LIMIT_EXCEEDED` copy states 99 in en/th, supervisor test uses the constant.
- **Employee absent-gap detail and unrelated draft completion** (`63c56597`): `EmployeeGapDetails.test.tsx` and the EmployeeProfileSections completion cases pass (`runs/employee-callers.log`).
- **Thai catalogue gate** (pre-existing since `4f776c11`): `src/i18n/messages.test.ts` "has Thai characters in Thai prose messages" failed on `Hr.shifts.shiftOption`, `Hr.shifts.off` and `Hr.shifts.cellLabel` (`runs/hr-broad-1-preexisting-thai-shiftOption.log`, `runs/i18n-after-1-more-preexisting-thai.log`). Thai strings now `{code} · {start}–{end} น.` (matches the existing `{start}–{end} น.` convention), `OFF (หยุด)` (keeps the demo's OFF code) and `{employee} วันที่ {date}: {value}`. No test exemption was added. Coordinator may prefer different Thai wording.

## 4. Feature matrix

`feature-matrix.md` and `feature-matrix.json` (227 rows: 222 research rows plus 5 cross-cutting rows; fields `feature, slice, implementationStatus, verificationLevel, evidence, remaining`). Generator kept as `feature-matrix-generator.mjs.txt`. Slices 01–04 are mapped to code/tests in this branch; slices 05–09 repeat the research "We have today" column, labelled as not re-verified. Explicitly marked: work rules are settings-only (backend storage, no UI, every execution flag INACTIVE/UNSUPPORTED); payroll and OT calculation engine missing; employee fields/layout partial; roster FIXED-only; no browser test for leave approval or roster. No percentage is given.

## 5. Gates (final source unless noted)

| Check                                                                                                                                                   | Result                                                                                                    | Log                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| New regression file                                                                                                                                     | 5/5                                                                                                       | `runs/roster-leave-final-green.log`                    |
| Affected leave/roster/shared suites, maxWorkers 2 (38 files)                                                                                            | 639/639                                                                                                   | `runs/affected-after.log`                              |
| Employee/recovery callers (10 files)                                                                                                                    | 165/165                                                                                                   | `runs/employee-callers.log`                            |
| Broad HR set: `src/features/hr`, `tests/integration/hr-*`, `tests/integration/hr-parity`, `convex/model/hr`, `src/i18n`, `resolveWriteError` (89 files) | 967/967                                                                                                   | `runs/hr-broad.log`                                    |
| `pnpm lint` (normal)                                                                                                                                    | exit 0                                                                                                    | `runs/lint.log` (final rerun in `runs/lint-final.log`) |
| `pnpm check:navigation`                                                                                                                                 | exit 0 (60 policies, 309 owners, 26 intents)                                                              | `runs/navigation.log`                                  |
| `pnpm typecheck` (pinned Bun 1.4.3 / TS 7.0.2, installed repo-locally into ignored `.cache/bun-checker`)                                                | exit 0, 1,114 files                                                                                       | `runs/typecheck-bun.log`                               |
| `pnpm typecheck:ts6`                                                                                                                                    | exit 0                                                                                                    | `runs/typecheck-ts6.log`                               |
| `pnpm ci:codegen` (owned throwaway backend, ephemeral loopback ports, stopped by the script)                                                            | `_generated` matches                                                                                      | `runs/codegen.log`                                     |
| `pnpm ci:test-discovery`                                                                                                                                | OK (396 Vitest, 24 Playwright) after `git add -N` of the new test (intent-to-add only, nothing committed) | `runs/discovery.log`                                   |
| Credential-free `env -i … CI=1 CI_EXTERNAL_TYPECHECK=1 pnpm build`                                                                                      | exit 0                                                                                                    | `runs/build.log`                                       |
| Prettier on changed files                                                                                                                               | clean                                                                                                     | `runs/prettier-final.log`                              |

Navigation: no route, foreground view, editor closure or completion changed. The roster lock is a cell-disabled state inside the existing assignment step, so the Back inventory was not edited. Runtime Back/Cancel/Forward/refresh caller cases in `ShiftsRoster.test.tsx` and the employee files were rerun and pass. Full `pnpm test` (whole repository) was not run.

## 6. Exact changes (uncommitted)

- `convex/hr/roster.ts`: `leaveClaimedDates` helper; claim guard in `assignRoster`; `LEAVE_CLAIMED` lock in `roster`; header comment.
- `convex/hr/leave.ts`: employment check in `decide` APPROVE validation loop.
- `messages/en.json`, `messages/th.json`: three new keys each; Thai `Hr.shifts.shiftOption`, `off`, `cellLabel`.
- `tests/integration/hr-parity/04-roster-leave-consistency.test.ts` (new, intent-to-add).
- `tests/integration/hr-parity/04-shifts-roster-limits.test.ts`: type-only import (lint).
- `src/features/hr/ShiftsRoster.test.tsx`: one lock case.
- `docs/plans/hr-parity/resume-evidence/`: this file, `feature-matrix.{md,json}`, `feature-matrix-generator.mjs.txt`, `tutorial-storyboard.md`, `process-journal.md` entries.

## 7. Limitations and remaining work

- No browser verification of anything in this pass. Sol must rerun employee COMMITTED-reload recovery, lifecycle and mobile, and there is still no roster or leave-approval browser spec.
- A site holiday or weekly-schedule edit after submission is still accepted, and approval records the captured plan (pinned semantics, including charging a day that has since become a holiday). Holiday save also does not check recorded days. Whether those edits should be refused like roster changes is a product decision; not invented here.
- A pending request whose dates fall outside employment after offboarding cannot be approved. Its reservation stays until it is withdrawn or returned. Statutory types cannot be returned by a reviewer, so the employee (or a later HR action) must withdraw it. Final leave settlement (S03-22) is missing.
- Unclaimed non-working dates inside a pending request's range (for example a weekend) remain assignable; approval never records or charges them.
- Server reconcile is actor/tenant/operation fenced but not employee bound (see §1).
- The tutorial storyboard is a plan; no footage exists and gated shots depend on acceptance.
