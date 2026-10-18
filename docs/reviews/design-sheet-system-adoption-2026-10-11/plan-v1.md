# Design sheet adoption in Storage Planner

Status: initial plan for Kiro audit. Date: 2026-10-11. Code baseline: `733c6aca`.

Bring the approved original sheet at `http://localhost:3211/` into the existing application through small, reversible changes. Preserve its close labels, compact desktop controls, restrained focus, stronger status contrast, and shared task surfaces. The inner workflow uses the original composition without the experimental Side Rail. The application's navigation, warehouse context, search, permissions, and mobile shell remain available.

This task produces an audited plan and an improved standalone sheet. It does not publish a release. Repository implementation and deployed production status are separate facts.

## Current baseline

Several requested foundations already exist in the current code. Start from these components rather than installing another UI system or copying the sheet's HTML into production.

| Area | Existing implementation | Remaining adoption work |
| --- | --- | --- |
| Density and rhythm | `src/app/globals.css` defines 2px label, 8px field, 16px section, 24px group spacing and a `dense` variant: at least 768px with a fine primary pointer. Buttons and inputs use 48px touch targets and 36px dense desktop controls. | Keep this pointer-aware contract; the sheet's width-only 800px rule needs parity. Verify coarse pointers on wide tablets, fine pointers, zoom, and text wrapping. |
| Focus and field semantics | `input.tsx`, `FormField.tsx`, `ScanCodeInput.tsx`, `SelectControl.tsx` and `focus-field` already share control presentation. | Verify invalid fields, composed controls, hint/error references and tight focus edges; avoid replacing component APIs. |
| Task surfaces and status | `Panel.tsx` has surface/plain/divided appearances. `StatusBadge.tsx` uses icons and text with semantic tokens. | Audit remaining nested framing and contrast through concrete consumers. Keep dialogs, edit boundaries, maps and distinct tasks visibly separated. |
| Job scan | `JobScanScreen.tsx` already has location-first flow, one working surface, a capture toolbar and scoped sticky Save. `TicketCard.tsx` has compact fields, shared sheets-per-pallet labels, source/removal, unit type, duplicate warnings and optional detail validation. | The sheet is missing important behavior and content. Bring the specimen into parity before treating it as a complete screen contract. Preserve camera/image/barcode and draft logic. |
| Finished goods | `FinishedGoodsCatalogue.tsx` already has an unboxed summary strip, short Add action with a full accessible name, shared search/filter controls, product/storage-unit views and cursor pagination. | Correct the sheet's summary units/scope, unavailable totals, both record views, and empty-result recovery. Verify the real continuation/reset paths. |
| Floor workspace | `FloorMap.tsx`, `FloorWorkspaceToolbar.tsx`, `FloorWorkspaceLocationList.tsx` and `LocationDetailsHost.tsx` already manage map/list/split views and context-sensitive details. | Treat the sheet's schematic as composition only. Preserve selected geometry, area identity, inventory, labels, search, view preference and narrow-screen detail presentation. |
| HR attendance | `TodayScreen.tsx` already presents actual times, next action, result, plan and correction links using shared components. `useHrWrite.ts` pins uncertain commands and request IDs. | Extend the sheet beyond its successful clock-out example. Preserve server time, business date, employee scope, pending guards and all existing states. Coordinate with the separate employee self-service design work. |

The current application owns its palette. Its light primary is `#1d4ed8`; the original sheet records an older `oklch(...)` palette snapshot. Adoption should reuse application tokens and preserve the approved composition. No theme reset or palette rollback belongs in this migration.

## Design contract

- One framed surface per task; plain or divided sections inside it. Unboxed counts and receipts. Retain a separate surface when scope, editing, modality or scene interaction requires it.
- 36px controls only under the existing `dense` query; otherwise 48px. Touch inputs remain at least 16px. Labels stay 2px above controls; related fields are 8px apart; task sections 16px and task groups 24px.
- The operating type scale remains 24/32 headings, 18/28 section titles and 14/20 body, with natural Thai wrapping. Large design-sheet introduction type belongs to documentation.
- Input focus uses the shared close edge. Keyboard focus remains visible on buttons, tabs, scanner actions, disclosure and map selection. Status uses text and an icon as well as color.
- Shorten wording only when nearby context is unambiguous. Keep complete accessible names, field units, record counts, source information, server receipts and recovery instructions. Multiple tickets retain a stable ordinal/source/removal row.
- Use existing components: `PageContainer`, `PageHeader`, `SectionHeader`, `Panel`, `FormField`, `FieldGroup`, `Input`, `ScanCodeInput`, `FormSelect`, `CollectionToolbar`, `DescriptionList`, `StatusBadge`, `Notice`, `EmptyState`, `QueryGate`, `DataGate`, `CursorPagination` and `StickyActionBar`.
- Do not copy synthetic records, documentation tabs/captions, static pagination or fake success handlers into the application. Preserve Convex references, Clerk organization identity, grants and domain operations.

## Sequence

### 0. Make the sheet an accurate implementation reference

Retain the original layout and both languages/themes. Add a compact implementation section that maps the proposal to current components and marks what is already present versus what still needs verification. Add reviewable specimens for view-only access, pending work and failed/uncertain outcomes without producing live writes.

Correct the scan specimen's unit type and optional-detail count meaning, catalogue total scope/measurement units, floor selection content consistency and attendance status/timing labels. Make the palette and density differences explicit. Keep the original comparison variants as historical explorations rather than rollout targets.

Acceptance: original composition remains recognizable; synthetic behavior is labeled once; all controls retain names and keyboard behavior; specimen values and captions are internally consistent; Thai, dark, mobile and long content work.

### 1. Verify shared foundations and close concrete gaps

Check the current token and component implementation against the contract before changing it. Record exact consumers that still need spacing, focus, contrast or surface changes. Extend shared presentation only for a demonstrated gap; keep existing API and density aliases compatible. The invalid-field ring should be reviewed alongside the requested restrained focus, with error text and a clear boundary preserved.

Acceptance: shared controls have neutral resting edges, visible keyboard focus, distinct pending/disabled/error states, readable statuses and coarse-pointer targets. No production token is copied from the old sheet snapshot.

### 2. Finish scan parity and verification

Work in `src/features/finishedGoods/jobScan/JobScanScreen.tsx`, `TicketCard.tsx` and relevant `messages/en.json` / `messages/th.json` keys only when the baseline audit proves a remaining presentation gap. Keep mapped/unmapped location context and Change, photo/source inspection, individual field scanning, unit type, two required identities, seven optional values, numeric validation and duplicate acknowledgment. Retain multi-ticket count and source/remove rows, draft navigation guards, in-flight acquisition blocking and the server-confirmed saved outcome.

Acceptance: add/edit/remove several tickets, review duplicates, open invalid optional values, scan either required code, change location, fail and retry a write, and inspect the saved location. The location note continues to explain that saving scans does not assign stock to a location.

### 3. Finish catalogue parity and verification

Reuse the existing summary projection, continuation state, `CollectionToolbar`, filter chips, table/mobile presentation and `CursorPagination`. Preserve products/storage units, unit-specific quantities and actionable status explanations. Keep warehouse totals distinct from the current page and filters; unavailable totals show unavailable, not zero. Preserve URL/history restoration and warehouse-isolated preferences.

Acceptance: product/storage-unit tabs, filter clear, search, page navigation, Back/Forward restoration, empty warehouse versus no matches, unavailable summary, reset/continuation and view-only users all retain their current behavior. No row count is presented as a warehouse total.

### 4. Verify floor composition at real scale

Use the existing map, toolbar, list and inspector ownership. Change only proven chrome/layout gaps. Keep creation/editing actions permission-aware and retain geometry/resize/activation safeguards, 2D/3D modes, labels, saved view selection, off-page selection and map gestures. Do not replace area colors with semantic UI statuses. Preserve existing inline versus compact detail host behavior and focus return.

Acceptance: inspect representative large floors, switch map/list/split and 2D/3D, filter/search/clear, select an off-page location, inspect unknown inventory, hide labels, edit/cancel with unsaved guards and use narrow-screen details. Pan/zoom and pointer cancellation remain usable.

### 5. Verify attendance and coordinate HR scope

Use the current `TodayScreen`, `HrShared`, `HrUi` and `useHrWrite`; keep actual times distinct from the schedule. Cover not linked, inactive, unsupported timezone, not clocked in, clocked in/out, nonworking, unresolved open day and outside employment. The next action comes from the server's `nextAction`. Pending and uncertain writes retain their current guard and pinned request semantics; only a server receipt proves a successful clock. Keep correction and period/history routes available.

The separate `docs/plans/hr-employee-self-service-improvement-2026-10-11.md` owns new employee home, leave, announcements and payslip concepts. This plan does not invent leave/payroll policy or replace that work. Apply only shared presentation and existing attendance refinements here.

Acceptance: uncertain retry repeats the same employee/command/request ID; account or site changes never reuse a receipt; server business dates, overnight work, link/grant restrictions, correction status and immutable closed-period exports remain intact.

## Validation and release gates

1. Before editing, capture current repository status and inspect relevant local Next guides under `node_modules/next/dist/docs/`. Preserve all unrelated work. Use Tailwind/shared components for component styling; reserve global CSS for genuinely shared tokens. Check compiled production CSS ordering.
2. Run focused existing regressions appropriate to each slice. Useful targets include `TicketCard.test.tsx`, `JobScanScreen.test.tsx`, `ticketDraft.test.ts`, `useCatalogueState.test.ts`, `CatalogueFilterControls.test.tsx`, `useFloorWorkspaceView.test.ts`, `TodayScreen.independent.test.tsx`, `TodayPendingGuard.independent.test.tsx` and `useHrWrite.independent.test.tsx`, plus shared-control/a11y tests. Add tests only for new behavior or a confirmed regression.
3. Browser-check the actual application with synthetic local/staging records: 390/768/1280/1440px, Thai/English, light/dark, fine/coarse pointers, keyboard, 200% zoom, long identifiers/names, loading/empty/error/read-only/populated states and repeated submissions. Sheet checks establish sheet behavior only.
4. Text needs 4.5:1 contrast and meaningful non-text controls/focus need 3:1. Check both themes and status backgrounds. Name any screen-reader, physical-camera/touch-device or large-scene testing that remains unperformed.
5. Run repository formatting/typecheck/lint/test commands and the production build for implementation changes. Resolve failures caused by the slice; report unrelated baseline failures separately. Record screenshots and interaction evidence by route and state.
6. Deliver independent slices with exact before/after scope and validation. Release through the existing project deployment process after review. Revert only the affected presentation slice if it loses a domain action, permission boundary or accessibility behavior; no data migration is required for the planned visual changes.

## Risks and open facts

| Risk or unknown | Treatment |
| --- | --- |
| Current code may already satisfy a proposed phase | Verify first and document completion; do not create duplicate abstractions or cosmetic churn. |
| Static sheet omits domain states | Update the sheet and source-backed state contract before using it to implement a real screen. |
| Palette and pointer-density drift | Current application tokens and `dense` contract are authoritative; do not restore the historical snapshot globally. |
| Concurrent HR and AI/runtime work | Keep files scoped and reconcile shared foundations without overwriting uncommitted changes or the separate HR design. |
| Deployment status is unverified | Report repository adoption and deployed release separately. |
| Devices/camera or staging access are unavailable | Complete source and synthetic checks; name the remaining device/environment gate accurately. |

## Kiro audit

Pending. Review must check the plan against current source, identify incorrect baseline claims, missing invariants, scope conflicts and measurable acceptance gaps. The revised plan will record how each material finding was handled.
