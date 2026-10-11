# UI consistency and HR delivery evidence

This is the historical 11 October delivery record. The [12 October final plan](../plans/ui-hr-final-execution-2026-10-12.md) and [final delivery evidence](ui-hr-final-2026-10-12/delivery.md) supersede the remaining-work and release status below. New leave, announcements, private payslips and frozen attendance workflows are implemented and verified there.

11 October 2026. This records application implementation following the user's drawer screenshot, HR preview and design-sheet adoption plan. The [consolidated implementation plan](../plans/ui-consistency-and-hr-implementation-2026-10-11.md) covers all tasks and dependencies. [HR follow-through](../plans/hr-production-follow-through-2026-10-11.md) specifies remaining domain work and policy questions.

## Delivered application changes

- Warehouse selection uses the existing SelectControl with an optional decorative leading icon inside its single border. The accessible Warehouse label remains associated with the trigger; no surrounding field border is added.
- Search and AI Search share one trigger anatomy, surface, border, internal icon and close focus edge. Standard Search retains the platform shortcut. AI availability, collapsed tooltips and mobile drawer/dialog focus handoff survive.
- Shared StatusBadge uses the chosen stronger badge inks. Dedicated badge surface aliases preserve the app fills when a floor-map ancestor overrides its own semantic colors. Map area colors and other semantic consumers remain unchanged.
- Input and SelectTrigger retain invalid borders and inline errors without a translucent invalid glow; pointer-aware density and the close focus utility remain.
- Catalogue table headers/quantity cells and card/mobile values are right aligned with tabular numerals. Units, lot and format/status context remain; arithmetic, grants, pagination and query references are unchanged.
- Employee Today keeps actual punches, the server next action, receipt and uncertain-command contracts. Shared Action Cards provide delivered destinations; the next holiday uses employee/site-scoped real data and handles the next year without inventing an empty result while loading.
- `/hr/holidays` provides month-grouped annual employee holidays and complete scoped CSV. Thai Buddhist year input converts to canonical Gregorian query years. The server resolves the employee/site; the caller cannot supply another employee/site. CSV text escaping and completeness are tested.
- `/hr/requests` provides complete cursor-paged personal correction history and a server-wide status filter. Exact request detail includes the retained timeline; date/time use the same organization timezone. Original/effective/proposed day information and returned-request recovery remain available on the linked day workflow.
- Attendance history adds complete current-month selection and reconciled live bounded summaries with exact matching-row filters. Missing punches stay unresolved; no late/early thresholds, absence judgments or approved OT rules are invented.
- `/hr/customize` saves shortcut visibility/order by authenticated account and organization against a five-destination allowlist. Clock actions remain outside preferences. Save is idempotent and version checked. Handle-based keyboard/pointer reorder, cancel, focus restoration and real persistence are part of the scoped validation.

## Scope that remains planned

Employee attendance-period selection with explicitly named frozen revisions remains follow-through work; live monthly summaries are not represented as frozen payroll statements. Request search/date/type filtering beyond the delivered correction/status workflow is also planned. Company-policy-dependent leave, announcements/notifications and imported payslips are not implemented by copying preview data or handlers. Leave charging/review/cancellation, publication audiences/version semantics and payslip source/verification rules require the decisions listed in the plans.

The preview's records, example leave allocation, pay arithmetic, simulated verification, role selector and local success handlers remain documentation only. No custom PIN or payroll engine is introduced.

## Team and independent review

Main agent integrated foundations/catalogue, plan, schema/public-contract registrations and final verification. The shell lead delegated an independent control and scan/floor audit. The HR lead delegated employee reads, then that backend agent implemented account/org shortcut preferences while the shell lead implemented its frontend.

Shell/control plus scan/floor audit: 102 tests across 10 files passed. Source inspection found no demonstrated scan/floor gap requiring a workflow rewrite. Floor sheet/split thresholds remain 851/1100/1400px workspace measurements. Existing workspace-view tests additionally passed. Finished-goods integration tests covering registration and command replay passed; physical lost-network/camera/device testing is separate from those automated contracts.

Employee-read integration tests and screen tests cover authorization, calendar completeness beyond the admin listing cap, older correction history, global status pagination, exact owned request detail, Thai year conversion, year-boundary loading, timezone-correct timelines, month summaries and CSV escaping. Existing attendance pending/retry guards pass. Shortcut backend validation additionally covers per-user/org isolation, invalid lists, duplicate keys, optimistic conflicts, replay/idempotency and schema classification. Public API representative coverage and validators include the new module and queries.

## Validation record

- Initial shared foundation/catalogue checks: 41 tests passed. Existing catalogue product/quantity suite: 77 tests passed after preserving its complete quantity label.
- HR lead's scoped pass: 74 tests passed. Preferences/backend/schema/public API combined passes: 282 tests passed. These overlap other runs and are not summed into a unique suite total.
- Full suite: **250 files, 2,971 tests passed** using four workers after the integration fixes. Final independent customization validation additionally passed **27 tests** in two new files, including keyboard focus, pointer capture/cancellation, actual main-container autoscroll, saved order/visibility, stale versions, pending navigation guards and exact uncertain retry.
- Production build passed: compiled, typechecked and generated all 51 pages, including `/[locale]/hr/customize`, holidays and exact correction-request detail.
- Compiled production CSS contains dedicated badge text/background classes, a fine-pointer density media condition, the 2px close field outline and a final explicit `-1px` search focus offset. Input/select source class composition contains no invalid ring class; shared button styles still own their separate existing invalid presentation.
- Full lint and TypeScript with customization pass. Changed-file formatting passes for application/backend/tests, locale catalogs and new delivery documents.
- `pnpm check` stops at repository-wide formatting: existing HR preview/reference/review files are unformatted. They were present before this request and were preserved; new application files and delivery documents passed changed-file formatting checks. This is not a fully green repository check.
- `git diff --check` passes. The manual design detector returned no findings; the HR lead's separate scoped detector also returned no findings.

## Browser and release limitations

The T3 collaborative preview temporarily supported real navigation/DOM evaluation. At 390px, the running application had no page-wide overflow; warehouse/search/AI triggers had 48px heights, a 1px field border, internal icons and no border on their immediate wrappers. These DOM checks were taken during drawer opening, so they are not a final screenshot/layout approval.

Screenshot snapshots failed repeatedly. The preview host then disconnected and reported no automation host for click/evaluate. No fresh screenshot, browser axe, full theme/locale/zoom/coarse-pointer matrix, screen-reader, physical camera/touch or large-floor device/performance verification is claimed. HR routes initially reported an unavailable new read before the local backend synchronized; the updated queries were subsequently generated and synced only to the verified local Convex deployment. Full real-browser HR journeys remain a release gate.

No production merge, production release or remote git push was performed. Development functions/schema were synced to the verified local backend for application verification. Existing unrelated working-tree changes remain intact.
