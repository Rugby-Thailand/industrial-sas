# HR self-service: design and delivery plan

11 October 2026. The user requested a friendly employee experience inspired by ten hrzoft references, with our current application's colors, image-generated studies, a complete HTML preview, Kiro review and fixes, and a final preview to inspect. This package provides design work; it does not deliver new production HR workflows.

## Review package

- [Interactive HTML preview](preview/index.html): run the static server below. Start at Today, then explore the sidebar. The preview toolbar changes the synthetic persona and response states. It is not an authentication mechanism.
- [Image gallery](preview/index.html#gallery): four studies of one shared Action Card, then ten boards covering employee and companion workflows. Each board includes desktop/mobile or related states; they are not fourteen alternative visual identities.
- [Image manifest](manifest.json) contains every exact generation prompt and selected composition. Each PNG also embeds its generation prompt. Selection was by Codex under the instruction to complete the preview; no user approval is recorded.
- [Source references](../../references/hr/README.md): ten unmodified originals, with checksums and screen descriptions.
- [Detailed gap assessment](brief.md), [original delivery requirements](../../plans/hr-employee-self-service-improvement-2026-10-11.md), [Kiro review](review/kiro-review.md) and [final preview review](review/final-review.md).

From the repository root:

```sh
python3 -m http.server 3187 --bind 127.0.0.1 --directory docs/designs/hr-employee-self-service-2026-10-11
```

Open `http://127.0.0.1:3187/preview/`. Assets and fonts are local. No dependency installation or production account is required. Preferences persist only in this browser under a task-specific key; all other sample writes reset when the page reloads. “Start sample again” also clears the saved preferences. The running server is local and temporary.

## Direction and component contract

Preserve rounded task grouping, labelled icons, generous touch spacing, and the references' home → list → detail progression. Keep the Storage Planner shell, Geist/Noto Sans Thai, system controls and semantic status language. The live authority is [globals.css](../../../src/app/globals.css), [Panel](../../../src/components/ui/Panel.tsx) and [StatusBadge](../../../src/components/ui/StatusBadge.tsx). The older design sheet is not the palette authority.

The reusable **Action Card** has a 48px icon pad, descriptive label, optional supporting line and count, neutral surface, border, and 12–16px corners. A shortcut card, a summary card and a request row adapt this anatomy. Interactive variants use an anchor for navigation or a button for actions; static data uses a section. Status appears as text plus a shape, with semantic colors. Hover, focus, selected and unavailable variants remain legible in both themes. Form inputs and primary touch controls are at least 48px high.

Light: primary `#1d4ed8`; ink `#17212f`; secondary `#475569`; white canvas/surfaces; raised `#f6f7f9`; selected `#eff6ff`. Success, warning, danger and pending use the existing paired foreground/background tokens. Dark values match the source. No reference cyan or unrelated pastel category palette is introduced. AI images guide hierarchy; exact copy, arithmetic, accessible controls and tokens are implemented in editable HTML.

The first viewport must show the date/state, original recorded punches, the next clock action and receipt context. Shortcuts follow the clock block; desktop secondary panels never displace the action. Mobile keeps these in one readable column. The header's preview controls are review tooling and will not ship as product controls.

## Current system and missing work

| Area | Production today | Proposed new work |
| --- | --- | --- |
| Clocking | Authenticated in/out, server timestamps, receipts and uncertain-write recovery | Extend Today with shortcuts and next holiday, preserving write protections |
| Attendance | Date history, originals/effective times, corrections, scoped review, period closure/revisions/export | Reconciled monthly/period summaries and matching date filters |
| Requests | Correction submit, certify, return and resubmit | Dedicated complete request hub; then leave request types |
| Holidays | HR site-holiday setup | Read-only annual employee view and complete scoped export |
| Leave | Reviewed day may have LEAVE disposition | Policies, entitlement, reservations, ledger, requests, review and attendance integration |
| Convenience | Read-only employment profile | Saved shortcut preferences, announcements and event-based notification inbox |
| Payslips | Attendance export for payroll process | Imported statement validation/publication, employee list, supported verification, protected document download |

New features above remain unimplemented in production. Existing correction statuses stay `PENDING`, `CERTIFIED`, `RETURNED`. Worked minutes outside the shift do not become approved OT, and incomplete punches do not become absence or lateness judgments.

## Screen and interaction coverage

| Journey | Preview coverage | Production completion requirement |
| --- | --- | --- |
| Today / home | Next action, pending/save receipt, punches, six shortcuts, next holiday and recent requests | Reuse existing clock mutation/idempotency contract; authorized live queries |
| Attendance | Summary cards filter days; originals/effective detail; correction form and CSV | Server aggregation using business date, overnight schedule rules and frozen period revision |
| My requests | Status and search filters; creation chooser; detail/timeline; returned-request resubmit | Paginated type-aware queries and existing correction APIs; complete history |
| Leave | Entitlement/used/reserved/available; full or half day; charge preview; overlap/balance validation | Policy-backed charge calculation and atomic ledger updates with concurrency protection |
| Holidays | Year (independent of the payslip year), month groups, empty future year and complete CSV | Linked employee/site resolution on server, full year completeness |
| Customize | Show/hide, drag-handle reorder (mouse/touch and keyboard through the same handle; no arrow buttons), live preview, unsaved indicator (Save disabled when unchanged), Save/Cancel and reload persistence | Per-user/org preference storage; server validation of allowed destinations |
| Announcements | Audience feed/detail, read status; HR draft/load/publish companion | Audience authorization, versioned content/read receipt; ordinary read distinct from acknowledgment |
| Notifications | Unread count, mark all read, authorized destination and newly created events | Durable deduplicated events and paginated employee inbox |
| Payslips | Year/list (own year selection), masked/revealed detail, cancelable verification that returns focus and takes no password/PIN, 60-second expiry/hide/period or page change reset, synthetic HTML download | Server-gated sensitive query, provider verification when required, private versioned documents |
| Supervisor review | Queue, leave reservation evidence, correction original/effective/proposed from the matching day, required return reason, no duplicate decision | Scope/self-review checks and immutable decision evidence; closed-period revision path |
| HR policy | One scheduled v2 in 2570; saving keeps the persisted v2 values in the form and version panel; carryover ≤ allocation, 0.5-day steps only when half day is enabled | Effective-dated policy source with historical immutability and defined transition rules |
| HR import | CSV mapping, unknown/duplicate ID and satang-exact monetary validation; a replacement read clears prior rows first and a failure names the file; rows are bound to the selected period; excluded/invalid rows are labelled; publication names the month and v1 | Staged private import, full validation, idempotent publish, original documents and replacement-version policy |

Contextual empty lists recover explicitly: requests clear search and status, holiday/payslip lists return to a year containing data, and a completed review queue shows a completion message. The customization preview uses two columns and stacked cards inside its narrow panel. Loading, empty, error and denied states can be selected from the review toolbar. Preview action handlers accept only the matching synthetic role (employee, supervisor/HR or HR); this is a demo affordance, not server security. On mobile the closed drawer is hidden from keyboard and assistive technology; while open, the page behind it is inert, and Escape, the backdrop or a link close it with focus returned to the menu button or content. Those demonstrate visual states; they do not simulate real service failures. The preview is Thai. Production must add equivalent keys to both existing Thai and English message catalogs and follow locale conventions.

## Synthetic data contract

The reference date is Monday 12 October 2026. Attendance covers only 1–12 October: five complete workdays, one ongoing day, one unresolved day, one leave day and four weekends = twelve. Five completed days have forty net hours. Clocking out at 17:30 on 12 October adds 7h59; approving the 6 October correction adds 7h59 separately while preserving its missing original punch. Future scheduled dates are excluded.

Annual leave is 12 entitled − 2 approved − 2 pending = 8 available. Personal leave is 3 available. Sick leave includes a synthetic earlier-year usage baseline of 10, leaving 20 from 30. Values are illustrative company policy, not statutory claims. Pending approval moves a reservation to used without changing availability; return releases it; resubmission reserves again. The initial pending annual request covers 19–20 October. A new form starts at 26–27 October. Weekends and the three synthetic company holidays are excluded. Half day is restricted to one workday in this preview.

Employee is Mintra / EMP-DEMO-01, reviewer is Phatthra / DEMO-REVIEWER. All names, documents and pay values in the preview are synthetic. Example pay arithmetic is 28,000 + 1,500 + 500 = 30,000 gross; 800 deductions; 29,200 net. This is source statement arithmetic, not a payroll formula. Payslip verification is an explicitly labelled local simulation. Masking client data here is not a security design. The real API must not send sensitive amounts before verifying access.

## Production sequence and acceptance

### A · Home and annual employee holidays

Extend Today, reuse a shared Action Card, and add `/hr/holidays` only when functional. Keep current routes and shell. Add an employee-specific holiday query instead of weakening `setup.listHolidays` admin permission. Resolve org, linked employee and site server-side; bounded selected-year input; handle pagination/completeness before export. Home derives next holiday from that same scoped dataset. Clock writes preserve trusted timestamps, idempotency key, pending protection, receipt and unknown-outcome retry.

Acceptance: employee cannot view another site's data by changing IDs; selected-year screen and CSV agree; clocking is reachable on mobile; old routes continue to work.

### B · Attendance summary and request hub

Use the existing attendance evaluator, business dates and schedule snapshots. Extend the bounded history flow with month selection and a complete summary query; period selection requires a separately authorized employee query. Closed periods name and use a frozen revision. Counts link to the exact date set they summarize. Initially aggregate only defined statuses, then add late/early metrics after explicit policy confirmation. Add `/hr/requests` with cursor pagination and correction detail links, then adapt it for later request types.

Acceptance: count reconciliation, future dates excluded, missing punches unresolved, overnight cases, original/effective comparison, current `CERTIFIED`/`RETURNED` contracts, complete older history, draft navigation guards and scope tests.

### C · Leave policy, ledger, request and review

Confirm policy decisions below before coding. Add versioned policy/allocation, leave request, charge-day snapshots and ledger events. Each request records employee, policy version, unit, affected dates, charge amount, status, decision evidence and revision. Grant/accrual/carryover, reserve, release and consume are separate ledger entries with a deduplication key. Available balance is derived consistently; no unlogged counter adjustment.

Submission calculates charges from the effective employee schedule, holidays and policy, checks overlap/eligibility/balance, then creates request + reservation atomically. An uncertain response retries with the same operation ID. Approval consumes reservation and creates linked attendance treatment in the same transaction. Return releases reservation; resubmit revalidates and preserves timeline. Do not overload correction APIs or force new correction statuses. Leave rejection/cancellation is a distinct business decision to resolve, not silently copied from corrections.

Whole-day approved leave may link to `LEAVE`; partial-day work/leave needs an explicit interval model. Reconcile existing manual HR leave disposition to avoid double usage. Period closure checks unresolved linked requests according to confirmed policy; approved historical charges remain frozen. Cross-year requests split charges by effective year/policy. Returning/canceling an already closed-period request needs a revision path rather than rewriting history.

Acceptance: concurrent submissions cannot overspend; retry cannot reserve twice; decisions cannot consume twice; self-review denied; direct-report/site scope enforced; nonworking/partial/overnight/cross-year cases; returned/resubmitted evidence retained; manual/linked leave reconciled; closed period remains immutable.

### D · Announcements, notifications and preferences

Add announcement drafts and versioned publication with authorized audience. Implement read receipts keyed by employee and version. Pin order is explicit; reading does not imply policy acknowledgment. Notifications come from durable decision/publication events, with org/employee key and event deduplication; delivery failures can be retried. Targets re-check authorization. Store shortcut order/visibility by authenticated user/org against a fixed allowlist; inaccessible or undelivered links do not appear. Keep clocking outside preferences.

Acceptance: draft/future publication not visible early; site audiences enforced; updates/read versions defined; counts reconcile with unread list; duplicate events do not duplicate notices; disabled features never become usable links; drag reorder on mouse/touch, keyboard reorder through the same handle, and Save/Cancel survive reload.

### E · Imported payslips and protected viewing

Stage imports privately; validate format, employee mapping, duplicates, source period/version, exact monetary arithmetic and row errors. Do not coerce empty values to zero. Allow explicit corrected re-import or exclusion only with recorded publication scope. Preserve original source and version; prohibit silent overwrite. Publish as one idempotent operation per approved batch and produce employee-scoped notices.

Employee list/metadata query exposes only authorized published metadata. A separate sensitive query checks org + linked employee + supported provider verification when policy requires it, before returning line items. Protected downloads re-check scope and verification, bind selected period/version and expire. Never embed sensitive values behind CSS masking, expose a public file URL or add a custom PIN/password store. Provider capability must be verified before choosing the real verification flow; failed/cancelled verification stays masked and keeps selected period. Hide, expiry, logout and navigation clear sensitive client state.

Acceptance: unauthorized list/detail/document IDs fail server-side; one employee cannot fetch another's slip; revoked/expired verification blocks reveal and download; import duplicates/unknown IDs invalid; version replacement explicit; document totals match source; audit includes publication/verification/download events without salary payloads in logs.

## Policy decisions still required

Leave types/eligibility, grant/accrual/proration, carryover and expiry, calendar/workday basis, time zones and overnight rules, units, evidence thresholds, overlap rules, balance overdraft, approver/delegation, cancellation/rejection, closed-period adjustment and cross-year handling. Announcements need audience/update/read/acknowledgment semantics. Payslips need source format, document ownership, retention, publication correction/versioning and the actual supported account-verification requirement. Confirm these at production implementation planning; the preview is reviewable without turning examples into company policy.

Out of this design scope: payroll/tax calculation, GPS/QR/Beacon attendance, approved OT requests, shift swaps/changes, holiday swaps, offsite requests, expenses, salary advances/installments, certificates, expanded HR contact profile. They remain in the feature gap backlog.

## Engineering handoff and verification

Build one phase at a time with existing Convex auth/permission patterns, Next local documentation, shared components, locale files, route registry, draft guard and period invariants. Prefer an additive feature folder/domain API; do not rebuild delivered attendance. Design reusable interfaces around complete tasks, not a generic form that hides type-specific validation.

Production checks: relevant unit/domain tests for calculation and ledger, Convex integration tests for scopes/concurrency/idempotency, and end-to-end employee/reviewer journeys. Cover dirty draft recovery, keyboard/focus, touch targets, long Thai/English labels, dark theme, 390px phone and desktop, and loading/empty/error/denied states. Observability measures failed/uncertain writes, review delays, export completeness and import publication failures without logging sensitive values.

Preview checks are intentionally scoped to local HTML: source syntax/assets, responsive routes, synthetic arithmetic and key interactions. They are evidence about this design artifact, not a production security or deployment certification. Kiro reviews/fixes this directory only; pre-existing application changes remain untouched. The final review lists results and limitations with screenshots.
