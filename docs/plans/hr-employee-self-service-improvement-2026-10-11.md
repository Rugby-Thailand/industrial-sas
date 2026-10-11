# HR employee self service improvement plan

Draft dated 11 October 2026, updated with the second image batch and the user's design direction. Priority confirmed by the user: employee self-service for attendance, requests, leave and holidays. Ten hrzoft screenshots are saved in the [reference collection](../references/hr/README.md); more images may follow. Plan first, then start design with image generation. Preserve the references' look and feel while using the existing application's colors and shell. The [feature gap and design brief](../designs/hr-employee-self-service-2026-10-11/brief.md) lists missing functionality, exact color authority and the mockup sequence. This draft proposes future work and does not authorize application implementation or replace the existing HR requirements.

Improve the daily employee journey around our working attendance module: record attendance, understand the day's schedule, inspect attendance history, track requests, check company holidays and request leave. Start with clearer access to existing information, then add leave policies, requests and balances as a complete workflow.

User direction added during implementation: HR configuration must start with an editable [Thailand legal-minimum preset and suggested company settings](thailand-hr-policy-defaults-2026-10-11.md). Keep the policy-dependent workflow gate until HR activates a validated effective policy. The [implementation follow-through](hr-production-follow-through-2026-10-11.md) supersedes open-ended default-policy questions; preview quotas do not establish entitlements.

## Existing capabilities and gaps

The current [Phase 1 requirements](../specs/hr-phase-1-requirements.md) and source provide the baseline. The [10 October delivery audit](../reviews/hr-delivery-final-audit-2026-10-10.md) records prior local verification; it is not a new verification result for this planning pass.

| Area                     | Current module                                                                                                                                                           | Proposed improvement                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Today                    | `/hr/today` shows attendance state, actual in/out times, the next clock action, schedule/site, saved feedback and recent corrections.                                    | Make Today the employee home with a few useful shortcuts, the next holiday and a compact summary. Preserve the prominent clock action. |
| History                  | `/hr/time` shows original/effective times, worked minutes, day status and correction links in a bounded date range. Individual dates open details and a correction form. | Add month and period selection, useful totals, and links from summary counts to matching days.                                         |
| Requests                 | Attendance corrections support pending, certified and returned states, reasons and retained history. Today shows up to five recent corrections over fourteen dates.      | Provide a dedicated employee request list with filters and complete paginated history. Begin with corrections, then add leave.         |
| Holidays                 | HR administrators configure site holidays in Settings. The holiday list query requires admin permission and returns a bounded list.                                      | Add a read-only annual view for the linked employee's site with month groups and download. Add a separate employee query.              |
| Leave                    | HR can certify a day with the `LEAVE` disposition. This does not provide leave types, entitlements, requests or a balance ledger.                                        | Add configurable leave policies, balances, employee requests and scoped supervisor decisions.                                          |
| Announcements            | No employee announcement feed is part of the delivered HR workflows.                                                                                                     | Add an authorized feed with full announcement reading and per-employee read state.                                                     |
| Payslips                 | Closed attendance periods export certified CSV for the existing payroll process. Employee payslip storage, viewing and download are not delivered.                       | Import published statements from the payroll source and let employees view/download their own payslips.                                |
| Other reference features | Shift swaps, approved OT, alternative clock methods and financial services are outside the current delivered workflows.                                                  | Keep them in the backlog until their rules and business priority are confirmed.                                                        |

Source anchors: [Today](../../src/features/hr/TodayScreen.tsx), [History](../../src/features/hr/HistoryScreen.tsx), [Settings](../../src/features/hr/SettingsScreen.tsx), [self-service functions](../../convex/hr/self.ts), [holiday administration](../../convex/hr/setup.ts), [attendance evaluation](../../convex/model/hr/attendance.ts), [schema](../../convex/schema.ts), [navigation](../../src/lib/navigation.ts).

## Lessons from the screenshots

| Reference | Useful pattern                                                                          | Adaptation for our module                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HRZ-01    | Daily status and direct access to common employee tasks.                                | Keep one next attendance action. Add History, My requests, Holidays and, when delivered, Leave. Reuse our existing controls and Thai/English labels.                                   |
| HRZ-02    | Employees can choose and order home shortcuts.                                          | Start with a small fixed set. Consider saved personal preferences after the supported tasks are stable; include keyboard support through the drag handle alongside drag.               |
| HRZ-03    | One entry point for different request types.                                            | Offer only working request types. A correction starts with a date; leave starts with its type and dates. Keep each type's validation and decision rules distinct.                      |
| HRZ-04    | Month or payroll-period summaries with leave usage.                                     | Separate calendar days, scheduled workdays, completed attendance, unresolved days and certified absence/leave. Show the selected scope and let employees inspect the underlying dates. |
| HRZ-05    | Annual holidays are easy to scan by month.                                              | Show employee site and selected year, with the next holiday highlighted. Export the same complete authorized list. Clarify the WFH label before modeling it as a holiday.              |
| HRZ-06    | Announcements show a title, preview, author, timestamp and status dot.                  | Add a readable feed and detail view. Define unread state and pinning explicitly; do not copy the reference company's policy content.                                                   |
| HRZ-07    | Payslips are grouped by year and listed by period with payment dates.                   | Show only the linked employee's published statements, newest first, with clear period and payment metadata.                                                                            |
| HRZ-08    | Pay values are masked while period metadata remains visible.                            | Separate the statement list/metadata response from sensitive values. Add accessible reveal and hide controls with a defined session policy.                                            |
| HRZ-09    | A PIN keypad and password alternative precede a revealed payslip in the image sequence. | Confirm the actual verification requirement and use supported account authentication. The screenshot does not establish server enforcement; do not introduce a custom PIN system.      |
| HRZ-10    | Revealed statements show line items, explanations, totals and download.                 | Display payroll-source values and explanations as published. Preserve the original statement and version; do not calculate payroll from attendance minutes.                            |

Preserve the references' approachable rounded grouping, labelled shortcuts, section headers and simple list/detail journeys, adapted to the current app identity and shared components. Use the current system palette from `src/app/globals.css`, including its light/dark semantic colors, rather than the reference's cyan and pastel category colors. Keep the existing shell, fonts, controls and status language. A live clock/progress display is optional and must describe elapsed time truthfully. Employee task completion is the design priority.

## Employee experience

Today remains `/hr/today`. On a phone, put date and attendance state first, followed by recorded times, the next clock action and its feedback. Place schedule/site, shortcuts and the next holiday below. Use the available width on desktop without making secondary information compete with clocking.

Attendance remains `/hr/time`, with month and period shortcuts around the existing date-range flow. Summaries precede the day list. Tapping an unresolved count filters the relevant dates; opening a date retains access to originals, effective times and correction history.

Proposed new destinations are `/hr/requests`, `/hr/holidays` and `/hr/leave`, followed by `/hr/announcements` and `/hr/payslips` when their phases are delivered. These paths are provisional. Register delivered destinations in the existing navigation and search registry; retain current direct links, focus behavior and draft protections. HR administration stays available through its existing authorized routes.

My requests shows type, affected date or range, status and last update. A detail view shows the submitted information, decision, reason and history. Returned corrections retain their existing resubmission behavior. Do not invent correction cancellation or map `CERTIFIED` to a new backend status for visual consistency.

Leave shows entitlement, approved usage, pending reservation and available balance by type. A request previews the chargeable amount and applicable nonworking dates before submission. The exact counting and reservation rules require company policy decisions.

Announcements shows concise previews with author and publication date. Opening an item reveals the complete content; ordinary read state must be distinguished from any explicit policy acknowledgment. A home shortcut can display a real unread count.

Payslips shows a year selector and published periods, then the selected statement's period, payment date/type and publication or source calculation timestamp. The detail view masks amounts initially, provides a reveal/hide control and offers an authorized download. Label a timestamp as last calculation only when the payroll source supplies that fact. Preserve the selected period through any required verification and return focus to the initiating control.

## Delivery phases

### Phase 0 Image generation design

Follow the [design brief](../designs/hr-employee-self-service-2026-10-11/brief.md). Begin with an employee home mockup for phone and its desktop companion inside our current shell. Then design holidays, attendance summary/history, My requests, leave balances/request forms and shortcut customization. Announcements, notifications and payslips follow the core journey. Include the minimum reviewer/admin companion screens for each new workflow. Review the compositions and one targeted revision before selecting the direction for implementation.

Acceptance: reference layout/interaction patterns are preserved, all mockups use our current colors and components, and the selected screens cover actual employee tasks. Use synthetic content. Keep generated images/prompts in the design folder. The follow-up design package now contains four shared-component studies, ten page boards and a standalone HTML preview; production application code remains unchanged. See the [complete design handoff](../designs/hr-employee-self-service-2026-10-11/plan.md) for the preview, review evidence and current design status.

### Phase A Employee access and holidays

1. Add a small set of shortcuts to Today for existing employee tasks and the new holiday view. Do not show links to unfinished features.
2. Add an employee holiday query that resolves the linked employee and assigned site on the server, accepts the selected year and preserves organization/site boundaries. Keep holiday editing restricted to HR.
3. Build annual holidays grouped by month, with year selection, weekday/date labels, an empty state, the next upcoming holiday and download. Start with CSV; add calendar export if needed. Paginate or explicitly handle limits before claiming a complete year or exporting it.

Acceptance: a linked employee can view and download only their site's selected-year holidays without admin access. Changing the year changes the visible list and downloaded data together. Normal clocking remains usable in the first mobile view.

### Phase B Attendance summary and request tracking

1. Add a selected-month summary and an optional attendance-period selector. Period mode requires an employee-authorized query for applicable periods; employees must not gain access to HR period administration or other employees' totals.
2. Aggregate attendance on the server using the existing business-date, schedule and evaluation rules. Keep the existing 31-date history limit or implement a tested paginated alternative. Use the selected frozen version for a closed period and identify it visibly.
3. Add a dedicated paginated corrections list with status/date filters and links to existing day details. Add a Create request entry point for attendance correction. Explain empty and incomplete results accurately.

Acceptance: summary counts reconcile with their day lists. Future scheduled dates and unresolved missing punches are not counted as absence. Only certified `ABSENT` days count as absence. Out-of-shift minutes remain informational and are not labelled approved OT. Request history includes older and resubmitted corrections, with no false claim that Today's recent list is complete.

Late and early-departure counts are a later extension within this phase only after HR defines thresholds and grace rules. The current attendance evaluator does not make lateness judgments.

### Phase C Leave requests and balances

1. Confirm leave types, eligibility, units, annual allocation, accrual or proration, carryover, holidays/weekends, partial days, required evidence, negative balances, approval routing and cancellation rules. Screenshot quotas must not become default entitlements.
2. Add versioned policies, employee entitlements and an auditable balance ledger. Display grant, used, reserved and available amounts consistently, including the applicable leave year and unit.
3. Add leave submission, request history and supervisor/HR decisions. Reuse the existing review shell and permission conventions where appropriate while preserving attendance correction contracts. Provide returned/rejected outcomes and cancellation only according to the confirmed leave lifecycle.
4. Integrate approved leave with attendance and period readiness. Whole-day leave can use the existing leave disposition; partial-day leave needs an explicit model for work and leave on the same date. Prevent duplicate accounting from manual leave certification and a linked leave request.

Approval and balance reservation must be atomic and safe under concurrent requests and retries. Policy changes must not recalculate already approved historical charges. Cancellation releases or reverses reservations/usage with retained history. A change affecting a closed attendance period follows the existing reasoned revision process.

Acceptance: an employee can preview, submit and track leave; an authorized reviewer can decide it; balances and attendance update consistently. Overlap, insufficient balance, invalid dates, concurrent decisions, cross-employee access and closed-period changes have defined outcomes and meaningful regression coverage.

### Phase D Announcements and employee conveniences

1. Define who may publish and the audience scope: organization, site or another explicitly authorized group. Add draft/published/archived content with title, body, author, publication time and optional pinning. Scope any images or attachments to the same audience.
2. Add a paginated employee feed and complete detail view with Thai/English readability, empty/loading/error states and an unread filter. Store read state per employee and announcement version; decide whether a material edit makes the item unread again.
3. Add an unread home badge and, when supported, in-app notices for request decisions. Keep delivery state, reading and formal acknowledgment distinct. Formal policy acknowledgment requires an explicit action and retained version/time evidence if the company needs it.

Acceptance: employees see only published announcements in their audience. Reading an item updates its read state and unread count consistently across sessions; another employee's count is unaffected. Archived or inaccessible content has a clear recovery state. A pin symbol in a reference title must not become an assumed publishing rule.

After the main flows are stable, consider saved shortcut visibility/order from HRZ-02 and in-app request decision notices. Preferences must be scoped by user and organization, contain only authorized destinations and fall back safely when a feature is removed. Required attendance actions remain available.

### Phase E Imported payslips

The existing HR roadmap places imported payslips after the attendance/request pilot when the payroll provider lacks a suitable employee portal. Confirm that need and the source/export format before this phase. The new screenshots define useful viewing behavior without expanding this module into payroll calculation.

1. Define a statement import contract with organization and stable employee identity, source statement ID/version, period range, payment date/type, currency, earnings/deductions/net totals and the original document. Accept structured line items and calculation explanations only when the payroll source provides them. Confirm file format and publication/retention ownership.
2. Provide authorized HR import, validation preview and explicit publication. Handle unknown employee mappings, duplicate source IDs and corrections without silently replacing a published statement. Retain version history and define how superseded statements appear. Prefer storing the provider's published file rather than generating a competing statement.
3. Build the employee year/period list, initially masked detail view, reveal/hide controls and protected download. If only a document is available, provide the document view/download without fabricating structured pay breakdowns. Use precise decimal or minor-unit representations for imported amounts and flag inconsistent source totals during import.
4. Confirm whether viewing or downloading requires fresh account verification and how long it remains valid. If required, implement supported authentication-provider verification with a server-enforced validity check before returning sensitive values or files. Keep the current Clerk account system; do not add local salary PIN credentials or treat a client flag as verification.

Employee identity and organization authorization must be checked independently for metadata, amounts and downloads. Masked screens must not preload sensitive values or include them in page source, analytics, logs or search snippets. A visibility toggle provides display privacy; it does not grant access. Define whether hiding values ends the verified viewing session. Downloads need protected delivery or appropriately short-lived links, with access checked when issued.

Acceptance: employees can list, reveal and download only their own published statements, including on direct links. Unpublished, superseded, foreign-employee and foreign-organization IDs have defined access outcomes. Required verification expires and is enforced server-side; cancel/failure reveals no pay values. Download matches the selected source/version and every displayed amount matches the imported statement. Test using synthetic pay data.

Off-site work, shift changes/swaps, holiday changes, approved OT, GPS/QR/Beacon attendance, reimbursements, advances, installments and salary certificates remain separate backlog items. More screenshots and confirmed business rules should determine their order. Physical presence verification, offline capture and payroll calculations require separate scope decisions.

## Implementation boundaries

Extend the current `src/features/hr`, `convex/hr`, `convex/model/hr` and typed HR API references. Reuse Clerk identity, organization/site authorization, shared UI, server timestamps, audit records, idempotent commands and Thai/English localization. Read the applicable installed Next.js guides and `AGENTS.md` before implementation.

New employee reads must resolve the signed-in employee server-side. Hiding a menu is not authorization. Leave reviewers must retain site/reporting scope and the prohibition on self-review. Existing attendance originals, snapshot plans and closed-period versions remain immutable. New exports must state their scope and completeness.

Payroll statement periods and attendance periods are separate records. Do not infer published payslip amounts, approved OT rates, tax rules or deductions from the attendance CSV or HRZ-10's examples. The current HR specification explicitly excludes a custom PIN/account system and does not claim that account reverification is already implemented.

Store dates in the existing canonical business-date format and format them for display. Thai year selection may show Buddhist years while queries use canonical years. Preserve overnight shift behavior and existing supported timezones. Confirm the display convention before building the year selector.

Online authenticated clocking remains the delivered attendance method. Do not introduce scan/location/Beacon controls merely because HRZ-01 shows them. A live clock or work-progress display must not imply that an attendance event has been saved or that elapsed time is certified work.

## Verification for implementation

For each delivered phase, verify the full employee journey and the smallest necessary admin/reviewer companion flow with isolated local fixtures. Cover loading, empty, denied, unlinked, inactive, failed, pending and uncertain-write states; retain drafts on recoverable failures and retry the same uncertain command.

Inspect phone and desktop layouts together, including 390 by 844 and 1280 by 800 views, Thai/English and light/dark. Require readable full labels, no page-wide horizontal overflow, primary touch controls of at least 48 pixels, keyboard access, visible focus and correct direct-link behavior. Drag customization needs an accessible alternative.

Add focused tests for authorization, completeness, summary reconciliation, leave accounting, concurrency and historical preservation as those behaviors are introduced. Run formatting for changed files, appropriate component/integration regressions and the repository's `pnpm check` and production build. Update the Thai employee guide after the delivered UI settles.

For announcements, test audience boundaries, pagination, per-employee unread counts and version changes. For payslips, test import identity mapping, duplicate/version handling, unpublished access, verification expiry, masked-response payloads and authorized download. Pay details must remain absent from global search results and unintended caches. Avoid real employee pay records in demonstration fixtures.

## Open decisions and additional images

| Decision                                  | Why it matters                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Leave policies and approval routing       | Determines the ledger, charging preview, validation, evidence and review flow.                                            |
| Attendance definitions and period display | Determines which metrics are useful, how late/early thresholds work and how employees understand frozen periods.          |
| Holiday download format and WFH meaning   | Determines CSV/calendar export and whether a label is a holiday or a work arrangement.                                    |
| Next request type after leave             | Determines whether approved OT, off-site work or schedule changes warrant the next workflow.                              |
| Announcement publishers and audiences     | Determines publication permission, audience targeting, pinning, read state and whether formal acknowledgment is needed.   |
| Payslip source and employee portal need   | Determines whether imported statements are needed, the source format, employee mapping and publication ownership.         |
| Payslip verification and document access  | Determines supported fresh authentication, expiry, download access and the distinction between masking and authorization. |

Useful next references are request forms, request detail/status history, leave balance explanations, approval screens, attendance-day detail and holiday download results. Add each image to the [reference index](../references/hr/README.md), link the observation to its reference ID and revise the affected phase. Keep the plan in draft until the remaining references and policy decisions settle the scope.
