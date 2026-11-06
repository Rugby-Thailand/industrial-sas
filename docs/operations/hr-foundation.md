# HR foundation: organization, employees, shifts and roster

This page describes the HR foundation: what it implements, what it defers, how it
stays compatible with existing data, how to test it, and its known limits.
The research specs remain in `docs/plans/hr-parity/0{1,2,3}-*/`.

## Implemented

- **Company and organization (S01).** Company profile (Thai/English name,
  13-digit tax ID, address, bank accounts, logo with revision fencing),
  Revenue Department branches with Social Security employer accounts,
  departments, positions and position levels. Employees reference branch,
  department, position, level and supervisor. Payslip downloads carry the
  company employer block.
- **Inactive work rules (S02).** Work-condition and OT settings are stored and
  validated on the LEAVE policy only. They change no attendance, leave, OT or
  payroll behavior (`WORK_RULES_EXECUTION`). See
  `docs/plans/hr-parity/02-rules-calendar-roles/work-rules-foundation.md`.
- **Employee profile, payment and lifecycle (S03).** Personal, contact and
  emergency details; private payment details (masked outside the authorized
  editor; audit stores no values); probation confirmation, offboarding
  (resignation/termination with reason and last working day) and
  reinstatement as dated employment intervals with an event history.
- **Fixed shifts and dated roster (S04).** Up to 99 named fixed shifts per
  workplace, and a monthly roster of SHIFT/OFF/Clear for up to 50 employees ×
  31 days (1,550 cells) in one atomic, revision-checked save. Assigned dates
  snapshot the shift version. Live plans (Today, period preview, paged draft
  view, staged close) use: recorded day, then site holiday, then dated
  assignment, then the weekly schedule. The 50-employee bound applies to all
  eligible employees at the workplace before search or department filtering;
  larger workplaces are refused rather than shown partially.

## Locks and integrity rules

A roster date refuses changes when it has recorded attendance, a frozen plan,
an active leave claim, falls outside employment, or is covered by a CLOSED or
CLOSING period (`PERIOD_CLOSED` / `HR_PERIOD_CLOSING`). While a site has a
staged close in progress, employee saves and lifecycle changes on that site
are refused with `HR_PERIOD_CLOSING`. A staged close also discards its build
if a roster row on the site changed after its snapshot. Leave approval refuses
dates that employment no longer covers.

## Workplace terminology

HR calls an employee's `warehouseId` site its **Workplace** (Thai
สถานที่ทำงาน). Storage pages keep **Warehouse** (คลังสินค้า). The legal
company **Branch** (สาขา) is the separate `hrBranches` record. Each HR page
chooses its workplace in-page; the sidebar's storage warehouse selector does
not scope HR, so the shell hides it on `/hr` routes.

## Compatibility and permissions

- New tables are additive; no existing field is removed. Legacy employees
  without lifecycle fields keep their stored status and stay editable, and
  callers that omit new fields never erase them (only an explicit empty value
  clears). See `docs/operations/backend-compatibility.md`.
- HR admin functions require `hr.admin.manage` and the actor's site scope;
  other tenants and out-of-scope sites read as not found. Payment details
  never reach registry lists or audit payloads.
- Employee editor writes recover by request ID after reload without
  replaying private drafts; an expired write shows as unconfirmed (FENCED).
- `staging/hrDemo` local-test mutations are internal and refuse outside the
  local bootstrap organization.

## Deferred

Bulk employee actions (S03-08), final leave settlement (S03-22), disabling a
departing employee's login (S03-23), scheduled (future-dated) lifecycle
changes, rotating shift patterns, roster recalculation of frozen dates, Thai
province/district master data, multi-company tenants (S01-05), and every
slice 05–09 payroll, tax, discipline and expense calculation. Whether site
holiday or weekly-schedule edits after a leave submission should be refused
is an open product decision; today approval records the captured plan.

## Tests

```sh
pnpm exec vitest run --project integration tests/integration/hr-parity \
  tests/integration/hr-work-rules-policy.integration.test.ts
pnpm exec vitest run --project unit --project a11y src/features/hr src/components/shell
pnpm check:navigation && pnpm lint && pnpm typecheck:ts6
```

`pnpm test:e2e:hr:local` runs the opt-in real-browser suite against a local
Clerk test session and Convex; see `tests/e2e/hr-local/README.md` for setup.

## Evidence and known limitations

- Integration and component suites above pass on the merged tree (see the PR
  description for counts).
- The 2026-11-04 local preview audit for PR #124 completed 82 distinct
  desktop/mobile Chromium cases: the latest relevant executions have 81
  passes and one no-action mobile clock skip. These are bounded groups, not
  one uninterrupted suite; the earlier failed attempts remain in private
  evidence. All 30 employee/lifecycle/recovery and four authenticated role
  cases passed. The roster month field was also visually checked in Thai on
  desktop and mobile after widening it to show the full year.
- Leave readiness was checked both with the retained active policy and in a
  fresh inactive database. Real submission, reservation and roster claim
  locking passed on a small fresh site. Approval by a separate reviewer is
  still untested: the single authorized test identity correctly receives
  `SELF_REVIEW`. Original local data was restored byte-for-byte afterward.
- The audit used real local Next/Convex and Clerk TEST authentication, not a
  remote PR deployment. Physical devices and full Thai workflow coverage are
  outside this evidence. See the PR for current CI and exact source commits.
- A pending leave request whose dates fall outside employment after
  offboarding cannot be approved; it stays reserved until withdrawn.
- Write recovery is fenced by actor, tenant and operation, not by employee.
