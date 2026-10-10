# HR Phase 1 — implementation review

Implements `docs/specs/hr-phase-1-requirements.md` (v1.0, 2026-10-09). Phase 2/3 roadmap items are not built.

Final root validation passed: typecheck, lint, 145 files / 1,200 tests (one Vitest worker), production build with all 10 HR routes, and changed-file formatting. Earlier concurrent-run timeouts and browser coverage limits are recorded below.

## What works end to end

A linked employee clocks in/out online with server time, sees today/history/profile, and requests corrections. A supervisor (assigned reports, in site scope) or HR certifies or returns requests and accounts for missing days, including for employees without accounts. HR maintains employees, schedules, holidays and HR access. HR creates a site period, closes it into an immutable version, starts reasoned revisions, and downloads CSV v1 for any closed version. Every workflow runs through the real Next.js UI and authenticated Convex functions.

## Design summary

- **Permissions** (`convex/model/authorization/navigationPermissions.ts`, `convex/lib/permissions.ts`): `hr.self.access`, `hr.team.review`, `hr.admin.manage`, `hr.period.close`, `hr.period.export` (ORG scope). Each handler also checks site scope from `membershipWarehouses`, and supervisors also need the reporting relationship. Planner grants are now an explicit `PLANNER_PERMISSION_CODES` list, so warehouse managers keep exactly their four planner codes and get no HR. `ORG_ADMIN` = planner + all HR. New roles: `HR_EMPLOYEE`, `HR_SUPERVISOR`, `HR_ADMIN`.
- **Existing organizations**: `provisionHrForOrganization` (internal `hr/provisioning:provisionOrganization`) inserts missing permissions/roles. It upgrades `ORG_ADMIN` only when it is the untouched seeded legacy role and reports `CUSTOMIZED` otherwise. It can optionally grant `HR_ADMIN` to one membership. HR admins grant `HR_EMPLOYEE`/`HR_SUPERVISOR` in HR settings.
- **Shell boundary**: `HrAccessProvider` queries `hr/access:current` separately from the storage workspace query. The sidebar merges both grant sets and treats a storage denial as a settled answer. `HrLandingRedirect` sends HR-only members from planner pages to their first HR page. Planner members' storage navigation is unchanged.
- **Member directory** (`convex/lib/memberDirectory.ts`, `ctx.members`): resolves users only through a membership of the active organization (the global `users` table is otherwise unreachable from tenant handlers).
- **Domain rules** (`convex/model/hr/*`, pure): fixed-offset business dates, plans, overnight shifts, evaluation, worked/outside minutes, period rows/totals/readiness and fingerprint, CSV v1, employee validation.
- **Writes** go through `hrCommand` (`convex/hr/shared.ts`). The request ID + actor + payload fingerprint gives exact replay, and a conflicting reuse is rejected. Refusals are returned rather than thrown, so the authorization audit row and the DENIED command audit row persist. Successful writes record ALLOWED audit with changes. A replay re-checks current access (export).
- **Immutability**: each recorded day captures its plan. A certification is valid only for the day revision it was made against (a later punch invalidates it). Replaced certifications are kept in `certificationHistory`. Closing recomputes rows inside the mutation, requires the reviewed fingerprint, and writes `hrPeriodVersions` + `hrPeriodRows`. Exports read only frozen rows. Writes into closed periods are refused.

## Requirement mapping

| Req        | Implementation                                                                                                                                                                                                                                                                | Tests                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| HR-001     | `queryWithOrg`/`mutationWithOrg` everywhere; employee derived from actor; `reviewBlocker`, `siteOf`, `inScope`                                                                                                                                                                | `hr-workflows` (A3, foreign/self/other-supervisor), independent regressions                           |
| HR-002     | `permissions.ts`, `authorizationSeedConvex.ts`, `hr/provisioning.ts`, settings access panel                                                                                                                                                                                   | `hr-workflows` roles/provisioning                                                                     |
| HR-003     | `src/lib/navigation.ts` HR section, `c-sidebar-2.tsx`, `HrLandingRedirect`                                                                                                                                                                                                    | browser check, `hr-workflows` A15                                                                     |
| HR-010/011 | `hr/setup.ts` save/list/memberOptions; `EmployeeForm`, `EmployeesScreen` (bounded member selectors, no IDs typed)                                                                                                                                                             | `hr-workflows` setup                                                                                  |
| HR-012/013 | schedule on employee, `planFor`, captured `plan`; `hrHolidays`, Settings holidays                                                                                                                                                                                             | `attendance.test.ts`, period tests                                                                    |
| HR-014     | `self.profile`, `ProfileScreen`                                                                                                                                                                                                                                               | browser check                                                                                         |
| HR-020–023 | `self.today/clockIn/clockOut`, `TodayScreen`, `useHrWrite` (stable ID in memory + session storage, pinned retry, UNCERTAIN state)                                                                                                                                             | `hr-workflows` A1/A2/A4/A5, `HrScreens.test.tsx`, independent UI tests                                |
| HR-024/025 | `self.history/dayDetail`, `DayDetailView`; `calendar.ts`, `attendance.ts`                                                                                                                                                                                                     | model tests, `hr-workflows`                                                                           |
| HR-030–034 | `self.submitCorrection`, `review.queue/dayDetail/decideCorrection/disposeDay`, `ReviewScreen`, `ReviewDetail` (exception disposition, "Review again" for an unlocked certified day, business date as the record heading)                                                      | `hr-workflows` A7–A9, `hr-review-completion`, `HrReviewCompletion.test.tsx`, component decision tests |
| HR-040–043 | `hr/periods.ts`, `PeriodsScreen`, `PeriodDetailScreen` (newest-50 version list + validated version-number picker), `csv.ts`; closed preview/export use frozen site/timezone and stay reachable with an unsupported current timezone                                           | `hr-workflows` A10–A13, `hr-review-completion`, CSV unit tests                                        |
| HR-044     | No step-up is wired; the pilot uses authenticated HR permission and states this in UI/settings                                                                                                                                                                                | — (limitation below)                                                                                  |
| HR-050     | `hrCommand` audit rows with request ID/outcome/changes; day detail shows the current certification plus `certificationHistory` (actor, time, result, times, reason) and newest-first correction history with a completeness flag; employee form shows labelled change history | `hr-workflows`, `hr-review-completion`, `HrReviewCompletion.test.tsx`                                 |
| HR-051     | Additive tables/indexes classified in `schemaPolicy.ts`; codegen via `pnpm codegen`; every bounded list returns `complete`/`LIMIT_EXCEEDED` (site scope, employees, review queue, period list, holidays, correction and employee history)                                     | schema policy + production compatibility tests, `hr-review-completion`                                |
| HR-052/053 | Shared primitives, th/en messages (`Hr` namespace), gated states, no fixture fallbacks                                                                                                                                                                                        | browser check, `messages.test.ts`                                                                     |
| HR-054     | `convex/staging/hrDemo.ts`, `pnpm dev:seed --hr`                                                                                                                                                                                                                              | `hr-demo-seed.integration.test.ts`                                                                    |

Acceptance A1–A16 are each covered by the tests above. A16 is covered by the browser run below.

## Review completion pass (2026-10-09, after root review)

Resolved the still-applicable points in `output/hr-implementation/root-review-notes.md`:

1. **Revision edit of a certified day** — `ReviewDetail` offers "Review again" for a current, unlocked certification (e.g. an unlinked employee in a reopened draft). It opens the disposition form prefilled from the certification, requires a reason and sends `expectedRevision` (stale edits are refused). Closed days show no edit control. The record heading leads with the business date. `disposeDay` accepts a certified day and refuses beyond 50 re-certifications (`CERTIFICATION_HISTORY_LIMIT`), never pruning.
2. **Decision history** — a replaced certification is appended to `hrAttendanceDays.certificationHistory` (additive optional field) and shown as "Earlier decisions". Correction history reads the newest 20 requests (`take(…, "desc")`, a new optional order on the tenant index reader), always includes the pending request, and reports older ones.
3. **Bounded lists** — `siteScope`/site lists keep at most 50 sites and report `complete: false` (conservative: a truncated scope only hides, never widens). Review queue returns `LIMIT_EXCEEDED` for an incomplete scope or more than 500 items. Period list returns `complete` (newest 200). Employee list per site is 99 with `complete`. Holidays newest 99 with `complete`. Employee change history newest 20 with `complete`. `HrGate` shows a scope-limit notice to privileged pages.
4. **Versions** — the selector lists the newest 50 versions; when more exist a validated number picker (1–latest) opens any version, and an opened older version stays in the list. Periods list includes inactive in-scope sites, labelled.
5. **Replay** — `hrCommand` refuses with `REPLAY_RESULT_UNAVAILABLE` when a replay callback cannot rebuild its result. Export replay re-checks current scope (`NOT_FOUND`). Clock replay answers only the recording actor.
6. **Uncertain intents** — `useHrWrite` prefixes every intent with organization + actor, pins the sent command per intent, and its `submit` resends the pinned command while uncertain. `run` keeps sending what it is given, preserving root's storage-unavailable contract. A late result after the intent changed or the form unmounted returns `IDLE`, so banners, navigation and downloads are skipped. Correction scope includes the employee. Holiday delete and access toggles are per record/role. The Today receipt and pinned clock intent are keyed by employee.
7. **Employee audit labels** — localized field labels; old→new values only for code, name, dates and status; site/account/supervisor/schedule are reported as "changed" without IDs.
8. **Unsupported timezone** — period list/detail bypass the live-timezone gate with a visible notice. Closed preview and export use frozen metadata. The draft view reports `TIMEZONE_UNSUPPORTED`, and period creation is refused. Other live operations remain refused as before.

New tests: `tests/integration/hr-review-completion.integration.test.ts` (6) and `src/features/hr/HrReviewCompletion.test.tsx` (7). Root's independent contract assertions are retained and pass.

## Files and routes

- Backend: `convex/hr/{access,self,review,setup,periods,dayDetail,shared,provisioning}.ts`, `convex/model/hr/*`, `convex/lib/memberDirectory.ts`, `convex/staging/hrDemo.ts`. Modified: `schema.ts`, `lib/{permissions,authorizationSeedConvex,schemaPolicy,tenantFunctions,navigationGrants}.ts`, `model/authorization/navigationPermissions.ts`, regenerated `convex/_generated/api.d.ts`. The pre-existing `server.d.ts`/`server.js` edits are preserved.
- UI: `src/features/hr/*`, `src/components/providers/HrAccessProvider.tsx`, `src/components/shell/HrLandingRedirect.tsx`, `src/lib/convex/hrApi.ts`. Modified: `c-sidebar-2.tsx`, `AppProviders.tsx`, `navigation.ts`, `clientMessages.ts`, `messages/{th,en}.json`, `scripts/seed-local-test.mjs`.
- Routes (`/{th|en}`): `/hr` → `/hr/today`, `/hr/time`, `/hr/time/[date]`, `/hr/profile`, `/hr/review`, `/hr/employees`, `/hr/periods`, `/hr/periods/[periodId]`, `/hr/settings`.

## Checks

Final pass (2026-10-09, ~11:40):

- `pnpm typecheck` and `pnpm lint` (inside `pnpm check`): passed.
- `pnpm test` (inside `pnpm check`): 145 files; 1198 of 1200 tests passed. The 2 failures were 5 s timeouts in non-HR files: `pd-import.integration.test.ts` and `StorageLayoutScreens.test.tsx`. During the run the machine had a load average of about 40 from unrelated processes (a Go test binary, postgres). Re-run alone with the default timeout, both files passed (71/71). An earlier run under similar load timed out in other non-HR files; those passed (146/146) when re-run alone. The first pass's full `pnpm check` (lower load) passed 143 files / 1185 tests.
- HR suites (model, `hr-workflows`, `hr-demo-seed`, `hr-review-completion`, root `hr-independent-regressions`, all HR component tests incl. root's independent ones, i18n): 15 files / 106 tests passed.
- `pnpm build`: passed; all 10 HR routes built.
- Prettier `--check` on changed/new files: clean.
- `pnpm codegen` (local anonymous deployment) regenerated `convex/_generated/api.d.ts`. The pre-existing `server.d.ts`/`server.js` edits are unchanged.
- `pnpm audit:prod`: not required (no dependency changes).

Browser evidence:

- First pass: a 56-check matrix (7 HR routes × th/en × light/dark × 390/1440 px; one h1, no page overflow, no runtime errors).
- Root separately verified the revision/close/export flow including "Review again"; see `output/hr-implementation/csv-browser-verification.json`.
- This pass's UI changes (version-number picker, scope/period/holiday/history completeness notices, audit labels, timezone bypass) were **not** browser-checked by me; they are covered by component and integration tests only.

## Independent root verification

Final `VITEST_MAX_WORKERS=1 pnpm check` passed: typecheck, lint, 145 test files / 1,200 tests. The installed Vitest worker limit was set only for this invocation; the repository configuration, assertions, and default 5-second test timeout remain unchanged. Log: `output/hr-implementation/root-final-check.log`. Changed-file Prettier checks passed for 78 files and `git diff --check` passed. All 103 baseline generated/import/prototype file hashes still match (`final-preservation-check.json`); both Kiro runs exited 0.

Final independent `pnpm build` also passed with all 10 HR routes (`output/hr-implementation/root-final-build.log`). No dependencies, commits, pull requests, or deployments were added.

After Kiro completed the review pass, root added a regression proving that a recently resubmitted older correction remains in the newest history after being returned. It failed against creation-order selection and passes with the additive `by_orgId_dayId_submittedAt` index. Root also returned the completeness flag on normal draft previews, filtered employee history to actual allowed save changes, and rechecked current site access when replaying a close receipt.

Real authenticated collaborative-browser checks covered server clock-in/out persistence, overnight correction certification, re-reviewing a certified day for an unlinked employee, prior decision history, two-step close, reasoned revision creation, holiday setup/removal, and employee edits/restoration. See `output/hr-implementation/root-browser-workflows.md` and `browser-checks.json`. The local demonstration period is now closed as v3; the fixture generator itself still creates v1 plus a v2 draft.

CSV bytes were captured from the application's actual download Blob, preserving the UTF-8 BOM. Both files have 21 rows and 15 columns. Frozen v1 stayed byte-identical after re-review and closing v2 (SHA-256 `7da27c90803fe9e1777efacb80afdbc4206e70cbcbdfbdf2e0c1de774355399d`). V1 has 4,672 worked minutes; v2 has 5,152 after the unlinked employee's September 25 disposition changed from LEAVE/0 to WORKED/480. Both retain 52 outside-shift minutes. Evidence: `output/hr-implementation/csv-browser-verification.json` and `export-v1-before.csv`, `export-v1-after.csv`, `export-v2.csv`.

The root browser checks include Thai/English, light/dark, labelled forms, and 390/1280 px layouts. They do not constitute a live sign-in test for every role; authorization boundaries and remaining capacity/timezone cases are covered by integration/component tests.

## Local fixture

```sh
ALLOW_LOCAL_TEST_SEED=true pnpm dev:seed --hr   # guarded: anonymous/local deployment + loopback URL + flag
pnpm dev:login                                   # then open /th/hr/today
```

The seed is idempotent and internal-only. It provisions HR and adds a supervisor and a night-staff member (no login). It creates EMP-DEMO-001 (the test account), EMP-DEMO-002 (no account) and EMP-DEMO-003 (22:00–06:00). Data covers ordinary days, missing records, a certified correction, a pending overnight correction, two site holidays, and a period closed as v1 then reopened as a v2 draft with a reason. Output is under `hrProfile` in `output/local-test-data.json`. For an existing organization, run `pnpm exec convex run hr/provisioning:provisionOrganization '{"clerkOrganizationId":"org_…"}'`.

## Limitations

- **No step-up re-verification** (HR-044). Close/export rely on authenticated HR permissions; production adoption needs a decision.
- **Fixed-offset timezones only.** Live calculations, clocking, corrections, review and period creation/close are refused for other zones with a visible message. Closed history stays readable and exportable using its frozen timezone.
- **Online clocking records the assigned site but does not prove presence.** No GPS/QR/kiosk/offline.
- **Pilot bounds, always shown when exceeded:**
  - 50 employees and 31 days per period; 31-day history/queue ranges.
  - Review queue ≤ 500 items.
  - Site lists ≤ 50 sites (larger scopes are conservatively truncated and flagged; team review then reports a limit).
  - ≤ 99 employees per site; ≤ 200 members in selectors; newest 200 periods listed; ≤ 1000 periods per site (beyond that, a limit error).
  - Newest 50 versions in the selector (older ones open by number).
  - Newest 20 correction requests and employee changes; newest 99 holidays; ≤ 50 re-certifications per day.
- **No payroll-provider acceptance has been verified.** Mapping CSV v1 to the company's payroll process is a launch decision.
- **No leave balances or approved OT.** "Leave" is an attendance disposition only.
- **Remaining production decisions:** pilot site/people, clock policy, CSV format.
- **Site moves and deletion:** site moves are blocked once an employee has attendance. Employees are deactivated, never hard-deleted.
- **Re-certification:** supervisors/HR can re-certify a certified day in an open period (prior decisions retained). Ordinary complete days are changed only through the employee's correction request.
- **Not provisioned automatically:** HR roles for organizations created before this change, until the internal provisioning mutation runs. HR settings explains this.

## Main-target audit addendum — 2026-10-10

The preceding review is the original HR delivery record, copied from the shared checkout without changing its historical results. This addendum reviews immutable source at `2fcb86c5247f5ba7c1024ebc71fa314ccdb7509c` against main `c64a882239696122e593e493aea771a1792841e5` and `docs/specs/hr-phase-1-requirements.md`. It does not claim that the historical commands were rerun in this pass. No source, fixtures, credentials, or deployed data were changed by this reviewer.

Source inspection confirms that HR handlers use the tenant wrappers; self-service derives the employee from the actor; `reviewBlocker` requires site/reporting scope and rejects self-review; close recomputes rows and freezes a version; export reads frozen rows and rechecks site scope, including replay. The source and existing regressions also cover immutable closed history, overnight business dates, bounded completeness, uncertain-command replay, and retained decision history.

Two additional spec findings remain open at this pinned baseline:

- **HR-001, scoped member selectors:** `convex/hr/setup.ts:192–212` returns every active organization member's linked employee ID/code without checking that employee's site. A site-scoped HR administrator can receive employee metadata that `listEmployees` and `employee` refuse. Apply the same site scope before returning linked employee metadata, retain usable eligible-member selection, and add a cross-site regression.
- **HR-021, employment changes during open attendance:** `convex/hr/self.ts:88–94` returns an open `CLOCKED_IN` state before the employment-date check. `clockOut:358–386` verifies active status but does not check employment for that open business date. After an authorized employee edit excludes the open date, a new clock-out can still persist outside employment. Check the open shift's business date, preserving a valid overnight clock-out whose last employment date was the prior calendar day, and cover both cases.

The inherited HR implementation belongs to the full main-target PR. The final head SHA, repair status, and fresh required-check results must be recorded after Kiro's design implementation and fixes settle. Detailed pinned evidence is in `output/design-one-main-spec.md`.
