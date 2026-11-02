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

| Run                   | Exact source                                               | Command / environment                                                                                                                                        | Actual result                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                     | `9be5ad826c3b7ab34bb8b6aa4ceae878605577a7`, clean at start | `node scripts/hr-e2e.mjs employees.spec.ts --grep 'committed ID-only\|unsent ID-only\|response-gated\|personal contact emergency payment'`; desktop + mobile | **4 passed, 2 failed**, 175.184 s, exit 1. The final grep alternative matched no persistence title; no persistence credit from this run.                                                                                                  |
| 2                     | `43d026409daceadcb75c281b6ec6cfff568e186d`, clean at start | `node scripts/hr-e2e.mjs employee-recovery.spec.ts --project hr-desktop`; original three COMMITTED probes                                                    | **0 passed, 3 failed**, 161.815 s, exit 1. First three executed test bodies are retained from this commit; additional FENCED tests were appended during the run and were not selected/executed in it. Production source stayed unchanged. |
| In-process baseline   | baseline plus independent probes                           | Six focused Vitest files, 2 workers                                                                                                                          | **78 passed, 1 failed**; leave/roster defect. Includes jsdom callers and convex-test registered handlers, not browser tests.                                                                                                              |
| Corrected callers     | `9a826d53` production/test source                          | Eight focused Vitest files, 2 workers                                                                                                                        | **117 passed**. Includes EmployeeProfileSections, EmployeesNavigation, EmployeeGapDetails, ShiftsRoster, HrOrgSettings, environment/seed guards and 1,550-cell transaction-limit probe.                                                   |
| Combined preservation | `9a826d53` production source                               | Eight focused registered-handler integration files, 2 workers                                                                                                | **104 passed**; org/legacy preservation, work rules, roster, intervals, gaps and overnight open-shift behavior. Uses in-process Convex and simulated time; not real browser overnight coverage.                                           |
| Leave consequences    | recovery-fix source plus expanded assertions               | Single focused in-process registered-handler case                                                                                                            | **1 failed**, three retained invariant failures: approval, leave ledger and captured attendance.                                                                                                                                          |

Do not sum overlapping Vitest totals. The initial full normal lint failed on
an inherited `typeof import()` test annotation; the test-only type import fix
is committed. The subsequent normal lint passed. Navigation passed both before
and after the supplied recovery fix: 68 Node fixtures, 60 route/error policies,
309 exact state/overlay owners and 26 intents. Discovery passed: 396 Vitest
files and 26 Playwright spec files. Pinned Bun 1.4.3 / embedded TS 7.0.2 installed
from a cached public archive after the installer verified its pinned SHA-256.
Next typegen/typechecks are serialized after browser teardown.

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

### Still open: leave approval consumes an old plan after roster OFF

Permanent reproducer:
`tests/integration/hr-parity/04-shifts-roster-leave.test.ts`.
It promotes the prior `t3-dc4094fa` unregistered reproduction into normal test
discovery using this checkout's actual registered handlers.

1. In the in-process fixture, activate the explicit synthetic leave policy and
   reserve one annual leave day for `2026-10-13` from its working plan.
2. Assign roster OFF for that employee/date through `hr/roster:assignRoster`.
3. Approve the retained request through `hr/leave:decide`.
4. Expected: refuse `LEAVE_PLAN_STALE`; retain `used:0,reserved:1`; create no
   attendance day. Actual: `written:true`, `used:1,reserved:0`, and a LEAVE
   attendance day retaining the former 08:30–17:30 SCHEDULED plan.

This is a product defect reproduced in process, not a real active-leave browser
pass. No local browser policy or shared/production policy was activated to make
this test pass. Production repair remains with the implementation lane.

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

No clock case has run in this stage so far; no clock-write credit is claimed.
The carried harness explicitly skips zero-action same-day cases. Overnight
last-day/open-shift behavior currently has in-process fake-clock coverage only.
Thai UI, physical mobile devices, production build and complete HR parity remain
untested here. Existing old version-suffixed recovery records across a software
upgrade are not covered: source inspection shows the supplied fix switches
lookup formats without a migration. New fixed-format writes and reloads are a
separate acceptance result.

## Final handback

Final browser totals, serialized typechecks, exact handback head and process
cleanup are appended after the bounded runs finish. Keep all initial failures.
