# Independent HR baseline acceptance — November 2, 2026

This is the newly authorized first-stage test deliverable, not an overnight
deadline continuation. Work is local in the T3-prepared checkout
`/Users/macbook/.t3/worktrees/industrial-sas/t3-ad7b5fc0`, branch
`t3/hr-baseline-acceptance-testing`. No child agents, push, deploy, shared demo
writes, history rewriting or other-checkout edits were used.

## Exact source and incremental commits

Base: `a2e964e2045269231fc0df429d52cc51f53e2658`.
The requested linear range through `152049190bf1d3403f2a4200c4ed318451781ae4`,
then `b3babeb0492d1f0c5fb9d17ae81fe7fc2918cdb3`,
`e9d06c7706aa3074a7e2489b84df69b054b42de0`, `88fd2e6c` and `2b693d42`
applied once, without conflicts. The **common baseline head** is
`9be5ad826c3b7ab34bb8b6aa4ceae878605577a7`. All 35 source/local mappings,
authors and author dates are in [baseline-source-map.json](baseline-source-map.json).
The source authors, dates, messages and co-author trailers are preserved.
Work rules and employment interval imports remain alongside roster planning in
the generated API and real review/self callers; focused preservation tests pass.

- `43d026409daceadcb75c281b6ec6cfff568e186d`: independent recovery, roster,
  leave-consistency and populated production-limit probes; source mapping;
  correct the lifecycle browser expectation to the carried e9d06c77 gap contract.
- `cfbab8b7`: cherry-pick only the coordinator-supplied recovery fix
  `281c1e75ec288138b3b10a2d6351efe97c120b65` from `t3-513a7554`, after
  archiving the baseline failures. No independent production fix was written.
- `9a826d53`: test the revised non-sensitive request metadata (captured revision
  alongside request ID/operation), add real FENCED-with-version-advance cases,
  put the role precondition assertion inside its restoration `try/finally`,
  fix an inherited test-only lint violation, and commit the recording protocol.
- `3d2e6530`, `fad9e75e`: preserve baseline and corrected-head evidence.
- `0a07a193708b34fbb387b73c4f1feacadd265113`: policy-neutral leave invariant,
  proven break-spinbutton locator correction, foundation results and recording
  protocol safeguards. The later English confirmation is finalized in this report.

The recovery-fix acceptance source is
`9a826d53f7a08d5394272ea77ad06e8c012b4350`. Later changes
are test/evidence only; see final handback below for exact head and remaining
limitations. This is not final acceptance of a later Kiro production revision.

## Runtime and evidence boundaries

Installed dependencies from the frozen lockfile. Read AGENTS, the installed
Next 16.3.8 Playwright/environment/CLI documentation, Back contract and reviewed
inventory. Real browser runs use Next dev/webpack on localhost:3100, this
checkout's fresh anonymous Convex on 3320/3321, and the pinned real Clerk TEST
identity positively verified by the existing harness. Only nine explicit
allowlisted fields were privately written to ignored `.env.local`; no source
database or unrelated credentials were copied.

Workers=1, retries=0; unchanged 120-second case/30-second expect limits. External
bounds were 300 seconds for the three-case baseline probe and 660 seconds for
the corrected employee group. Backend/server setup remained bounded by the
existing harness. Pixel 7 is Chromium emulation, not a physical phone.

Response-loss tests relay and withhold **actual** Convex server frames after
the genuine write commits; they do not synthesize responses. Unsent tests take
the real browser offline and destroy its document before reconnecting. Independent
HTTP checks and writes use the genuine Clerk Convex JWT and registered functions.
Backend fixture setup/readback is disclosed separately from UI actions.

Full authenticated reports, screenshots, sessions diagnostics and owned-process
journals stay private under ignored `.cache/hr-browser/`,
`test-results/hr-local/` and `playwright/.auth/`. The committed
[run-summary.json](run-summary.json) contains only allowlisted provenance,
test titles/statuses and bounded non-secret assertion excerpts.

## Actual runs

| Run | Exact source (clean at start)              | Scope                                                                   | Actual result                                                                                                                                                                                                |
| --- | ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `9be5ad826c3b7ab34bb8b6aa4ceae878605577a7` | Focused employee pending/payment COMMITTED/unsent FENCED; both projects | **4 passed, 2 failed**, 175.184 s, exit 1. Payment COMMITTED fails on both. The extra persistence grep alternative matched no title; no persistence credit.                                                  |
| 2   | `43d026409daceadcb75c281b6ec6cfff568e186d` | Personal/contact/offboard COMMITTED, desktop                            | **0 passed, 3 failed**, 161.815 s, exit 1. Original three bodies retained from this commit. Additional FENCED cases appended during this run were not selected/executed; production source stayed unchanged. |
| 3   | `9a826d53f7a08d5394272ea77ad06e8c012b4350` | Employee lifecycle, profile/payment and recovery; both projects         | **27 passed, 1 failed, 0 skipped**, 478.562 s, exit 1. All 16 recovery checks pass. Desktop dirty/stale blocked before actions by page readiness.                                                            |
| 4   | `fad9e75e4095bed7deaea31ca664d27d6eafa257` | Foundation, protocols, roles, roster; both projects                     | **22 passed, 2 failed**, 442.425 s, exit 1. Two fixed-shift cases fail on this lane's break-field locator; all other cases pass.                                                                             |
| 5   | `0a07a193708b34fbb387b73c4f1feacadd265113` | Only corrected fixed-shift case and clock case; both projects           | **3 passed, 0 failed, 1 skipped**, 66.951 s, exit 0. Shift UI passes both; desktop clock performs 2 new actions; mobile performs 0 and skips.                                                                |

Exact executable commands, in order (each used the same guarded real harness):

```sh
node scripts/hr-e2e.mjs employees.spec.ts --grep 'committed ID-only|unsent ID-only|response-gated|personal contact emergency payment'
node scripts/hr-e2e.mjs employee-recovery.spec.ts --project hr-desktop
node scripts/hr-e2e.mjs employees.spec.ts employee-recovery.spec.ts employee-lifecycle.spec.ts
node scripts/hr-e2e.mjs foundation.spec.ts protocols.spec.ts roster.spec.ts roles.spec.ts
node scripts/hr-e2e.mjs roster.spec.ts workflows.spec.ts --grep 'fixed shift UI|clock events'
```

The suite has zero retries. Run 5 follows a proven test-locator correction; it
reruns only that affected case and adds genuine clock actions. Run 3's unexplained
setup block was not rerun to manufacture a green result. Earlier failures remain
in separate private archives and in the committed summary.

| In-process check                 | Scope                                                                      | Actual result                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial six files                | Baseline plus independent probes; 2 workers                                | **78 passed, 1 failed**; original over-specific leave/roster probe. Includes jsdom callers and convex-test registered handlers, never browser tests.                                     |
| Corrected callers                | Eight files, `9a826d53` source; 2 workers                                  | **117 passed**: EmployeeProfileSections, EmployeesNavigation, EmployeeGapDetails, ShiftsRoster, HrOrgSettings, environment/seed guards and populated 1,550-cell transaction-limit probe. |
| Combined preservation            | Eight registered-handler integration files, recovery-fix source; 2 workers | **104 passed**: org/legacy preservation, work rules, roster, intervals, gaps and overnight open-shift behavior. In-process Convex/simulated time.                                        |
| Leave consequences               | One case with expanded assertions                                          | **1 failed**, three retained invariant failures: approval, ledger and captured attendance.                                                                                               |
| Final policy-neutral leave probe | One case permitting either conflicting write to refuse                     | **1 failed**, four assertions; no invented exact refusal code required. Both actual writes still succeed and consume the old reservation.                                                |

Do not sum overlapping Vitest totals. The initial full normal lint failed on
an inherited `typeof import()` test annotation; the test-only type import fix
is committed. The subsequent normal lint passed. Navigation passed both before
and after the supplied recovery fix: 68 Node fixtures, 60 route/error policies,
309 exact state/overlay owners and 26 intents. Discovery passed: 396 Vitest
files and 26 Playwright spec files. Pinned Bun 1.4.3 / embedded TS 7.0.2 installed
from a cached public archive after the installer verified its pinned SHA-256.
After browser teardown, `pnpm typecheck:ts6` passed and then pinned
`pnpm typecheck` passed (1,125 files). Their separate process journals confirm
serialization; no browser/Next server overlapped either typegen/check.

## Actionable defects and reproducers

### Baseline: retained COMMITTED recovery becomes unreachable

1. Open a disposable employee's personal/contact/payment or offboard dialog.
2. Save through the real UI. Withhold actual server frames after the real
   handler commits; confirm the new value/event through authenticated HTTP.
3. Verify session storage contains only request identity metadata and not the
   private draft. Destroy the old document with a real reload.
4. Reopen the same profile/payment section, or Reinstate after offboarding.
5. Expected: “Check previous write” resolves COMMITTED without replay or a
   duplicate version/event. Baseline actual: the control is missing because
   the durable key includes the old version; lifecycle also changes action kind.

Run 1 reproduces payment on **both** projects. Run 2 independently reproduces
personal, contact and offboard on desktop. All are retained as failed runs;
they were not overwritten by the supplied fix's later acceptance.

### Unresolved on tested source: leave/roster consistency after a pending request

Permanent reproducer:
`tests/integration/hr-parity/04-shifts-roster-leave.test.ts`.
It promotes the prior `t3-dc4094fa` unregistered reproduction into normal test
discovery using this checkout's actual registered handlers.

1. In the in-process fixture, activate the explicit synthetic leave policy and
   reserve one annual leave day for `2026-10-13` from its working plan.
2. Assign roster OFF for that employee/date through `hr/roster:assignRoster`.
3. Approve the retained request through `hr/leave:decide`.
4. Expected consistency invariant: either refuse the conflicting roster change
   or refuse approval after that change, without consuming the old-plan
   reservation. Actual: both writes succeed; `used:1,reserved:0`, and a LEAVE
   attendance day retains the former 08:30–17:30 SCHEDULED plan.

The original probe over-specified a proposed `LEAVE_PLAN_STALE` error. That
error is not an existing API contract or an observed HRZoft rule: S04-22 leaves
leave/OFF precedence unresolved. The final permanent test is policy-neutral and
still fails on the observed dual-success/consumption sequence; a production fix
can safely refuse either conflicting write. Earlier failed logs are retained.
This is an observed consistency gap reproduced in process, not a real active-leave
browser pass. The implementation lane must document its chosen precedence; this
test lane does not implement or prescribe the production repair. No local browser
policy or shared/production policy was activated to make this test pass.
The coordinator subsequently reported `c5d21eaf` adds active-claim locks and
gap-aware leave validation. That newer source was not applied, tested or reviewed
here; the coordinator will launch fresh final acceptance.

### Corrected-head setup block: desktop dirty caller did not run

The desktop dirty/stale test timed out waiting for Add employee in its subject
helper. Its snapshot shows the Employees shell with “Preparing this page” and
“Loading available work”, before any draft/asserted stale write. Cause unknown.
This is **blocked acceptance**, with the Playwright failure retained, not proof
of a dirty-draft product failure and not an authentication diagnosis. Do not
substitute old passing runs or later cases for this missing exact-head coverage.

## Recording and remaining scope

[recording-plan.md](recording-plan.md) defines final acceptance, exactly three
tutorial flows, safe synthetic display data, real timestamp/event manifests,
negative cases, reload/backend readback and private/public artifact separation.
Read qa-video and `references/record.md` for methodology only; no Dr.Ease endpoint
or workflow was used. T3 preview status/open were checked; the owned preparation
tab was closed. Recording start/stop tools are available. No tutorial recording
or editing was performed on this failing first-stage source.

Run 5 performed **two new desktop clock actions** (clock in/out) and verified
the retained server times through reload. The mobile case performed **zero**
actions on that same-day state and is **skipped**, not counted as clock coverage.
The DB was not reset between runs to make clock actions available. Overnight
last-day/open-shift behavior currently has in-process fake-clock coverage only.
Thai UI, physical mobile devices, production build and complete HR parity remain
untested here. Existing old version-suffixed recovery records across a software
upgrade are not covered: source inspection shows the supplied fix switches
lookup formats without a migration. New fixed-format writes and reloads are a
separate acceptance result.

## Final handback

Bounded first stage complete. Last browser-tested code/test checkpoint:
**`0a07a193708b34fbb387b73c4f1feacadd265113`**. The final documentation commit
containing this report is supplied by full SHA in the handback message.
`git diff cfbab8b7 HEAD -- src convex docs/contracts` is empty: after the supplied
recovery cherry-pick, this lane changed tests/evidence only.

Final normal ESLint and navigation checks passed after the locator/invariant
changes. Final `pnpm typecheck:ts6` passed after browser teardown; then pinned
`pnpm typecheck` passed (1,126 files). No production build/full repository suite
claim is made. The intentionally failing leave regression remains red on this
source and must be evaluated against the coordinator's corrected source.

At 2026-11-02 13:35:05 UTC (20:35:05 Bangkok), all **42 journalled owned process
groups** had cleanup records and no PID/group survivors; 3100/3320/3321 had no
listeners, the run lock was absent, and no external command deadline fired.
Private audit: `.cache/hr-browser/handback-process-audit.json`. A separate cwd
scan found only existing Paper/CUA/REA support connectors and the short-lived
audit command, not test/browser/server workloads; these connectors were left
alone. The owned T3 preparation tab is closed. Real role tests restored the exact
previous local grants in `finally`; the harness revoked only sessions it created.
Private DB, failed reports/screens and session diagnostics are retained locally.

The recording plan now specifies the user-confirmed **English** tutorial. No
recording/editing was taken over. No `c5d21eaf` work or final re-review was started.
The coordinator can now launch fresh final acceptance and recording on that
corrected exact source. Do not replay the common 35 dependencies or recovery fix
again: incremental test/evidence commits are `43d02640`, `9a826d53`, `3d2e6530`,
`fad9e75e`, `0a07a193` and the final documentation commit; `cfbab8b7` is only the
already-supplied production recovery cherry-pick.
