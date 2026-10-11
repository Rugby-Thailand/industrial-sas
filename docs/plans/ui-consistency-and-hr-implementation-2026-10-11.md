# UI consistency, design-sheet adoption and HR implementation

Date: 11 October 2026. Owner: main implementation agent. Status: consolidated plan complete; initial application slices implemented and verified; remaining work and release gates are explicit. This is the execution plan requested with the mobile-drawer screenshot. Working tree already contains unrelated runtime, search, documentation and HR design work; preserve it. A final delivery record will distinguish implemented capabilities, verified existing behavior, policy-dependent work and checks that could not run.

## Sources and precedence

1. The user's screenshot correction: warehouse icon inside one selectable field; remove the enclosing second border; Search and AI Search use the same field-style trigger with their icons inside.
2. [HR interactive reference](../designs/hr-employee-self-service-2026-10-11/preview/app.js), [design handoff](../designs/hr-employee-self-service-2026-10-11/plan.md) and [HR delivery requirements](hr-employee-self-service-improvement-2026-10-11.md).
3. [Design-sheet adoption](design-sheet-system-adoption-2026-10-11.md), including its domain contracts and ordered verification steps.
4. Application components and `src/app/globals.css` own production appearance. Preserve Clerk identity, Convex authorization, source dates, write receipts and request identifiers. Preview records, role/state selectors and local fake writes must never enter production.

The prior design-sheet plan limited its own delivery to documentation. This request authorizes its application implementation. Its prohibition on concurrently editing HR files is resolved by assigning one HR lead ownership of those files. A merge to main automatically releases production, so release authorization remains a separate gate. “Push until finished” is treated as persistence through implementation and fixes; this task does not require publishing all existing local changes.

## Completion rules and team structure

The main agent owns scope, shared foundations, the consolidated plan, integration, production build and the final evidence record. It keeps a file-ownership map, resolves cross-task interfaces and rejects a task handoff that contains failing checks or simulated production behavior.

| Lead/workstream  | Delegated sub-task                                       | Ownership                                                                                                                            | Completion evidence                                                               |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Shell UI lead    | Independent control/accessibility and workflow audit     | WorkspaceContextBar, SearchTriggers, SelectControl leading icon, shell icon map and associated tests                                 | Warehouse/search behavior, collapsed rail, drawer handoff and keyboard tests      |
| HR frontend lead | Backend employee reads                                   | HR screens/routes, shared Action Card, navigation/locale registration; backend sub-agent owns employee holiday/summary/request reads | Employee-scoped integration tests plus screen/state tests                         |
| Main agent       | Integrate workstreams and adopt design-sheet foundations | Global tokens, badge ink, input/select error edges, catalogue numeric layout, plan/evidence                                          | Shared contrast tests, storage regressions, lint/typecheck/build and compiled CSS |

Agents must inspect the relevant source, read installed Next guides before application code, implement their complete scoped task, run its relevant checks, fix their failures and report concrete files/results. Leads must assign independent work to sub-agents as slots permit and incorporate their findings. Shared files are edited by one owner at a time. A blocked policy is documented precisely; it does not end independent implementation. No seed, migration or backend deployment may target production for verification.

## Shared component contract

| Purpose              | Existing foundation                                  | Implementation rule                                                                                                                                                             |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warehouse choice     | SelectControl / SelectTrigger                        | Add optional decorative leading icon inside the trigger; one neutral field border; retain accessible Warehouse name, pending/empty/disabled state and selected name             |
| Search dialog entry  | SidebarMenuButton / SearchTriggers                   | One rendered trigger anatomy for Search and AI Search; icon + label inside one bordered field; shortcut belongs to standard Search; real SEARCH/AI provider modes stay distinct |
| Employee shortcuts   | Panel/button/link foundations                        | Add one reusable Action Card for delivered destinations; anchor for navigation, decorative icon, full localized label; keep clock action outside customization                  |
| Task groups          | PageContainer, PageHeader, SectionHeader, Panel      | One task surface with plain/divided sections; avoid nested cosmetic panels                                                                                                      |
| Field errors         | Input, FormField, ScanCodeInput, FormSelect          | Danger border and inline recovery text; preserve close 2px visible focus; remove translucent 3px invalid ring                                                                   |
| Status               | StatusBadge                                          | Shared dedicated badge inks for label/icon/edge, original fills; words and shape convey meaning                                                                                 |
| Data quantities      | FinishedGoodsTable and card/mobile consumers         | Right-aligned values and tabular numerals, retain unit/status/format information and server arithmetic                                                                          |
| Load/access outcomes | QueryGate, DataGate, Notice, EmptyState, OutcomeGate | Loading/unavailable never masquerades as zero or success; empty states include valid recovery; authorization stays server-owned                                                 |

Density remains 48px targets/16px inputs by default and 36px controls on at least 768px with a fine primary pointer. A wide touch tablet must not become dense solely because of width. Preserve light/dark and Thai/English source typography and token roles.

## Ordered implementation tasks

### T01 — Single-field warehouse and consistent search triggers

- Inspect current desktop header, mobile drawer and task-only warehouse context before editing. The screenshot represents a selectable context; read-only task context must remain read-only.
- Extend SelectControl with optional `leadingIcon: ReactNode`; hide the decoration from assistive technology, keep selected text flexing/truncating separately and retain the chevron.
- Move Warehouse icon into the selected field. Remove any outer bordered field wrapper and redundant visual label; retain a complete accessible name and no extra focus stop.
- Consolidate Search/AI Search markup/classes in SearchTriggers. Both expanded triggers use a neutral field surface and one border; Search gets platform-appropriate shortcut text; AI keeps its identifiable icon and label.
- Preserve AI feature availability, Ctrl/Meta K, icon-rail tooltips, mobile drawer closing before opening the search dialog, pending handoff cancellation on identity/context changes and focus return.
- Gate: context switching, empty/pending/disabled selector, long names, icon rail, both search modes, keyboard open/close and mobile dialog handoff pass existing regression suites.

### T02 — Shared status ink and invalid field edges

- Add dedicated badge success/warning/danger/pending tokens in the theme map and both palettes.
- Adopt light `#084d2c/#643900/#851c16/#3e258a` and dark `#8be3b7/#ffd08a/#ffbbb4/#d0c0ff` for StatusBadge text/icon/edge.
- Preserve semantic background fills and existing semantic colors used by notices/actions/maps. Badge surface aliases resolve in each app palette so FloorMap's scoped fills cannot weaken the badge contrast. Do not overwrite stored physical-area colors.
- Remove invalid ring classes from Input and SelectTrigger; retain `aria-invalid`, inline FormField errors and focus utilities.
- Inventory FloorMap's scoped UI tokens. Change only a demonstrated shared-consumer mismatch; physical zone identity and scene geometry remain stable.
- Gate: badge text contrast >=7:1 in both themes; meaningful field/focus edges >=3:1; invalid focus remains visible. Inspect compiled production CSS to confirm density and focused-invalid ordering.

### T03 — Catalogue numeric layout

- Align quantity column header/filter trigger and product/storage-unit quantities to the right; use tabular numerals.
- Apply the same number treatment to desktop card and phone list consumers; preserve labels, units, lot, format and status breakdowns.
- Keep product counts separate from unit counts. To store includes reserved units; In storage excludes moving units. Unknown/preparing/reset/unavailable totals remain unavailable rather than invented zeroes.
- Verify products/units, scan-packages entry, cards/table/phone views, filters/clear, search debounce, page-size reset, cursor Previous/Next, browser history and warehouse-isolated preferences.
- Gate: no arithmetic/query/grant changes; existing catalogue tests pass, including summary preparation/reset and actionable filter-empty recovery.

### T04 — Scan adoption verification

- Run existing TicketCard, JobScanScreen and ticketDraft tests and inspect source-backed domain actions.
- Confirm every ticket retains ordinal/source/Remove, unit type, per-field scans, optional values/filled count, duplicate acknowledgment, location Change and stock note.
- Confirm disabled Save reasons while reading/incomplete/invalid/unreviewed, recoverable failure draft retention, unchanged retry request-ID reuse and late callback rejection.
- Confirm view-only replaces the write flow, confirmed count/location/stock-note/Scan more/View records, draft navigation guards and safe-area padding.
- Fix only an evidenced presentation mismatch. Finished-goods unknown response must not be replaced by HR's pinned uncertain UI.
- Gate: regression evidence; any physical camera/OCR/touch or real lost-response check not executed is named in delivery evidence.

### T05 — Floor adoption verification

- Run workspace/label/layout view tests; inspect complete-data boundary, inventory unavailable handling and off-page selection.
- Preserve map/list/split and 2D/3D, filtering, labels, pointer cancel, geometry editing/resizing/activation and draft guards.
- Confirm sheet details below 851px workspace width, or below 1400px in split view; split starts at 1100px; inline details in wide layouts.
- Confirm focus return, reselect-to-clear and distinct selection/status/physical-zone colors.
- Gate: no unrequested scene replacement. UI-B-DEMO/UI-B-REFERENCE browser checks and large-scene performance remain explicit checks requiring a working local fixture environment.

### T06 — Employee home and annual holidays (HR phase A)

- Extend Today with shared Action Cards to delivered tasks and next holiday. Preserve recorded punches, server-owned next action, pending guard, confirmed receipt and pinned uncertain retry.
- Add `/hr/holidays` and corresponding route/navigation/message registration.
- Implement employee holiday read query that resolves org + signed-in linked employee + assigned site on the server. Never weaken HR setup permissions or accept a client-selected foreign employee/site.
- Validate selected canonical year; display Buddhist year for Thai and Gregorian for English. Query the complete year or expose explicit completeness; no truncated export.
- Group dates by month, show date/weekday/name, provide year navigation and complete scoped CSV with safe cell escaping. Home next holiday comes from the same authorized holiday data.
- States: loading, denied, not linked, inactive, unsupported timezone, no assigned site, unavailable and empty year. No sample next-holiday fallback.
- Gate: employee cross-org/site access tests; complete selected-year view/export agreement; identity switching clears the previous employee's data; unchanged attendance write tests pass.

### T07 — Attendance summary and correction request hub (HR phase B)

- Reuse the existing bounded history evaluator and source business dates. Add month/year selection and reconciled summaries over the exact complete date range.
- Count only existing defined attendance dispositions and actual minutes; exclude future dates. Missing punches remain unresolved. No invented late/early grace thresholds, absence decisions or approved OT.
- Link summary filters to exactly their matching day rows. Preserve original/effective time details and correction routes.
- Add `/hr/requests` using authorized, paginated correction history with existing PENDING/CERTIFIED/RETURNED states, date/status/search filters where supported, detail/timeline and returned-request resubmission.
- Dedicated employee attendance-period selection is a separate sub-task: authorized published/frozen revision metadata; closed summaries must name and use the frozen version rather than live data.
- Gate: month count reconciliation, overnight/nonworking/incomplete examples, older-request completeness, foreign employee denial, paging and unchanged correction/write guards. If frozen-period selection is absent, do not claim full phase B completion.

### T08 — Shortcut preferences (HR phase D independent slice)

- Define a fixed allowlist of delivered destinations; do not expose unavailable leave/payroll/announcement routes.
- Store order and visibility per authenticated user and organization. Validate duplicates/unknown destinations and remove inaccessible destinations on read.
- Implement show/hide, pointer/touch drag via a handle and keyboard reorder through the same handle: Enter/Space lift/drop; arrows/Home/End move; Escape cancel; announce position.
- Draft changes are distinct from persisted state. Save disabled while unchanged or pending; Cancel restores saved values; errors retain draft; reload restores saved preferences.
- Clock action remains always reachable outside the configurable grid. Organization/account switches do not reuse another scope's preferences.
- Gate: persistence and identity isolation, keyboard/pointer cancellation, Save/Cancel and unsaved navigation guard.

### T09 — Leave policy, balances, submission and review (HR phase C)

Starting contract: the user-approved direction is an editable [Thailand legal-minimum preset with suggested company settings](thailand-hr-policy-defaults-2026-10-11.md), retaining the policy-dependent workflow gate. Build preset/configuration/validation now; require HR review and activation of a validated effective version before employee writes. Preserve higher existing contractual benefits. Record leave types/eligibility, entitlement versus paid caps, allocation/accrual/proration, carryover/expiry, working/calendar-day basis, time zones/overnight, units/evidence, overlap, overdraft, approver/delegation, return/reject/cancel rules, cross-year split and closed-period adjustments. Synthetic preview quotas are not the preset.

- Model effective-dated policies, employee allocations, immutable ledger events, leave requests, charge-day snapshots and decision timeline. Each request pins org/employee/site/policy version, canonical dates/intervals and charge amount.
- Define atomic deduplicated ledger operations for grant/accrue/carryover/reserve/release/consume; balances derive from auditable events, never an unlogged counter edit.
- Add an authorized charge-preview API using real employee schedule and holidays. Recompute on submit; preview is not authority. Validate evidence, overlap and balance atomically with reservation.
- Reuse HR write outcome/idempotency contracts. A lost response retries the identical pinned command/employee/request ID; payload changes are new explicit intent.
- Implement employee balance/list/detail/request form, server charge preview and evidence upload when configured. Loading/empty/denied/refused/uncertain/returned paths use existing primitives.
- Implement reviewer queue/detail with self-review denial, site/reporting scope, required reasons and immutable decision evidence. Approval consumes reservation and records attendance treatment atomically; return releases and resubmit revalidates.
- Define whole-day LEAVE links and explicit partial-day intervals. Reconcile manual HR leave to avoid double consumption. Preserve closed periods through revisions and split cross-year charges by effective policy/year.
- Gate: concurrent requests cannot overspend; retry/decision cannot double reserve/consume; cancellation and return release exactly once; direct-link/evidence authorization; overnight, half-day, holiday, cross-year and immutable-history integration tests.

### T10 — Announcements and notification inbox (HR phase D)

Starting contract: the Thailand preset's editable company recommendations for HR publishers, explicit organization/site/group audience, versioned reads and acknowledgment off. HR must review and activate publication policy; these settings are not presented as statutory Thai requirements.

- Model announcement draft plus immutable publication versions/audience, versioned per-employee read receipts and durable deduplicated employee events.
- Add HR author/edit/preview/publish companion; employee feed/detail reads enforce audience server-side and omit draft/future versions.
- Implement read/unread semantics explicitly. Reading is separate from required acknowledgment. Updating a publication must define which version employees must read.
- Create notifications from durable request-decision/publication events; use org/employee/event deduplication keys and retryable delivery. Never create a fake notice only in client memory.
- Add paginated employee inbox, unread count, individual/mark-all read and accessible authorized destinations; destination queries re-check permission.
- Gate: cross-site/org audience tests, future/draft invisibility, version/read reconciliation, no duplicate event notices, count/list agreement, stale/removed destination recovery.

### T11 — Imported payslips and protected reveal (HR phase E)

Starting contract: the linked preset's own-published-statement access, fresh provider verification with a suggested five-minute validity window and private short-lived downloads. Actual source format/mapping/document ownership/retention and provider/storage capability remain necessary before HR activation. Verify actual Clerk verification capability before selecting an integration. Payroll calculations remain outside scope.

- Model payroll statement periods separately from attendance periods, private import batches/rows, immutable published statement versions/source documents and audit metadata.
- Stage imports privately. Validate mapping, required amounts, employee identifiers, duplicate rows, selected period/version and exact minor-unit arithmetic; blank values are invalid rather than zero.
- Provide mapping/validation/row exclusion/correction UI with explicit error recovery; re-reading a replacement file clears prior parsed rows. Publish idempotently with an explicit included set.
- Expose employee list/metadata only for authorized published versions. A separate sensitive API verifies employee scope and required fresh authentication before returning any pay values.
- Implement masked/revealed details with accessible reveal/hide and supported verification; cancel/failure stays masked with selected period. Expiry/hide/navigation/logout clears sensitive state.
- Download re-checks scope/verification and binds selected source period/version to a private expiring document. Never embed salary values behind CSS, expose public documents or build a PIN/password store.
- Publish durable employee notifications; audit publication/access/download without salary payloads in logs. Keep pay data out of global search and unintended caches.
- Gate: foreign employee/org/document denial, unpublished/superseded outcomes, expired verification blocks reveal and download, import duplicate/unknown/blank amounts, explicit replacement version, exact source totals and selected document agreement.

## Dependencies and practical delivery sequence

T01/T02/T03 can run in parallel under separate ownership. T04/T05 verify the incumbent workflows and feed concrete defects back to those owners. T06 frontend and authorized employee reads run in parallel; integration is required before its completion. T07 depends on real complete history/request reads and T06 navigation. T08 can follow the delivered shortcut set without waiting for leave policy. T09 can implement the approved Thailand preset/settings and ledger infrastructure now; employee writes require validated HR activation. T10 starts from recommended publication semantics and requires activation plus durable event infrastructure; T11 starts from recommended privacy settings and requires actual source/provider evidence, activation and its private import companion. T10 notifications consume events from T09/T11 when those workflows exist.

Suggested reviewable slices: shell controls; foundation tokens/error edges; catalogue quantities; employee home/holidays; attendance summary/correction hub; frozen periods; preferences; leave domain; leave employee/reviewer UI; announcement publication; durable notifications; payslip import; sensitive employee viewing. Each slice contains code, translations, domain integration tests where behavior changes and a short evidence record. Presentation slices need no data migration; new HR schema phases need additive migration/backfill plans and reviewed deployment order.

## Verification and release gate

- Capture starting and final status; do not reset/reformat/stage unrelated existing work. Read `AGENTS.md` and relevant guides under `node_modules/next/dist/docs/`.
- Run focused shared control/contrast, shell/search, catalogue, scan, floor and HR write regression suites. Add tests for new auth/completeness/persistence/summary behavior, not tests that merely duplicate reversible CSS edits.
- Run changed-file formatting, typecheck, lint and a production build. Run `pnpm check`; identify unrelated baseline failures separately. Inspect built CSS for badge classes, density query, missing invalid rings and focused-invalid precedence.
- Browser inspect desktop/mobile together: 390/768/1024/1280px; 1440px at 200% zoom; Thai/English; light/dark; fine/coarse pointers. At 1024px/coarse assert 48px controls and 16px input text. Check long labels, no page-wide overflow, visible focus and actual controls.
- Run axe A/AA on real rendered routes. Test drawer/search focus return, tabs/disclosures/chips, annual export, matching summary filters and correction deep links. Use T3 collaborative preview first; metadata-only access or failed snapshots do not count as browser verification.
- Use only verified local/staging synthetic fixtures for storage/HR seeds. Physical camera/touch, screen-reader, large-scene and lost-network tests require corresponding devices/environment and must be named if unperformed.
- Final review records shipped capabilities versus policy-gated tasks, passing checks, unrelated failures, screenshots if available and remaining release gates. Completion of a design preview or source test is not proof of deployed production behavior.
- No merge to main or production deployment without explicit release authorization. Roll back only the affected slice if it loses domain actions, permission boundaries or accessible behavior.

## Open decision register

| Decision                                                         | Work blocked                                  | Work continuing independently                                    |
| ---------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| HR activation of Thailand preset, coverage, balances and routing | T09 employee leave writes                     | Preset/settings/calculator/ledger implementation; T01–T08        |
| HR activation of recommended audience/publication settings       | T10 production publication and acknowledgment | Configuration, shared primitives, delivered employee routes      |
| Payslip source/retention/provider evidence and HR activation     | T11 private import/reveal/download            | Recommended privacy configuration; existing attendance exports   |
| Frozen employee attendance-period access                         | T07 closed-period selector/summary            | Truthful live bounded month summary                              |
| Working collaborative browser/auth fixtures                      | Fresh visual/axe/end-to-end release evidence  | Source review, component/domain integration and production build |

See the [detailed HR follow-through](hr-production-follow-through-2026-10-11.md) for the domain/API/model tasks after the delivered home, annual holidays, live bounded summaries and correction request hub. Employee frozen-period selection and request search/date filters remain explicit follow-through tasks; the delivered request status filter operates across complete server cursor pages. The user has now requested configurable Thai legal-minimum or suitable company defaults while retaining the activation gate; the linked preset records that direction. It authorizes implementation of defaults and configuration, without silently activating company workflows or approving synthetic balances.

## Implementation handoff

The [delivery evidence](../reviews/ui-consistency-and-hr-delivery-2026-10-11.md) records the implemented application slices, final checks and limits. T01–T03 are implemented; T04–T05 passed source/regression verification with browser/device checks still open; T06 is implemented; T07 provides live monthly summaries and the paginated correction hub with global status filtering, while frozen period selection and expanded search/date/type filtering remain planned; T08 is implemented; T09–T11 remain gated by the listed company policies. The full plan is complete; the full HR expansion is not claimed complete.
