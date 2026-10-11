# HR feature gaps and image generation design plan

Plan dated 11 October 2026. Employee self-service remains the first priority. Preserve the supplied references' approachable layout, rounded grouping, labelled shortcuts, clear section headers and simple list/detail journeys. Use the existing application's colors, typography, controls and navigation shell. Four shared-component studies and ten page boards have now been generated. A standalone interactive HTML preview follows their composition using exact system tokens. The [complete design handoff](plan.md) records scope, interactions and production delivery steps; application implementation remains future work.

The ten originals are in the [reference index](../../references/hr/README.md). The [delivery plan](../../plans/hr-employee-self-service-improvement-2026-10-11.md) contains detailed workflow and acceptance requirements. This brief defines the gaps and visual work to do first.

## Features already available

Keep online authenticated clock-in/out, server timestamps, Today, personal attendance history, date details, attendance correction submission/resubmission, supervisor certification/return, employee setup, weekly schedules, read-only employee profiles, HR holiday setup, attendance period closing/revisions and CSV export. These need integration into the expanded employee experience rather than replacement.

Existing authorization, business-date and overnight rules, original punch preservation, uncertain-write retry and immutable closed-period history remain part of every design.

## Missing features and functionality

Partial means some underlying capability exists, while the employee experience shown in the references is incomplete. Missing means the delivered HR UI/API/schema does not provide the workflow. Reference IDs identify the visible evidence; screenshot examples do not define our company policies.

| ID  | Feature                                   | Current status                                       | Functionality to add                                                                                                                                                                       | Priority and references                         |
| --- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| G01 | Employee home shortcuts                   | Partial: Today and clocking work.                    | Labelled shortcuts to employee tasks, next holiday, useful counts and clear access to the request hub. Consider a live clock/work-progress display only with truthful elapsed-time labels. | First design; HRZ-01.                           |
| G02 | Shortcut customization                    | Missing.                                             | Show/hide, reorder, Save/Cancel, persistent user/organization preferences and keyboard support through the same drag handle; no arrow buttons. Required clock actions remain available.                                             | Design after home; HRZ-02.                      |
| G03 | Employee annual holidays                  | Partial: HR can maintain site holidays.              | Employee-authorized year view, month groups, date/weekday labels, upcoming holiday and complete scoped download.                                                                           | First delivery; HRZ-05.                         |
| G04 | Personal attendance summary               | Partial: date-range history and daily figures work.  | Month/year and applicable period selection, reconciled attendance totals, links to matching day lists and visible frozen version for closed periods.                                       | Early delivery; HRZ-04.                         |
| G05 | Late and early-departure metrics          | Missing as policy judgments.                         | Defined thresholds/grace rules, consistent calculation and access to the relevant dates. Missing punches stay unresolved rather than automatically becoming absence.                       | After policy confirmation; HRZ-04.              |
| G06 | Unified My requests                       | Partial: corrections and recent status links work.   | Dedicated paginated history, type/status/date filters, request creation entry point, detail/timeline and returned-request recovery. Reuse existing correction statuses.                    | Early delivery; HRZ-01 and HRZ-03.              |
| G07 | Employee leave requests                   | Missing: a reviewed day can already be marked LEAVE. | Leave type/date/unit selection, charge preview, evidence when required, submission, scoped decisions, returned/rejected outcomes and policy-defined cancellation.                          | Core expansion; HRZ-01, HRZ-03 and HRZ-04.      |
| G08 | Leave quotas and balance accounting       | Missing.                                             | Entitlements, approved usage, pending reservations, available balance, allocation/accrual/carryover rules and an auditable ledger integrated with attendance.                              | Deliver with leave requests; HRZ-01 and HRZ-04. |
| G09 | Employee announcements                    | Missing.                                             | Authorized published feed, full detail, audience rules, per-employee/version read state, unread counts and a publishing companion flow. Pinning/acknowledgment need explicit rules.        | Later phase; HRZ-06.                            |
| G10 | HR notification inbox                     | Missing.                                             | Request decision/publication notices, authorized destinations, pagination, read/unread state and reconciled badge counts.                                                                  | After real events exist; HRZ-01 and HRZ-06.     |
| G11 | Employee payslips                         | Missing: attendance CSV export already works.        | HR import/validation/publication, employee year/period list, statement metadata, source earnings/deductions/net values, original/versioned document and protected download.                | Later phase; HRZ-07, HRZ-08 and HRZ-10.         |
| G12 | Sensitive payslip reveal and verification | Missing as a complete workflow.                      | Initially masked detail, accessible reveal/hide, supported account verification if required, server-enforced expiry/access and protected download. No custom PIN/account system.           | Deliver with payslips; HRZ-08 and HRZ-09.       |

## Other reference gaps for later scope

| Feature                          | Missing workflow or decision                                                                                                                                                                                                          | Evidence           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Approved OT                      | Request, reviewer decision, approved hours and attendance/export integration. Existing outside-shift minutes are informational.                                                                                                       | HRZ-01 and HRZ-03. |
| Off-site work                    | Date/location or work-arrangement request, approval and attendance treatment. WFH is only a holiday-list label in the supplied images, so its rules remain open.                                                                      | HRZ-03 and HRZ-05. |
| Shift swap and shift change      | Employee requests, other employee consent where applicable, reviewer decision, effective-date changes and historical schedule preservation. HR can already edit weekly schedules.                                                     | HRZ-01 and HRZ-03. |
| Holiday change                   | Request and approval for moving an employee's day off, with schedule/leave conflicts defined.                                                                                                                                         | HRZ-03.            |
| Alternative attendance methods   | HR QR/scan, GPS/site verification and Beacon/device workflows with policy and capability checks. Existing inventory scanning does not provide HR attendance verification.                                                             | HRZ-01.            |
| Expense reimbursement            | Expense details/evidence, review and finance handoff.                                                                                                                                                                                 | HRZ-01 and HRZ-03. |
| Salary advance and installments  | Eligibility, request/review, repayment schedule and finance ownership. The salary advance option is greyed in the reference.                                                                                                          | HRZ-01 and HRZ-03. |
| Salary certificate               | Request, authorized issuance, document history and download.                                                                                                                                                                          | HRZ-03.            |
| HR My tasks and expanded profile | A My tasks shortcut and personal/contact tabs are visible, but detailed behavior is not supplied. Define the HR task job and additional profile fields before designing them. Existing employment/schedule profile remains available. | HRZ-01 and HRZ-07. |

Payroll calculation, tax and deduction engines remain separate product scope. The payslip phase displays imported statements. The reference's PIN keypad is evidence of an interaction, not a requirement to create new credentials.

## Look and feel to preserve

- Use a calm mobile layout with rounded task surfaces, clear headers, labelled icons and generous touch spacing.
- Keep the reference's home-to-list-to-detail progression, month-grouped holidays, compact request chooser, simple toggles and clearly placed Save/Cancel or Download actions.
- Keep the familiar payslip sequence: period list, masked statement, required verification, revealed detail and download. Use the authentication provider's supported interaction when verification is required.
- Adapt these patterns within our current desktop sidebar and top bar. Mobile uses our existing responsive shell. Retain our application identity, fonts, icons, button shapes and status language.
- Use a small fixed shortcut set first; the customization design shows the future supported set rather than eleven unfinished modules.

## Color and component authority

The live [theme source](../../../src/app/globals.css) and shared [Panel](../../../src/components/ui/Panel.tsx) and [StatusBadge](../../../src/components/ui/StatusBadge.tsx) components govern color and implementation. The older [design sheet](../../design-sheet/DESIGN.md) identifies itself as a palette snapshot/proposal and must not override current source values.

| Role                       | Current light theme                                | Current dark theme                                    |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Primary action             | `#1d4ed8`, white text                              | `oklch(0.46 0.22 266)`, light text                    |
| Canvas and surfaces        | White                                              | Black canvas, `oklch(0.145 0 0)` surfaces             |
| Raised/quiet surface       | `#f6f7f9`                                          | `oklch(0.23 0 0)`                                     |
| Main text                  | `#17212f`                                          | `oklch(0.946 0 0)`                                    |
| Secondary text             | `#475569`                                          | `oklch(0.72 0 0)`                                     |
| Selected surface and links | `#eff6ff` with system blue                         | Existing neutral selected surface and `#a9baff` links |
| Status                     | Shared success, warning, danger and pending tokens | Their existing dark-theme counterparts                |

Use Geist/Noto Sans Thai and Geist Mono where the existing components do. Keep neutral shortcut surfaces with system-colored icons; use semantic status colors for status. Replace the reference's cyan actions and arbitrary pastel category palette with these system roles. Preserve the app's theme switch.

## Image generation sequence

1. **Prepare references and exact content.** Use the saved hrzoft images for composition and interaction. Use a fresh current-app capture plus the source token values for our shell, color, typography and controls. The [10 October HR capture](../../manuals/hr-user-guide-th/assets/source/01-today.png) is available as a starting reference; capture the live shell before generating if it has changed. Use synthetic employees and pay data. Keep Thai labels in a text manifest for later implementation.
2. **Generate the foundation pair.** Create an employee home mockup for phone and a matching desktop composition. Include Today, one next clock action, recorded times, a small shortcut set and next holiday. Use HRZ-01 for task hierarchy and our app capture for the design system. The first pair establishes a reusable composition for the remaining screens.
3. **Generate the core journey.** In order: annual holidays; attendance summary and filtered history; My requests list/detail; leave balance and leave request preview/form. Include phone and matching desktop layouts. Add shortcut customization after the fixed home layout is settled.
4. **Generate later journeys.** After the core visual direction settles: announcement feed/detail; notification inbox; payslip list, masked/revealed detail and supported verification state. Also design the required HR leave review, policy setup, announcement publishing and payslip import/publication companions before implementing those workflows.
5. **Review in one batch.** Compare phone/desktop compositions, full labels, action hierarchy and colors with the references and live app. Resolve findings in one targeted revision, then confirm the selected designs. Images guide composition; the copy manifest and source tokens settle exact text/color where generated pixels drift.
6. **Implement after design selection.** Build real components and authenticated workflows from the selected compositions. Preserve current attendance protections and follow the delivery phases. Generated screenshots are design artifacts, not UI assets or proof that functionality works.

Use the built-in image generation tool, with one distinct mockup per call. Label each input as a composition reference or system-style reference, inspect local inputs before passing them, and retain the original reference files. Save selected generated outputs and final prompts under `docs/designs/hr-employee-self-service-2026-10-11/`. Image generation and the local HTML design preview are now available. No new production application features have been implemented.

## First mockup prompt brief

Use case: `ui-mockup`. Produce a high-fidelity employee home for mobile web, approximately 390 by 844 in composition, with no device frame. The supplied hrzoft home is a composition reference; the current Storage Planner capture is the authority for shell, typography, control style and colors.

Preserve the approachable rounded grouping, readable labels and simple action hierarchy. Show a synthetic employee, date, attendance state, recorded in/out times, one primary clock action and a visible saved-state example. Below, show four labelled shortcuts for attendance history, My requests, leave and holidays, plus the next holiday. The final shortcut labels are "ประวัติ", "คำขอของฉัน", "การลา" and "วันหยุด"; the clock-in action is "ลงเวลาเข้างาน". Mockup labels do not authorize exposing an unfinished route in the live app.

Use white surfaces, pale neutral grey, dark slate text and our `#1d4ed8` primary action. Keep our application identity and existing responsive navigation. Do not reproduce hrzoft branding, cyan actions, unrelated pastel categories, actual employee names/pay figures, unsupported scan/Beacon actions or extra confirmation steps for ordinary clocking. The desktop companion uses the same content hierarchy inside the current sidebar/top-bar shell.

## Design acceptance

The selected images must visibly retain the reference interaction structure while belonging to our existing application. The primary employee action is clear, future features have a defined real workflow, and phone/desktop layouts use matching controls and colors. Exact Thai/English copy remains in editable text; generated glyph quality does not determine implementation copy.

Implementation acceptance additionally covers at least 48-pixel primary touch targets, keyboard focus, complete labels, loading/empty/denied/error states, request draft preservation and authorized data. The image review cannot replace those checks.
