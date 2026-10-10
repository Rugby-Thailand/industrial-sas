# HR Phase 1 requirements

Version: 1.0 — 2026-10-09. Status: authorized for implementation by the user.

## Outcome

Add a small, working HR module to Storage Planner. A linked employee records attendance, requests a correction when needed, a supervisor checks exceptions, and HR closes an attendance period and exports certified data to the existing payroll process. Deliver the real authenticated application and persisted Convex workflows, not an image gallery or a mock-only prototype.

This specification implements **Phase 1** of the reviewed proposal. Phase 2 and Phase 3 are a roadmap, not requirements to build now. The original review is `output/hr-design-v2/scope-review.md`; the full independent review is `output/hr-design-v2/kiro-scope-review.md`.

## Decisions and pilot assumptions

- Use the current Clerk identity, organization, warehouse/site scope, Convex tenant wrappers, audit mechanisms, shared UI controls, and Thai/English localization.
- In this implementation a site is an existing warehouse. No new location-management product is required.
- The first clock method is **online, authenticated, server-timestamped attendance**. It records the selected assigned site as context; it does not prove physical presence. GPS, QR, kiosk, Beacon and offline capture are future alternatives, not simultaneous options.
- An employee may exist without a user account. Self-service clocking requires a unique linked active organization member; unlinked employees still appear in HR review and export.
- Start with one scheduled shift per employee per business date, working weekdays, optional unpaid break minutes and site holidays. Support shifts crossing midnight. There is no shift-swap engine.
- The implementation must allow authorized configuration of employees, supervisors, shifts and holidays. Do not ship hard-coded employee names or production seed data.
- A documented CSV v1 is the initial export contract. Do not claim that a payroll provider has accepted it. Mapping to the company's actual payroll format is a launch decision.
- Use explicit safe pilot bounds of at most 50 employees per site period and at most 31 business dates per period unless an implementation supports a tested paginated alternative. Return a visible limit error rather than a partial result. Lists must also be bounded.
- Production adoption still requires an owner to choose the pilot site/people, confirm clock policy and the CSV format, and determine whether leave/approved OT must move into Phase 1. These do not block building the configurable pilot.

## People, permissions and navigation

| Actor            | Allowed work                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee         | Their own profile, attendance, correction requests and request history. Clock only for their linked employee.                                           |
| Supervisor       | Review assigned direct reports within their authorized site scope; certify exceptions or send correction requests back. No self-certification.          |
| HR administrator | Maintain employees, schedules and holidays; review authorized site records; close/revise/export periods. No self-certification of their own attendance. |

**HR-001 — Authorization.** Every query and mutation resolves the active organization and verifies authorization on the server. Validate the organization of every referenced user, employee, supervisor, warehouse, request and period. Never trust client-provided employee/user identity or a hidden button as access control. Employee access remains self-only; supervisor access requires both site access and the assigned reporting relationship. An authorized HR administrator can review employees across their permitted scope, with the same self-review restriction.

**HR-002 — Existing roles.** Add explicit HR permission codes rather than deriving them from storage-layout permissions. Give organization administrators the necessary HR administration capabilities; preserve existing planner role permissions. Warehouse managers do not automatically receive private organization-wide HR administration. Provide a usable, idempotent way to provision HR permissions for existing organizations, not only new organizations. Support a self-service employee role that can reach the authenticated shell without being granted storage-management access. Default-role seeding must not silently broaden customized roles.

**HR-003 — Navigation.** Add an HR entry to the existing shell for users with HR access. Within HR, show employee destinations Today / Time and requests / Profile, and privileged destinations Review / Employees / Periods / Settings according to permissions. Do not add deferred destinations. HR-only users must not be rejected by a workspace boundary that assumes storage-layout access. Existing planner links must continue to work.

## Employee and schedule setup

**HR-010 — Employee registry.** HR can list, create and update an employee with organization-unique employee code, display name, site, optional linked member, supervisor, employment start/end business dates, and active/inactive status. Fields must have validation and understandable errors. Codes remain unique, and one account links to at most one employee per organization. Reject cross-organization account/site/supervisor references and a self-supervisor assignment. Do not hard-delete employees with history.

**HR-011 — Account and supervisor selection.** Configuration must expose actual eligible organization members and supervisors through bounded selectors; administrators must not need to type internal database IDs. A supervisor may be a member without an employee record. An employee without a linked account has a clearly labelled status and cannot clock through someone else's account.

**HR-012 — Shift.** Configure an employee's weekday schedule, local start/end time, whether the end is the following day, and nonnegative unpaid break minutes below the scheduled duration. The organization timezone is authoritative, with Asia/Bangkok as the existing default. A recorded day's planned shift is captured with its attendance so later profile edits cannot rewrite the plan that was used for that recorded day. Closed periods preserve their full schedule inputs.

**HR-013 — Holidays and nonworking days.** HR can maintain dated site holidays with a name/reason. Unscheduled weekdays and holidays are nonworking days, not absence. Work on a nonworking date must be shown as unplanned work requiring review, not discarded. Historical closed output is unaffected by later holiday edits.

**HR-014 — Profile.** Employees see their own code, name, assigned site, supervisor, employment status and schedule read-only. Official employee data is edited by authorized HR. Empty/unlinked/inactive profiles have a useful explanation instead of a fake successful attendance state.

## Attendance and personal history

**HR-020 — Today.** Show the organization's current local date, employee/site, planned shift, actual recorded events and one next clock action. Clearly separate planned times from actual events. States include not clocked in, clocked in, clocked out, nonworking day, unresolved open attendance, unlinked employee, loading and failure. The current displayed time is informational; the mutation supplies the authoritative timestamp.

**HR-021 — Clock commands.** A successful clock-in/out atomically persists the original event, its actor, request identity, source and site, and returns the saved timestamp/business date. At most one active attendance pair exists per employee/business date in this pilot. Block duplicate clock-in and clock-out without clock-in; do not fabricate a missing event. Prevent additional clock-in while an earlier day remains open. Reject inactive or out-of-employment self-service and writes into closed periods. An overnight clock-out attaches to its open shift's business date, not the next calendar date.

**HR-022 — Retry and concurrent requests.** Each command uses a stable request ID. Retrying the same operation/payload/actor returns the same saved result without another event. Reusing that ID with a different payload or actor must fail. Concurrent clocking/certification/closing cannot create duplicate records or bypass state guards. Check current access and current locks before applying a new write.

**HR-023 — Result and failure.** Confirm success only after the backend confirms persistence. Show the saved time and a history link. While submitting, disable duplicate controls. Transport or business-rule failure keeps the previous saved state and an understandable recovery action. Retry reuses the original request ID when the outcome is uncertain. Do not queue unverified offline attendance or expose raw server details.

**HR-024 — Personal history.** List the employee's own days for a selected bounded date range, including planned hours, original actual events, effective certified times, status and their correction status. Provide a per-day detail with original records, requested/certified changes, reason, actor and timestamps. Empty data must remain distinguishable from failed loading. No decorative attendance scores or unsupported claims about lateness/pay.

**HR-025 — Business dates and duration.** Store event instants in UTC and derive business dates using the configured timezone. For a cross-midnight shift, the start date is its business date. Validate real calendar dates and local times; do not parse local input as browser-local UTC. Flag an open or implausibly long day for review rather than silently auto-clocking out. Report worked minutes from the certified interval less the configured unpaid break, floored at zero. Also report minutes outside the planned interval for information only; they are not approved OT or pay. Validate corrected duration and prohibit future proposed events.

## Correction and supervisor review

**HR-030 — Correction submission.** An employee selects a date, proposes corrected clock-in/out times and supplies a reason. Support missing clock-in or clock-out and both missing events. Validate ordering, date/shift relationship, allowed duration, employment dates and future times on the server. Allow at most one pending request per employee/date. Do not modify original clock events on submission. Requests into closed periods require HR to start a revision first.

**HR-031 — Decision states.** A request has Pending, Certified or Returned states, with actor/time/reason and a captured base revision. Returning requires a reason and leaves effective attendance unchanged. A returned request can be resubmitted with retained prior decision history. Certification updates effective attendance, retains original values, invalidates stale review state and records the decision atomically. A second or stale decision fails clearly. A record changed since the displayed revision must be reloaded before another decision.

**HR-032 — Review UI.** A permitted supervisor/HR sees a scoped exception queue with employee, business date, issue and status. Selecting a row shows original and proposed times, planned shift, reason and history. Certify is the main action; Return is secondary and requires an explanation. Do not imply bulk approval. Server checks must reject guessed IDs, another supervisor's reports, self-review and closed/stale items even when the client is forged.

**HR-033 — Account for missing days.** Review must include scheduled past days with missing/no events, pending requests, implausible intervals and unplanned work, including employees without accounts. A supervisor/HR can explicitly certify an exception as corrected worked time, absent (zero worked minutes), externally recorded leave (zero worked minutes), or another nonworking day, with a reason. This is an attendance disposition, not a leave-balance engine. An absence remains identifiable in output; marking it reviewed does not invent hours or delete the exception history. A reviewer cannot dispose of their own day.

**HR-034 — Normal records.** A valid complete pair without a pending request/exception may be considered ready automatically; no approval is needed for every ordinary day. Exception certification records the source revision. New punches, corrections or a relevant change in an open day's inputs invalidate an earlier certification where applicable.

## Attendance period and CSV export

**HR-040 — Period setup/review.** HR selects an authorized site and inclusive date range, creates a draft period and sees employee/day counts, ready records, unresolved exceptions and totals. Include people employed during the range, even if now inactive or unlinked. Generate missing scheduled days so a period with no attendance does not misleadingly appear complete. Block overlapping period definitions for the same site; revising a period uses the same identity and a new version. Reject invalid or oversized ranges with a useful error.

**HR-041 — Close.** Only HR with the close permission can close a completed period. Reject a period with a future date, an unfinished last overnight shift, unresolved day/request, stale revision or unsupported size. The close mutation rechecks readiness and employee scope from authoritative data, then freezes the period version, day rows, relevant employee/site/schedule identity, timezone, totals, closer and close timestamp. A preflight query is not sufficient authority. Normal punches/corrections/configuration must never change a closed version's output.

**HR-042 — Revision.** HR may start a new draft revision of a closed period only with a reason. Preserve all earlier closed versions, their day rows and downloadable exports. Allow corrections within the new draft without changing prior versions; recheck readiness and close as the next version. Display version and status, and provide prior-version selection. Repeated close/revise commands are idempotent. No silent unlock-and-overwrite behavior.

**HR-043 — Export.** Only authorized HR can export a closed version. Draft export is disabled in the UI and rejected by the server. CSV content derives entirely from that version's frozen rows and is repeatable for the same version. Include UTF-8 Thai support, correct CSV quoting/newlines and spreadsheet-formula injection protection for user-supplied string fields. The downloadable file name includes site, range and version. Export must not leak another employee/site/organization through a forged period/version ID. Record the export action in audit.

CSV v1 columns, in stable order:

`period_id, period_version, site_code, employee_code, employee_name, business_date, timezone, planned_start, planned_end, actual_start, actual_end, worked_minutes, outside_shift_minutes, disposition, correction_reason`

Datetime fields are ISO 8601 instants; missing events are blank. Durations are integer minutes, not currency or inferred overtime entitlement. Export all relevant employed days, including nonworking/absence/externally recorded leave days with explicit dispositions. The actual fields contain effective certified times; original event history remains available in the application. Totals in the period UI must match exported row values.

**HR-044 — Reverification.** Reuse current verified-session policy where implemented. Do not trust a client-submitted `reverifiedAt`, introduce a PIN or claim that Clerk step-up is already wired. If there is no working end-to-end reverification capability, use the existing authenticated HR authorization for the pilot and document the limitation explicitly for production adoption. Do not create an unusable close button with an unsupported reauthentication requirement.

## Cross-cutting requirements

**HR-050 — Audit.** Persist actor, action, target, server timestamp, request ID, outcome and relevant changes/reasons for attendance, correction decisions, employee/schedule/holiday changes, period close/revision and export. Use existing tenant/audit conventions. Display relevant history in record details, not a new audit dashboard. Do not store authentication secrets. Authorization denials and rejected commands follow the existing safe audit/outcome convention; thrown errors must not accidentally roll back the only audit write.

**HR-051 — Storage and compatibility.** Use additive tables/fields/indexes with organization discrimination. Update schema classification/uniqueness policies and generated function types through the repository's supported workflow. Preserve every currently deployed field and existing planner behavior. Use indexed bounded reads and explicit incomplete/limit errors; do not silently truncate period calculations. Keep domain time/period rules separate enough to test without a browser.

**HR-052 — UI.** Follow `docs/plans/design-system.md`, existing primitives, neutral surfaces, blue main actions and semantic status text. Use the three revised concept boards in `output/hr-design-v2/mockups/01.png`, `19.png`, `21.png` for hierarchy, not as literal screenshots to embed. Support Thai/English, light/dark, keyboard navigation, labelled forms, visible validation, 48px primary/touch controls and narrow screens. One h1 per page; few nested cards. Tables may scroll within their container, never the whole page. Date/weekdays must match. No implementation jargon in employee flows.

**HR-053 — Working configuration and errors.** Provide empty/loading/denied/error states and setup guidance. HR must be able to configure and complete the workflow through the UI; backend-only functions are insufficient. Employee and HR views must not display successful fixture data when persistence/auth is unavailable. No new authentication service or large unrelated dependencies.

**HR-054 — Local demonstration.** Add an optional idempotent HR fixture for the guarded local development deployment, with linked/unlinked employees, a supervisor, an ordinary day, a missing event, a holiday, an overnight shift and a closed version/revision case where practical. Keep seed logic internal/guarded and never run it against production. Document commands and routes. Never put demo mutation endpoints in the public unauthenticated app.

## Acceptance scenarios

| ID  | Given / when                                                      | Required result                                                             |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A1  | Linked active employee clocks in then out                         | Saved server times, one pair, accurate personal history and audit.          |
| A2  | Same command is retried or two commands race                      | No duplicate event; replay is stable; conflicting reuse is rejected.        |
| A3  | User forges another employee/site/org ID                          | Server rejects it; unrelated data/state remains inaccessible and unchanged. |
| A4  | User is unlinked, inactive, suspended or outside employment       | No self-service attendance; useful UI explanation.                          |
| A5  | Shift starts 22:00 and ends 06:00 next day                        | Both actual events belong to the start business date; correct minutes.      |
| A6  | Site holiday/nonworking weekday has no events                     | Explicit nonworking disposition, zero hours, not false absence.             |
| A7  | Scheduled past day has no clock or a missing end                  | Appears unresolved; prevents close until explicitly reviewed.               |
| A8  | Employee requests a missing end; assigned supervisor certifies    | Original event preserved, certified effective pair, reason/history visible. |
| A9  | Reviewer sends a request back, or tries stale/self/foreign review | Return reason retained; invalid decision rejected without altering hours.   |
| A10 | Authorized HR creates/closes a completed past period              | Frozen rows/totals, locked version, auditable closer and CSV download.      |
| A11 | Period is pending/future/overlapping/stale/oversized              | Server rejects close/create as appropriate; no partial successful export.   |
| A12 | HR starts revision with reason and closes changed data            | Old export unchanged and still selectable; new version is distinct.         |
| A13 | Name contains Thai, comma, newline, quote or formula prefix       | Valid UTF-8 quoted CSV, formula-safe user text, matching totals.            |
| A14 | Network save fails or response is lost                            | No false success; draft retained; safe same-ID retry.                       |
| A15 | HR-only employee uses shell; planner manager opens storage        | HR is reachable without storage authority; planner access is unchanged.     |
| A16 | UI at 390px and desktop in Thai/English, light/dark               | Usable forms/navigation, readable status, no page-wide overflow.            |

Use meaningful unit tests for timezone/overnight/duration/CSV rules, Convex integration/isolation tests for permissions and complete workflows, and component tests for uncertain write outcomes and actionable error/decision states. Run the relevant new tests, `pnpm check`, `pnpm build` and formatting on changed files. Production dependency audit is required if dependencies change. Record any actual environment limitations honestly; do not replace a failed check with an unsupported completion claim.

## Deferred roadmap

| Phase                                        | Scope                                                                                             | Trigger                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2                                            | Leave requests/basic balances, approved OT hours, shift-change requests, integrated notifications | Pilot succeeds and measured leave/OT work warrants it; move only the necessary request into Phase 1 if payroll cannot function without it. |
| 3                                            | Imported payslips and certificate requests                                                        | Current provider lacks an employee portal and HR has a clear document need.                                                                |
| Later by evidence                            | GPS/QR/kiosk/offline, WFH, announcements, broader reports                                         | Site/device/connectivity policy or measured operational need.                                                                              |
| Excluded from this module's initial delivery | Payroll calculation, tax, advances/reimbursements, deductions, Kanban, custom PIN/account system  | Separate product decision.                                                                                                                 |

## Implementation handoff

Kiro implements this specification using `claude-opus-5.5`, effort high. Read `AGENTS.md` and the relevant installed Next.js guides before writing Next code. Preserve the existing dirty generated server files and untracked import/prototype work. Keep edits scoped to HR and the minimum integration points. Do not reset/stash/discard other work, deploy/push, create a PR, commit, alter secrets, or write to a cloud/production backend. Local code generation and guarded local fixtures are permitted.

Deliver the actual implementation, a requirement-to-file/test checklist and verification results in `docs/reviews/hr-phase-1-implementation.md`. Record technical limitations or deferred acceptance explicitly. The root agent reviews the resulting diff and runs independent checks before reporting completion.

Independent review findings are recorded in `output/hr-implementation/root-review-notes.md`; read and resolve applicable open findings before the final handoff. Regression tests capture the required behavior. Root browser evidence is recorded in `output/hr-implementation/browser-checks.json`.
