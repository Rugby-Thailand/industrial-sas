# Overnight lane: employee profile and lifecycle (slice 03)

- Agent: Claude Opus 5.5 (implementation sub-agent). No sub-agents or CLI agents spawned.
- Checkout: `/Users/macbook/.t3/worktrees/industrial-sas/t3-0768cfe9`, branch
  `t3/employee-profile-lifecycle-slice03`, base `a2e964e2`. Not pushed, not deployed, no shared
  HRZoft demo writes.
- Window: 2026-11-01 ~22:30 – ~23:55 Bangkok.

## Commits

Inherited foundation (cherry-picked from `t3-7d8d024b`, unchanged):

- `47f36c35` ← `92fe30f0` feat(hr): Phase 1 organization and employment foundation
- `81c1cb58` ← `857d9f8e` fix(hr): object args for company logo command

Slice 03 (this lane):

- `dc26a397` feat(hr): employee profile, private payment details and lifecycle backend (S03)
- `e40127a1` fix(hr): keep omitted profile/payment fields; clear only on explicit empty values (S03)
- `1a53d2b1` feat(hr): employee profile, payment and lifecycle sections in the editor (S03)
- (this file + copied `03-employee-offboard/spec.md`) docs commit after `1a53d2b1`

Foundation corrections (org-field replacement marker, stale logo removal, `eb5542ac`) were **not**
applied here, as instructed; nothing in slice 03 depends on them. The six foundation org fields are
untouched by this lane.

## What was built

Model (`convex/model/hr/lifecycle.ts`, `profile.ts`, `employeeProfileSchema.ts`):

- Stored `status` stays `ACTIVE|INACTIVE` for every existing consumer (clock-in, review, periods,
  self). A derived `employmentState` = `PROBATION|ACTIVE|INACTIVE|RESIGNED|TERMINATED` comes from
  `status`, `probationEndDate` (slice 01), new optional `probationConfirmedDate` and `separation
{type, lastWorkingDate, reason}`. Legacy records need no migration.
- Transitions take effect when recorded. Scheduled changes are **refused, not faked**:
  probation confirmation ≤ today; offboarding needs a last working day **before** today (so nobody is
  made INACTIVE, unable to clock in/out, on a day they still work); reinstatement is after the last
  working day and ≤ today. All dates must be ≥ employment start. Reason 3–500 chars for exit/reinstate.
- `hrEmploymentEvents`: append-only (type, effectiveDate, reason, from/to state, employeeVersion,
  recordedAt/By). Never patched or deleted.
- `hrEmployeeProfiles` (personal/contact/emergency) and `hrEmployeePayments` (BANK|CASH, bank,
  account number 6–20 digits, account name, branch code), one row per employee, versioned.
  Thai national ID check digit, e-mail, phone, 5-digit postcode, birth date 1900..today, and an
  emergency contact needing a name and phone.

Convex (`convex/hr/employeeProfile.ts`, all `hr.admin.manage` + site scope, writes via `hrCommand`
with requestId idempotency, version checks and audit):

- `employeeProfile` / `saveEmployeeProfile`, `employeePayment` / `saveEmployeePayment`,
  `employeeLifecycle` / `recordEmploymentEvent({ kind: CONFIRM_PROBATION|OFFBOARD|REINSTATE })`.
- **Explicit update contract** (after review note): omitted profile/payment fields keep their stored
  value; `""` clears; validation runs on the merged record. Choosing CASH explicitly clears bank
  fields. Lifecycle fields are not `saveEmployee` arguments, so older editor payloads keep them.
- Audit stores changed field **names only** for profile/payment (no values); lifecycle audit records
  state names. Profile/payment never appear in `employeesPage`, `listEmployees`, `employee`, search
  or self-service (asserted).
- `saveEmployee` refuses `EMPLOYEE_SEPARATED` if an offboarded record is set ACTIVE or its last day
  moved; other edits keep working.
- `employeesPage.status` widened (additive): omitted = current employees (not offboarded);
  `ACTIVE`/`INACTIVE` keep stored-status meaning; `PROBATION`, `FORMER`, `ALL` added. Registry items
  add `employmentState`, `probationConfirmedDate`, `separation {type,lastWorkingDate}` (no reason).
- Offboarding never touches users/memberships/roles (S03-23 is unknown; asserted unchanged).

UI (`src/features/hr/EmployeeProfileSections.tsx`, `EmployeesScreen.tsx`, `EmployeeForm.tsx`):

- Below the existing employment editor: Employment lifecycle (state badge, dates, actions,
  newest-first history), Personal, Contact + Emergency contact, Payment details (masked `•••• 7890`
  outside the editor; "visible to HR administrators only, no pay calculated or transferred").
- Every Edit/lifecycle action uses the shared Back-aware `Dialog` (BranchesPanel pattern): Back or
  Cancel asks before discarding a typed draft, pending saves block dismissal, success settles the
  guard and consumes the Dialog entry. The employment form's Cancel therefore can't silently drop
  another section's draft (sections aren't inline forms).
- Offboard dialog states sign-in/HR roles are unchanged and leave balances are not settled here.
  Date inputs carry `max`; client mirrors server bounds.
- Registry: truthful badge + "Last day …"; status filter Current (default) / Active (incl. probation)
  / On probation / Inactive / Former / All; URL-backed. The employment form disables ACTIVE for an
  offboarded record with a hint to use Reinstate.
- en + th messages (Thai written by the agent; not native-reviewed).

Navigation inventory: two new overlay states
`EmployeeProfileSections.tsx#EmployeeProfileSections:target` and
`#SectionDialog:$overlay:Dialog:target`, citing the caller cases below. No routes or actions added.

## S03 task status

| ID                                                                                                                     | Status                       | Notes                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S03-10 Personal fields                                                                                                 | partly                       | title, first/last (+EN), nickname, gender, birth date, national ID, nationality, religion, marital status. Not: blood group, military, weight, height. |
| S03-11 Contact fields                                                                                                  | partly                       | email, phone, LINE ID, address, province, postcode. Not: LINE name, district/sub-district masters, "same as ID address", coordinates.                  |
| S03-12 Emergency contact                                                                                               | delivered                    | name (single field), relationship, phone.                                                                                                              |
| S03-13 Bank account                                                                                                    | delivered                    | pay type bank/cash, bank, account no., account name, branch code; admin-only.                                                                          |
| S03-16 Edit + Cancel without persisting                                                                                | delivered                    | profile/payment/lifecycle dialogs.                                                                                                                     |
| S03-17 Probation confirmation                                                                                          | delivered                    | dated, ≤ today, idempotent retry, no backwards move.                                                                                                   |
| S03-18 Effective-dated history                                                                                         | delivered (immediate-effect) | append-only events; no scheduled/as-of reads.                                                                                                          |
| S03-19 Terminal status + last day                                                                                      | delivered                    | last day < today; record retained.                                                                                                                     |
| S03-20 Default list excludes offboarded                                                                                | delivered                    | default = current; FORMER/ALL shows them.                                                                                                              |
| S03-21 Resignation/termination + reason                                                                                | delivered                    | reason private to lifecycle reads.                                                                                                                     |
| S03-25 One account link                                                                                                | invariant asserted           | existing behavior; link survives offboarding.                                                                                                          |
| S03-02 Status filter default                                                                                           | partly                       | default is "current" (active, probation and legacy inactive), not HRZoft's exact "Active".                                                             |
| S03-03 Search                                                                                                          | preserved                    | correct under the new default (asserted).                                                                                                              |
| S03-09 Tabbed profile                                                                                                  | partly                       | sections on the existing editor page, not 15 tabs (no inert tabs).                                                                                     |
| S03-14 Salary presence, S03-15 Documents, S03-22 Leave settlement, S03-24 Excel import, S03-01/04/05/06/07 list chrome | deferred                     | no placeholders or dead buttons added.                                                                                                                 |
| S03-08, S03-23                                                                                                         | unknown (not implemented)    | S03-23 asserted as "login/roles unchanged".                                                                                                            |

## Tests

Registered Convex integration (`tests/integration/hr-parity/03-employee-offboard.test.ts`, 13 cases,
real handlers on convex-test, nothing mocked): S03-17, S03-18, S03-19, S03-20, S03-21, S03-25,
attendance readable after offboarding (self history + HR audit), legacy records, concurrent stale
saves, profile validation/persistence/no-leak, payment privacy, tenant/site/permission denial for
all six functions, and omitted-field preservation / explicit clearing.

Domain units: `convex/model/hr/lifecycle.test.ts` (4) and `profile.test.ts` (5) incl. date
boundaries (yesterday ok, today refused, start date ok, start−1 refused).

UI caller tests (`src/features/hr/EmployeeProfileSections.test.tsx`, 8 cases, real
`HrEmployeesScreen` + editor, Convex client mocked at the hook boundary — **component tests, not
e2e**):

- employee profile Edit -> explicit Cancel -> next Back closes the editor to the filtered list
- a dirty personal-details draft asks before Cancel or native Back discard it, and Keep editing retains it
- a pending contact save blocks Cancel and native Back, then the saved dialog consumes its entry before the next Back
- native Back closes a clean payment editor and Forward reopens it
- recording a resignation refuses today, sends a past last working day with a reason and consumes its dialog
- an offboarded employee shows its history, offers reinstatement and cannot be switched active in the form
- the registry defaults to current employees and filters former employees through the URL
- a remounted editor shows the saved profile again from the server

Red checks: allowing `lastWorkingDate == today` failed 2 tests (domain + S03-19); disabling the
profile dialog draft guard failed the dirty-draft caller case. Both restored.

## Commands (final state)

| Command                                                                                                                                                                                                                         | Exit | Result                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `vitest run --maxWorkers=2 src/features/hr convex/model/hr tests/integration/hr-parity` + pagination, workflows, global-search, schema-contracts, schema-policy isolation, registered coverage, public contract, access handoff | 0    | 56 files, 902/902                                                                                         |
| `pnpm lint`                                                                                                                                                                                                                     | 0    | clean                                                                                                     |
| `pnpm typecheck:ts6`                                                                                                                                                                                                            | 0    | clean                                                                                                     |
| `pnpm check:navigation`                                                                                                                                                                                                         | 0    | contract OK: 58 route/error policies, 303 state/overlay owners, 26 action intents                         |
| `pnpm ci:codegen`                                                                                                                                                                                                               | 0    | `convex/_generated matches the pinned Convex CLI output`                                                  |
| `pnpm ci:test-discovery`                                                                                                                                                                                                        | 0    | 382 Vitest files, 17 Playwright specs                                                                     |
| `UPDATE_PUBLIC_CONTRACT=1 … public-function-contract`                                                                                                                                                                           | 0    | additive refresh (new module; widened `employeesPage.status`, profile `gender/maritalStatus` accept `""`) |

Not run: full `pnpm test` (whole repo), `pnpm typecheck` (bun checker unavailable per foundation
lane), any Playwright/browser test. **No browser verification is claimed.** The 03 e2e skeleton in
the main checkout is still `fixme` and was not added (not collected without the harness config).

## Known limitations / for review

- Payment details are gated by `hr.admin.manage` (+ site scope) on dedicated functions; there is no
  separate payroll permission. Any in-scope HR admin can read the full account number in the editor.
- No same-day or scheduled offboarding; HR records it after the last day. Reinstatement does not
  re-run the foundation's department/position requirement (`requiresAssignment` not revisited).
- Old open tabs: `employeesPage` without `status` now hides offboarded people; an old EmployeeForm
  re-saving an offboarded record as ACTIVE is refused (`EMPLOYEE_SEPARATED`), never silently applied.
- The default list keeps the unfiltered read chunk (former employees are rare), so a sparse page may
  take extra scan requests. While testing, a forged-lane cursor with `finished: true` under the
  filtered chunk path returned `ready` instead of `reset` in `hr-pagination` (pre-existing pagination
  behavior; avoided by keeping the original chunk sizing, not changed). Worth an independent look.
- Lifecycle history reads the newest 100 events (UI says so). The employee audit panel doesn't label
  lifecycle changes; the lifecycle section shows them.
- Thai copy is agent-written.

## Processes

Only foreground/awaited commands: vitest (two background runs `bm0ums58n`, `bz3agiqbx`, both
finished before handback), eslint, tsc, `next typegen`, `pnpm install --prefer-offline`,
`ci:codegen` (starts and cleans its own isolated local backend). No dev servers or browsers started.
No processes owned by this lane remain.
