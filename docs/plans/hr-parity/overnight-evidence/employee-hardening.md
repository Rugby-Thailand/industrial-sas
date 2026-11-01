# Employee hardening — implementation handoff

Implementation of the six findings in `employee-lifecycle-review.md` (report-only source commit `dd533481`). This is implementation evidence for the coordinator's independent cross-check, **not approval or a deployed/browser acceptance claim**.

## Ownership and source

- Work began approximately 23:13 Bangkok, 2026-11-01; all work stayed in the T3-prepared `/Users/macbook/.t3/worktrees/industrial-sas/t3-9790b3d7`, branch `t3/harden-employee-lifecycle`. No branch switching, shell checkout creation, subagents, Kiro runs, production deployment, shared HRZoft writes, push or PR.
- Read the coordinator overnight plan, full retained review probes, AGENTS.md, installed Next 16.3.8 forms/useSearchParams guides, Back contract/inventory, S03 spec, HR Phase 1 requirements, design-system/HR surface guidance, diagnosing-bugs and resolving-merge-conflicts skills. Impeccable context/hardening guidance and the mechanical UI detector were used; no visual/browser score is claimed.
- Applied the requested commits in order, with these local cherry-pick equivalents:

| Source     | Local      |
| ---------- | ---------- |
| `92fe30f0` | `583efca1` |
| `857d9f8e` | `e9500837` |
| `eb5542ac` | `b5d6ac52` |
| `cfd6dcdf` | `9014fff1` |
| `962b3a69` | `a48e3171` |
| `dc26a397` | `9474c3af` |
| `e40127a1` | `ddfbd865` |
| `1a53d2b1` | `3e3c386c` |
| `5c569ae2` | `82663050` |

All cherry-picks applied cleanly. The semantic combination was checked: `saveEmployee` still merges effective org fields using `replaceOrgFields:true` versus legacy fieldwise omission, then validates chronology and those same effective assignments before persisting. Lifecycle and profile fields are retained. Generated API, public contract and Back inventory changes from both dependencies remain present.

Pre-hardening HEAD: `826630508f117b50476b5f631ac8c526941b84cd`; tree `3737d101e90154ad14c0e38467bd54d12364e146`. This baseline includes the foundation protocol fixes, unlike the independent review's older foundation. Kiro rules are deliberately not cherry-picked here. The coordinator's exact registered combined test from `fed39093` was read, temporarily copied, executed successfully against the hardened source, then removed from this checkout; its committed owner remains the combined lane (`88c2f1d5`).

## Red before production fixes

The report's R/U probes were installed as permanent tests, using actual `t.mutation`/`t.query` registered references and their argument validators, and the actual `HrEmployeesScreen` / editor component context. Only the excluded inherited forged-cursor comparison and receipt-scope observation R3 were omitted; neither was reworked.

Before any production fix:

```sh
pnpm exec vitest run tests/integration/hr-parity/employee-hardening.test.ts src/features/hr/EmployeeProfileSections.test.tsx --maxWorkers 2
```

Exit **1**, 2 files: **10 failed, 12 passed**, 23:15:13 Bangkok. Log: `/tmp/employee-hardening-red.log`.

| Finding | Retained adverse cases and observed red symptom                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | U1: nickname becomes empty after profile version refresh. U2: pending owner is replaced; Cancel is enabled and successful original completion leaves the dialog open.     |
| F2      | R5: the unchanged October 5 gap period changes from `rows:[] / PERIOD_EMPTY` to a scheduled `MISSING_RECORD / PERIOD_NOT_READY` row after October 19 reinstatement.       |
| F3      | R1/R1b: exits before confirmation/reinstatement both write. R4: hire October 1 and probation December 31 overwrite the main record despite a retained May 4 confirmation. |
| F4      | R2: normal activation refuses missing department while reinstatement writes ACTIVE without required assignments.                                                          |
| F5      | U3: a valid ID-only reload record has no recovery control. R6: registered payment reconciliation returns `OPERATION_INVALID`.                                             |
| F6      | R7: midnight offboard succeeds while the final 22:00–06:00 day is open; registered 06:00 clock-out returns `HR_EMPLOYEE_INACTIVE`.                                        |

The causal candidates were query-key remounts, a continuous employment range despite recorded rejoin dates, omitted shared lifecycle/activation guards, and missing recovery mappings. The fixes below are exercised at those exact seams, without weakening obsolete-callback protection or replacing the real registered calls with mocks.

An additional permanent F3 adverse case was run before extending that guard: `a planned probation date cannot be newly moved beyond an existing separation event`. Exit **1**, 1 failed/20 unrelated filtered cases skipped, 23:31:03; it wrote instead of returning `PROBATION_END_AFTER_EVENT`. Log `/tmp/employee-hardening-probation-red.log`. Skips are not passing coverage.

## Six-finding implementation status

### F1 — addressed: editor session ownership

The identity/employee-scoped session owns a target plus the exact profile/payment/lifecycle snapshot captured by the opening event. Form keys are stable for that session. Live query versions or temporary loading do not replace forms, drafts, pending guards, request identities or completion callbacks. A genuine version mismatch shows stale feedback; the original expected version is still sent, so stale writes refuse rather than overwrite newer data. Explicit discard/completion releases the snapshot; Forward opens from current data. Actor/tenant/employee changes invalidate the private session and obsolete results cannot close a new actor's dialog.

Maintained caller cases cover Personal, Contact, Payment and Lifecycle pending saves while the relevant subscription advances, including the main employee subscription for lifecycle. They assert Cancel/header/native Back protection, original version, successful completion consuming its owned entry, then the exact list query/hash origin. Dirty/header Back/discard, loading refresh, Forward, remount, and actor/tenant changes are also exercised. Existing direct-link/locale/underlay cases in `EmployeesNavigation.test.tsx` run in the broad suite. Exact new literal caller titles are in the inventory; no presentation exemption or policy bypass was added.

### F2 — addressed: explicit employment intervals

`hrEmployees.employmentIntervals` is an optional array of inclusive `{startDate,endDate?}` intervals. Ordinary legacy records without this field retain the old single start/end range. Offboarding materializes/closes the current interval; reinstatement appends a new open interval, preserving the original hire date and every earlier closed interval. General employee edits change only the outer hire/current-end bounds and retain internal gaps; event chronology constrains those edits. No history is patched/deleted and no payroll/leave settlement is invented.

Employment range audit:

| Consumer                                                                                       | Gap behavior                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.employmentOf` → `schedule.isEmployedOn`                                                | Carries intervals; gates self clocking, corrections, review/disposition, leave request dates, and per-date period/history rows.                               |
| `shared.employedInRange` → `schedule.isEmployedInRange`                                        | Intersects actual intervals, including outer legacy bounds; site/review/period employee selection cannot select a person solely for a gap.                    |
| `policies.readiness` / `reconcileOpening`                                                      | Uses the same per-date eligibility for effective/as-of dates.                                                                                                 |
| `announcements.publishAnnouncement`                                                            | Uses that eligibility for the publication audience.                                                                                                           |
| Leave account/anniversary calculations using `employmentStartDate`                             | Deliberately retain original hire anchor; no new prorating, balance reset or statutory settlement policy. Actual leave dates still pass interval eligibility. |
| Closed period versions/rows, original attendance, approved leave and published payslip history | Existing immutable/history read paths retained; registered regressions preserve a frozen period and earlier leave/payslip reads.                              |
| Employee/self summaries and staging fixtures                                                   | Start/end remain compatibility metadata; live eligibility is computed through the shared predicate.                                                           |

The registered regression covers repeated exits/rejoins, both gaps, pre-exit history rows, unchanged frozen output, rejected gap clock-in and sick-leave preview, and retained gaps through modern and legacy main saves. The module was not deployed before this run; this adds interval materialization to lifecycle writes, not a migration/backfill of a previously deployed buggy lifecycle dataset.

**Roster integration seam:** keep `employmentOf(employee)` from `convex/hr/shared.ts`, `isEmployedOn(employment,date)` and `isEmployedInRange(employment,from,to)` from `convex/model/hr/schedule.ts`. `Employment` still has `startDate/endDate` and now optional `intervals`. `livePlan` resolves a schedule; it does not replace employment eligibility. Preserve the predicate calls before generating obligations or accepting attendance/leave writes, and preserve captured day plans/frozen rows.

### F3 — addressed: effective chronology

An employee/effectiveDate index reads authoritative first/latest event bounds in the same transaction as writes, independent of the capped display history and tied recording timestamps. Valid transitions cannot precede the latest effective event. General saves cannot move hire past the first event, current end before the latest event, or change a planned probation end beyond recorded confirmation/first event. Early confirmation/exit may leave an unchanged historical future probation plan; unrelated legacy saves preserve it. The shared pure `validateEmploymentChronology` is used by backend and main caller. UI min/max and field errors mirror the bounds. Existing invalid-state refusals keep precedence; no append-only correction protocol was invented.

### F4 — addressed: ACTIVE assignment invariant

Reinstatement validates stored assignments against ACTIVE using the exact foundation `validateEmployeeOrgReferences` helper and current tenant references before any patch/event. Missing assignments return their existing field errors. The dialog explains the recovery path: cancel, update employment fields while retaining INACTIVE and last day, save, then retry Reinstate. Registered tests perform that path through the modern replacement protocol and a legacy omission save, and then successfully reinstate without losing assignments.

### F5 — addressed: status-only recovery

All three intent prefixes map to their registered operations, and the backend allowlist includes `hr.employee.profile.save`, `hr.employee.payment.save`, `hr.employee.lifecycle` with HR admin permission. Browser recovery remains ID/operation only. Personal/contact/bank/lifecycle payloads are never serialized to session/local storage. Registered cases test COMMITTED, FENCED before an attempt ever reached the server, rejection of a late retired ID, exact replay, another actor and another tenant. Caller cases initialize the exact persisted post-reload state with no original callback and reconcile both statuses without private replay or a fabricated new-form success.

### F6 — addressed: finish the open final shift first

Offboarding checks the actual indexed open days, current employment and the same captured-plan `openDayDeadline` used by self clock-out. It refuses with `LIFECYCLE_OPEN_SHIFT` while a relevant still-valid open shift needs completion, leaving ACTIVE/version/history intact. The message directs clock-out or attendance resolution. The registered overnight case verifies the refusal after Bangkok midnight, the **unchanged** registered clock-out at 06:00 against the previous business date, then successful offboarding. A normal closed daytime shift and stale offboard version are covered. No sign-in, membership or role-disable behavior changed.

## Validation and corrections

All tests use Node 24.19.0 / pnpm 10.33.2 / Vitest 4.1.11; every Vitest invocation used `--maxWorkers 2`. Convex tests use isolated in-memory tenant fixtures, not a deployed backend. Caller tests use jsdom with Convex hooks mocked at the client boundary; persisted-ID setup models a new document and is **not** a real browser reload. Another lane owns authenticated real browser/app/backend verification; no 3100/3320 service was started here.

- Initial fixes: 27/27 across retained probes/caller/lifecycle suites; expanded matrix 43/43; final focused 55/55; chronology/error-precedence focused 39/39. Counts overlap and must not be added.
- Exact coordinator combined registered test from `fed39093`: 1/1 passed, `/tmp/employee-hardening-combined-test.log`.
- First broad HR/contracts run: **1137 passed, 2 failed / 79 files**, 70.15s. Its two failures were genuine new error-precedence changes, fixed in production by checking invalid lifecycle states before chronology. The original test assertions were preserved. `/tmp/employee-hardening-broad.log`.
- Early expanded test-writing mistakes (required Reason label, asynchronous history assertion, descending history order, main date-label spelling) were corrected at the actual seams. Initial lint also caught the missing renamed inventory owner and a render-time snapshot ref; the snapshot now lives in target state. Early type checks caught test fixture typing and the shared validator's over-broad field type; these were corrected without exemptions. The first discovery attempt refused the then-untracked new test; it is now tracked normally.

Completed final gate results and incremental commits are recorded below.

## Boundaries

No one of F1–F6 is consciously deferred and reinstatement remains available with interval/assignment/chronology guards. This does not complete the wider S03 parity backlog: full 15-tab profile/document/import/bulk work, event-history traversal beyond the existing cap, future scheduled lifecycle changes, payroll/final leave settlement, and sign-in-disable semantics remain outside this bounded task. Known inherited forged-cursor behavior and historical receipt scope semantics were not reworked. The coordinator still owns integration with Kiro rules/roster/period lanes and independent approval.

## Final gates

| Command / evidence                                                                                                              | Result                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Broad HR/contracts command below, `/tmp/employee-hardening-broad-final.log`                                                     | **0, 78 files / 1138 passed**, 56.67s, 23:38:53 Bangkok. No failures, skips or todos reported.                                     |
| Exact `fed39093` combined registered test, `/tmp/employee-hardening-combined-test.log`                                          | **0, 1/1**. Exact copied blob `642c05e62893a9c2ace81d0da059222223ff8533`, matching the coordinator source. Temporary copy removed. |
| `pnpm lint`, `/tmp/employee-hardening-eslint-verified.log`                                                                      | **0**, normal full-repository ESLint, no exemptions.                                                                               |
| `PATH="$PWD/.cache/bun-checker/bun-v1.4.3-bun-darwin-aarch64:$PATH" pnpm typecheck`, `/tmp/employee-hardening-bun-verified.log` | **0**, checksum-verified Bun 1.4.3 / TS 7.0.2, 1,081 files, no type errors. Task-local install; no global toolchain change.        |
| `pnpm typecheck:ts6`, `/tmp/employee-hardening-ts6-complete.log`                                                                | **0**, Next type generation and TS 6.0.3.                                                                                          |
| `pnpm exec tsc -p convex/tsconfig.json --noEmit`, `/tmp/employee-hardening-convex-complete.log`                                 | **0**.                                                                                                                             |
| `pnpm ci:codegen`, `/tmp/employee-hardening-codegen-verified.log`                                                               | **0**; generated files match pinned CLI. Private disposable local backend only; no cloud/shared backend.                           |
| `pnpm ci:test-discovery`, `/tmp/employee-hardening-discovery-verified.log`                                                      | **0**, 383 Vitest files / 17 Playwright spec files. Discovery is not browser execution.                                            |
| Changed tracked files through `pnpm exec prettier --check`, `/tmp/employee-hardening-format-verified.log`                       | **0**; subsequent test/doc formatting applied with the same formatter.                                                             |
| Impeccable detector over the two changed production UI files                                                                    | **0**, `[]`; `/tmp/employee-hardening-impeccable.json`. No rendered-app accessibility/layout claim.                                |
| `git diff --check`                                                                                                              | **0**.                                                                                                                             |

```sh
pnpm exec vitest run \
  src/features/hr convex/model/hr \
  tests/integration/hr-*.integration.test.ts tests/integration/hr-parity \
  tests/integration/public-function-contract.integration.test.ts \
  tests/integration/public-api-registered-coverage.integration.test.ts \
  tests/integration/production-schema-compatibility.integration.test.ts \
  tests/integration/schema-contracts.integration.test.ts \
  tests/integration/tenant-index-policy.integration.test.ts \
  tests/isolation/schema-policy-guards.isolation.test.ts \
  --maxWorkers 2
```

The final broad run followed the production error-precedence correction. An extra caller assertion afterwards checks Forward after successful completion → next Back; all four new assertions passed in the first run, but that run exposed an immediate-URL assertion in retained U2 under concurrent quality-gate load (24 passed/1 failed). U2 now awaits the same exact URL with the existing default `waitFor` deadline, matching the other caller assertions. No timeout was raised, no expected destination changed, and no production behavior was changed to accommodate it. The final caller/navigation rerun results are recorded below.

## Owned processes and cleanup

All command execution was in this checkout. Session identifiers (CLI/test ownership) are retained here so failures are not erased from the record:

- Install `48353` (0); checksum-verified task-local Bun install `23656` (0).
- Baseline adverse run `98962` (expected 1); initial focused green `98340` (0); expanded test corrections `74683`, `11909`, `45662` (1); corrected focused runs `4843`, `16540`, `53873` (0).
- Initial TS/lint/discovery corrections: `91437`, `33015` (2), `61048`, `73047`, `35623`, `90854` (1), `99503` (2). Intermediate successful checks: `48120`, `66470`, `94817`, `89506`, `71996`, `31778`, `78876`, `5271` (0).
- Additional probation red `29165` (expected 1); exact combined case `25022` (0); initial broad `13446` (1); preserved legacy/error-precedence regressions `25274` (0); final broad `20613` (0).
- Codegen sessions `31785`, `51549` (0): the script owned and stopped its private disposable backend and removed its temporary home/data. No app server, browser, 3100/3320 listener, detached watcher or external tenant process was started here.
- Final checks: Bun `7236`, lint `2596`, navigation `14736`, discovery `62919`, formatting `27167`, TS6 `98098`, Convex types `20058` (all 0). Extra Forward caller run `43069` (1, timing assertion corrected as described above). Final caller/navigation sessions are appended below.

Every listed session has completed; no owned process was intentionally left running. Other lanes' processes were not stopped or changed. Installed dependencies, task-local Bun cache and local `/tmp/employee-hardening-*` logs remain as artifacts; the temporary copied combined test was removed. The final process inspection only checks this checkout's CLI paths, without touching other lanes.

## Final source and handoff

- `c30b87e04da1ef416b2060a9cc7222f631e20788` — employment intervals, authoritative chronology, ACTIVE assignment validation, final open-shift refusal, backend recovery registration, and 21 registered hardening cases.
- `fbbd1f7a7a023f73d0e4da120b65971c8e06795b` — pinned caller sessions, stale feedback, shared UI date validation/bounds, three client recovery intents, translations and exact navigation inventory evidence. Also narrows the shared validator's field type for the caller.
- This evidence-only commit follows those two production/test commits. The combined checkpoint already contains the dependency baseline; integration should apply these incremental fixes and this evidence, not reapply the nine baseline cherry-picks.

Final caller run: **0, 25/25**, including all four success → next Back → Forward cases, `/tmp/employee-hardening-callers-final.log`, 23:45:01 Bangkok. Final navigation: **0, 68 fixtures passed**, 58 route/error policies / 304 state/overlay owners / 26 action intents, `/tmp/employee-hardening-navigation-complete.log`. Sessions `31424` and `54147` both completed 0. The final test-only ESLint check, session `89371`, also completed 0; full normal ESLint had already passed. No timeout setting, test discovery rule, authorization rule or test exemption was changed.

Final checkout process inspection reported no matching CLI processes under this checkout's node_modules or task-local Bun paths. All codegen/test/install/check sessions are complete; no owned service/listener remains. Final source has no browser acceptance claim and awaits the coordinator's independent cross-check.
