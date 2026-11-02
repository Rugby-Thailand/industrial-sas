# S04 fixed shifts and dated roster — implementation and independent verification

## Baselines and provenance

Checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-4c1d7adf`, branch `t3/fixed-shift-date-roster`. Original HEAD: `a2e964e2045269231fc0df429d52cc51f53e2658`; initially clean. The authorized local linear range `a2e964e2..88c2f1d5` was cherry-picked without conflicts. Integration baseline before feature work: **`73e7bc46`** (content equivalent to combined `88c2f1d5`). Only commits after this baseline are this lane's incremental delivery. No other checkout was written, no worktree/branch was created or switched, and no push, PR, deployment or shared HRZoft mutation occurred.

The ONE authorized worker was `/Users/macbook/.local/bin/kiro-cli chat --model claude-opus-5.5 --effort high --trust-all-tools --no-interactive`, with an explicit scoped prompt. Availability was confirmed with `chat --list-models --format json-pretty`. It implemented the feature source and initial registered/component tests. Codex 6.1 independently inspected the diff, added adverse regressions, corrected findings, completed the navigation inventory and public API coverage, and ran the acceptance checks below. No further agents were used.

Read-only research source: `/Users/macbook/Development/industrial-sas/docs/plans/hr-parity/04-shifts-roster/spec.md` and its current evidence, plus the overnight plan. Those external-service observations did not establish successful HRZoft persistence/recalculation rules. The repository's AGENTS, installed Next 16.3.8 guides, Back contract/inventory and Impeccable skill were consulted. The implementation preserves the incumbent HR UI; no visual redesign or configuration drift repair was performed.

## Delivered behavior and boundaries

- `/hr/shifts`, linked from Settings: site-scoped named FIXED definitions with canonical code, name, description, palette colour, ACTIVE/INACTIVE status, local start/end, explicit overnight flag and aggregate unpaid break minutes. The existing `validateSchedule` rules remain authoritative. Codes are case-insensitively unique per organization/site; OFF is reserved. Versioned edits, actor/payload-bound idempotency and audit use the existing HR command protocol. The catalogue supports 99 named definitions per site (OFF is a separate reserved choice) and refuses another create at the bound while allowing edits.
- `/hr/roster`, also linked from Settings: month/date columns, employee identity and department text, site/month/employee search filters, accessible selectable cells, one action selector, selected count, Save and Cancel. The selector offers a named shift, explicit OFF, and **Clear (use weekly schedule)**. It offers no unimplemented modes or retroactive controls. Department filtering exists in the API; its UI picker, position/responsible-group filters and leave overlays remain deferred.
- One assignment row per employee/date: SHIFT stores the definition ID/code/name/colour/version and copied times; OFF is an explicit rest override; CLEARED is a monotonic revision tombstone restoring weekly fallback. Every selected cell carries its observed revision. Every SHIFT carries the version chosen by the admin, pinned across reactive template updates. A stale template refusal retains cells and requires an explicit new selection. All cells are validated before any assignment write; one refusal rejects the entire batch.
- **Plan precedence is OUR preserved rule, not observed HRZoft save behavior:** an existing captured plan is authoritative; otherwise site holiday, dated SHIFT/OFF, then weekly `hrEmployees.schedule`. Definition edits/inactivation never silently alter assigned snapshots. `livePlan`, Today/clocking, self history, both review paths and draft period rows use the same dated resolution. Overnight attribution remains the start business date in the organization/site timezone. No overtime or payroll arithmetic was added.
- **Conservative no-recalculation rule:** SHIFT, OFF and CLEAR refuse any date with an attendance day, any date covered by a currently CLOSED site period, or any employee/date that has ever been frozen in `hrPeriodRows`. The latter remains refused after a period starts a revision or the employee changes site. A new additive employee/date index makes that check exact. No captured attendance row or frozen version is rewritten. Starting an existing attendance revision does not authorize the unknown roster recalculation policy.
- Site transfers with no captured/frozen plan preserve the employee/date revision. Old-site times do not follow the employee implicitly; the new site's roster shows weekly fallback and can replace the old row with a new authorized, versioned assignment. This fixes stale cells after a permitted existing employee site change without changing employee lifecycle implementation.
- Both routes have Settings as their safe direct parent. The shared shift Dialog and named `rosterAssign` workflow step own foreground history. Dirty/pending protection, live async completion, explicit cancellation, next Back, Forward, direct links, query/hash preservation, reactive changes and repeated drafts have actual caller regressions. Month/search are individually audited filters, not editor exemptions. Inventory case titles are literal existing tests.

## Interfaces and combined-integration seam

- `convex/model/hr/roster.ts`: `validateShiftDraft`, `validateFixedTimes`, `rosterPlanFor`, `monthDates`, palette/bounds.
- `convex/model/hr/rosterSchema.ts`: `hrShifts`, `hrRosterAssignments`, optional captured-plan provenance.
- `convex/hr/roster.ts`: registered `shifts`, `saveShift`, `roster`, `assignRoster`, all requiring `hr.admin.manage` and actual tenant/site scope. Operations `hr.shift.save` and `hr.roster.assign` are registered for request reconciliation in `recovery.ts` and `useHrWrite.ts`.
- `shared.ts`: `rosterRowOf`, `rosterAssignment`, `siteRosterInRange`, `employeeRosterRowsInRange`, `employeeRosterInRange`, `hasFrozenPlan`, and dated `livePlan`. Raw revisions follow the employee/date key; live assignments apply only at the employee's current site.
- `buildPeriodRows` accepts an optional assignment resolver; recorded plans still win. `periodFingerprintText` includes roster provenance when present, preserving legacy weekly-only fingerprints. A ready OFF clear/reassign must invalidate an earlier period review even if attendance totals are unchanged.
- **Hardening integration:** user supplied backend `c30b87e0`, UI/recovery `fbbd1f7a`, evidence `245083a6` from `/Users/macbook/.t3/worktrees/industrial-sas/t3-9790b3d7`; independent hardening review is separate. These commits were NOT cherry-picked here. Do not overwrite their changes when combining shared files. `employmentOf(employee)` supplies optional intervals there, and `isEmployedOn`/`isEmployedInRange` preserve separation gaps. This roster already calls `isEmployedOn(employmentOf(employee), date)` before assigning. Preserve those predicates before attendance/obligation writes and retain the hardening implementation of range eligibility. `livePlan` resolves the schedule, never employment eligibility. Shared overlap: `convex/hr/shared.ts`, `convex/model/hr/schedule.ts`, `convex/model/hr/period.ts`, `convex/hr/self.ts`, `convex/hr/review.ts`, `convex/hr/periods.ts`, `convex/hr/recovery.ts`, `src/features/hr/useHrWrite.ts`, schema and locale messages as applicable.
- This checkout still inherits the six employee profile/lifecycle chronology, gap, activation, recovery and final overnight clock-out blockers from the combined baseline. None was reimplemented or claimed fixed here. This is not whole-suite or release approval.

## Exact S04 mapping

| Task   | Status in this delivery  | Boundary                                                                           |
| ------ | ------------------------ | ---------------------------------------------------------------------------------- |
| S04-01 | Delivered for FIXED      | Codes, colours, names, descriptions, active status; no other algorithms            |
| S04-02 | Delivered                | Fixed times and our existing overnight semantics                                   |
| S04-03 | Partial                  | FIXED only; hour-count and freelance deferred                                      |
| S04-04 | Partial                  | Aggregate break minutes only; break windows deferred                               |
| S04-05 | Deferred                 | Company/shift auto-OT configuration                                                |
| S04-06 | Deferred                 | Multi-period grid and conditional OT columns                                       |
| S04-07 | Delivered bounded subset | Employee/date/weekday month grid; avatars/count badges and leave overlays deferred |
| S04-08 | Delivered                | Single-cell selection and explicit draft Cancel                                    |
| S04-09 | Delivered                | Multi-cell selection, count, one action, atomic Save/Cancel                        |
| S04-10 | Delivered                | Registered month queries include leap/non-leap February and 30/31-day months       |
| S04-11 | Delivered                | Dated assignment before weekly fallback on unrecorded non-holidays                 |
| S04-12 | Delivered                | Captured/frozen plans immutable; refuse ordinary edits                             |
| S04-13 | Delivered                | OFF differs from missing/CLEARED fallback                                          |
| S04-14 | Delivered                | Overnight start business-date resolution, timezone and captured provenance         |
| S04-15 | Deferred                 | No break-window algorithm is offered                                               |
| S04-16 | Delivered                | Employee/date isolation, revisions, atomic refusal, tenant/site guards             |
| S04-17 | Unknown/deferred         | Repeat patterns/anchoring/overwrite                                                |
| S04-18 | Unknown/deferred         | Hour-count/FREE duration and overnight algorithms                                  |
| S04-19 | Deferred                 | Period day/week selectors                                                          |
| S04-20 | Unknown/deferred         | OT thresholds, approvals and pay connection                                        |
| S04-21 | Unknown/deferred         | HRZoft saved/retro effects; our conservative refusal rule is explicit              |
| S04-22 | Partial                  | Preserve our site-holiday precedence; external holiday/leave/OFF policy unobserved |
| S04-23 | Partial                  | Site and employee search UI; department API only; remaining org filters deferred   |
| S04-24 | Partial                  | OFF and named holiday presentation; leave overlay deferred                         |
| S04-25 | Deferred                 | No retroactive update control without implemented policy                           |

## Independent verification

Every Vitest command used `--maxWorkers=2`. Counts overlap and must not be added together. The expanded command is:

```sh
pnpm exec vitest run convex/model/hr src/features/hr tests/integration/hr- \
  tests/integration/public-function-contract.integration.test.ts \
  tests/integration/public-api-registered-coverage.integration.test.ts \
  tests/integration/schema-contracts.integration.test.ts \
  tests/integration/production-schema-compatibility.integration.test.ts \
  tests/integration/registered-boundaries.integration.test.ts --maxWorkers=2
```

- Baseline targeted HR: exit 0, 216/216 tests in 16 files.
- Independent initial feature/backend run: exit 0, 11/11 tests in 3 files.
- Independent new roster caller + HR header-parent run: exit 0, 64/64 in 2 files (13 roster caller cases plus existing/expanded header cases). These are React/DOM tests with mocked transport, **not browser evidence**.
- Registered roster/supervisor + range-read regressions: exit 0, 19/19 in 3 files.
- Registered frozen revision/site-move + schema compatibility check on the final freeze guard: exit 0, 64/64 in 4 files. These use actual registered Convex references and validators in `convex-test`, **not a deployed backend**.
- Expanded HR + public/schema contracts: exit 0, 1126/1126 tests in 83 files before the last freeze guard; final acceptance rerun recorded below.
- `pnpm lint`: normal full-repository ESLint, exit 0; final-source rerun recorded below.
- `pnpm check:navigation`: exit 0, 68 explicit architecture fixtures plus production route/state inventory.
- `pnpm ci:codegen`: exit 0 against the pinned credential-free throwaway loopback backend; generated files match. No cloud deployment.
- `pnpm ci:test-discovery`: exit 0, 389 Vitest files and 17 Playwright specs discovered. Listing specs does not execute them.
- `pnpm typecheck:ts6`: exit 0 (`next typegen && tsc --noEmit`); final-source rerun recorded below.
- Required Bun `pnpm typecheck`: exit 0, 1094 files, task-local Bun 1.4.3 / embedded TS 7.0.2. Installed with `node scripts/ci/install-bun-checker.mjs`; archive SHA256 `80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403`, executable SHA256 `28c7dd0a06916aba284d570ef44a2d70e9c538eaf2ba58dfe0910525563b3f79`. No global runtime upgrade.
- Impeccable mechanical detector: exit 0, `[]`. Source/token inspection corrected a nonexistent OFF background token. No browser screenshots or desktop/mobile visual verification are claimed.
- Public contract refresh was reviewed: exactly `hr/roster:{shifts,saveShift,roster,assignRoster}` added; zero changed existing validators. Representative public registration coverage was extended, not exempted.

### Adverse/failed runs retained

- Worker handoff reported 9 registered cases passing, 8/9 UI cases, and missing navigation inventory. Codex's initial independent run passed 9/9 UI cases; the worker's pending-Back failure remains recorded as an earlier result, not erased.
- Codex red regressions proved: period fingerprint omitted OFF revision; catalogue allowed a 101st entry; reactive template selection submitted the newest version silently; a second assignment draft lost its guard; a site move lost the cell revision; reopening a period allowed a once-frozen roster change. Each was corrected and its regression retained.
- During completion-owner correction, intermediate UI runs had 10 passed/1 failed, then 9 passed/2 failed; draft settlement ordering was corrected before success completion. Final caller cases passed.
- First expanded run: exit 1, 1121 passed/4 failed in 83 files. Three holiday caller cases used old navigation mocks without the newly imported declarative Link; one public payload expectation omitted the new roster example. Mocks now supply the actual Link surface and the payload inventory asserts the new result. No assertion, timeout or permission was weakened.
- First discovery run: exit 1 solely because four new test files were not yet git-tracked. They were staged, and discovery passed. No discovery exemption was added.
- Expected red runs select individual cases; skipped unrelated cases are not credited as completion. No tests are TODO/fixme acceptance placeholders.

## Process ownership and cleanup

All logs/command metadata remain task-local under `.cache/shifts-roster/`; no tokens/cookies or private backend keys are in this evidence. Each supervisor check is attached, has a named `.log` and `.json` with PID/PGID, cwd, command, start/end and exit, and a 600-second process-group bound. No detached untracked work was started.

Kiro supervisor PID 42985; worker PID/PGID **42998**, exec session **52492**, log `kiro.log`, metadata `process.json`. Started **2026-11-01 23:19:18 +07**, exited 0 at **23:39:23 +07** (20m05s), below the hard 90-minute bound. ACP used its own PGID **43009**, so a separate descendant guard tracked PID/start identity and groups. Initial guard PID 43915/session 73160 was explicitly stopped (exit 143) and replaced with identity-safe guard PID 48939/session 46212. Final `cleanup.json` reports **no remaining descendants**. The pinned codegen script stopped its owned backend and removed temporary local state/private environment files. Other worktrees' processes were not touched.

## Final acceptance and incremental handoff

Implementation commit: **`c0fbcfc5b30c5d06989be31d4383e0c9c9286136`**. The following evidence-only commit accompanies it. Apply only these incremental commits over the combined base; do not replay the 13 dependency cherry-picks. Resolve overlaps by preserving the independently reviewed hardening predicates and recovery registrations described above.

Final-source acceptance (all exit **0**):

| Check                                                                                           | Result                                                       | PID = PGID           | Exec session | Task-local log              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------- | ------------ | --------------------------- |
| Expanded HR/public/schema command above                                                         | **1126/1126, 83 files**, no skipped/todo acceptance          | 25044                | 8284         | `acceptance-hr.log`         |
| `pnpm lint`                                                                                     | Normal full ESLint, zero warnings                            | 25108                | 91228        | `acceptance-lint.log`       |
| `pnpm typecheck:ts6`                                                                            | Route typegen + TS 6.0.3                                     | 25071                | 65273        | `acceptance-ts6.log`        |
| Task-local Bun `pnpm typecheck`                                                                 | Bun 1.4.3 / TS 7.0.2, **1094 files**                         | 27285                | 85665        | `acceptance-bun.log`        |
| `pnpm ci:codegen`                                                                               | Pinned local output matches, including additive schema index | 26646                | 86618        | `acceptance-codegen.log`    |
| `pnpm check:navigation`                                                                         | **68/68 fixtures** and production inventory pass             | 26647                | 90208        | `acceptance-navigation.log` |
| `pnpm ci:test-discovery`                                                                        | **389 Vitest / 17 Playwright** files                         | 26648                | 59573        | `acceptance-discovery.log`  |
| Prettier check of every changed TS/TSX/JSON/Markdown file except CLI-generated API declarations | All matched files formatted                                  | attached short check | 12397        | exec result                 |

Final `process-audit.json`: **zero owned processes remaining**, every tracked check has an exit, no `.convex` or `.env.local` remains. Kiro, ACP descendants, tests, type checkers and codegen backends have stopped. No other lane's server was stopped.

No authenticated browser/deployed-backend workflow or desktop/mobile screenshot evidence is claimed. No full-repository test run or production deployment was performed. The passing targeted suite does not approve inherited employee blockers or the later hardening commits, which require their separate review and combined integration checks.
