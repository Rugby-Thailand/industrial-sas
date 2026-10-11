# Design sheet adoption in Storage Planner

Status: revised after an independent Kiro audit. Date: 2026-10-11. Code baseline: `733c6aca`.

Implement the approved original composition from `docs/design-sheet/index.html` at `8b0ef538`, with the source-backed corrections below. The viewing URL is <http://localhost:3211/>. Keep close labels, compact desktop controls, restrained focus, stronger badge contrast and shared task surfaces. The inner workflow has no experimental Side Rail; application navigation, warehouse context, search, permissions and the mobile shell remain available.

This delivery improves the standalone sheet and the adoption plan. Application changes and production deployment are subsequent steps. Merging to `main` automatically releases production: prepare and verify each implementation slice before seeking approval for its merge. No merge or deployment is part of this delivery.

## Authority and present implementation

The application stylesheet and components own production presentation. Reuse them; do not copy specimen HTML or restore the sheet's historical palette. The sheet explicitly labels its 2026-10-09 snapshot; the application light primary is `#1d4ed8`. Proposed badge inks are new additions, not snapshot values to restore.

| Area                  | Already present at the code baseline                                                                                                                                                                                                                                                    | Remaining gap or verification                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density               | `globals.css`: 2px label, 8px field, 16px section, 24px group; `dense` means ≥768px **and fine primary pointer**. Controls are otherwise 48px, with 16px input text.                                                                                                                    | Verify wide coarse-pointer tablets and zoom. The sheet now follows the same density query, independently of its 800/520px layout breakpoints.                                                                                     |
| Fields and focus      | Shared `Input`, `FormField`, `ScanCodeInput`, `SelectControl`; 2px close `focus-field` edge.                                                                                                                                                                                            | Inputs/selects still add a translucent 3px invalid ring. Replace that decoration with a danger border and inline recovery text while retaining the visible focus edge; verify compiled invalid + focus precedence in both themes. |
| Surfaces and statuses | `Panel` already supports surface/plain/divided; `StatusBadge` provides text, icons and semantic backgrounds. Current status ink passes minimum contrast.                                                                                                                                | Adopt the sheet's stronger proposed badge inks in a dedicated foundation slice. Keep existing semantic fills, area colors and non-badge uses stable.                                                                              |
| Scan                  | Location-first context, Change and stock note; source/Remove on **every** ticket; Unit type; per-field scans; seven optional values and filled count; disabled Save/blockers; duplicate review, draft/acquisition guards and confirmed-save screen. View-only replaces the entire flow. | Mostly verify. Preserve real capture/OCR/barcode, multi-ticket and location behavior. The corrected specimen now includes the domain actions omitted by the original.                                                             |
| Catalogue             | Unboxed warehouse summary, product/unit views, filter chips, cursor paging, URL/history restoration, scoped preferences and phone list.                                                                                                                                                 | Right-align quantities and use tabular numerals in table/card consumers. Verify summary preparation/reset, unavailable values, moving units, layout switch and scan-packages action.                                              |
| Floor                 | Map/list/split, 2D/3D, search, labels, geometry/edit guards, selection and context-sensitive detail hosts.                                                                                                                                                                              | Verify rather than replace. `FloorMap.module.css` duplicates some UI colors; distinguish UI ink from persisted physical-area identity before updating any duplicated token.                                                       |
| Attendance            | Actual times, server-owned next action, plan, receipts, correction links and write outcomes.                                                                                                                                                                                            | Verification only here. The concurrent HR self-service plan owns edits to `TodayScreen`, `HrShared`, `HrUi` and `useHrWrite`. Hand it the corrected specimen as input.                                                            |

## Contracts that must survive

- One task surface with plain/divided sections, unboxed counts and receipts. Separate surfaces remain when scope, editing, modality or scene interaction needs them.
- Keep the current density, spacing, 24/32 page headings, 18/28 section headings and 14/20 body scale; Thai wraps naturally. Documentation's large introduction type is not app type.
- Keyboard focus stays visible on fields, buttons, scanner actions, tabs, disclosure, filter chips and map areas. Error text, meaningful status text and complete accessible names remain available.
- Every scan ticket keeps its ordinal, source and Remove action. Shorten visual weight, not domain meaning. Preserve units and receipts even when nearby wording can be shorter.
- Existing components remain the building blocks: `PageContainer`, `PageHeader`, `SectionHeader`, `Panel`, `FormField`, `FieldGroup`, `Input`, `ScanCodeInput`, `FormSelect`, `SegmentedControl`, `SearchField`, `IconButton`, `CollapsibleSection`, `StatusReason`, `OutcomeGate`, `CollectionToolbar`, `FilterChips`, `DescriptionList`, `StatusBadge`, `Notice`, `EmptyState`, `QueryGate`, `DataGate`, `TableScroller`, `CursorPagination`, `StickyActionBar` and `HrTimeCell`.
- Never copy synthetic records, documentation state selectors, static paging or fake success handlers into application code. Keep Convex references, Clerk organization identity, grants and domain operations.

### Counts and write outcomes

Catalogue Products counts products. To measure, To store and In storage count **storage units**, not displayed product rows. To store includes reserved units; In storage excludes moving units, which have their own line. Product records are Draft/Ready; storage-unit rows carry workflow statuses. Unknown/loading/preparing/reset totals are not zero.

Finished goods and HR have different write models. A scan failure preserves drafts and shows the coded error. An unchanged retry reuses a memory-held request ID keyed by payload; the server replays it. Editing the payload after an unknown failure creates a new ID. There is no finished-goods uncertain UI: changing that contract requires separate behavioral work.

HR distinguishes SAVED, REFUSED, DENIED and UNCERTAIN. Pending writes are navigation-guarded. Uncertain writes pin the exact command, employee and request ID for safe retry and preserve intent in session storage; uncertainty is **not** navigation-guarded. Only a server receipt confirms success. Intent/receipt keys depend on organization, actor and linked employee, not site. Account, organization or employee-link changes must never reuse an intent or receipt.

## Ordered rollout

### 0. Correct the sheet and freeze its history — delivered in this task

Freeze comparison assets before editing. Retain the original quiet composition, close labels, both languages/themes and layout breakpoints. Make density pointer-aware and label the historical palette and proposed ink. Restore quiet scan source/removal, Unit type, field scanners, Change, stock note, filled count and disabled-Save blockers. Distinguish product and storage-unit rows, warehouse totals, filters and empty recovery. Make all floor zones selectable with truthful contents and dimensions. Correct attendance labels, tones, Thai business date, missing-time text, receipt and correction links. Separate refused, generic finished-goods failure, uncertain HR and view-only examples.

The sheet's small Review state selector illustrates these states with synthetic local data. It is documentation chrome. Detailed production paging, mobile lists, floor sheets, multi-ticket and correction flows remain source-owned; their rollout checks are below.

Acceptance: both languages show every restored action, Save cannot confirm invalid data, product rows never use storage statuses, unavailable totals never become zero, selected contents match drawn pallets, and HR uncertain offers a safe retry rather than a new clock action. Historical variants load frozen assets. Fresh visual/axe layout review remains a release gate when the collaborative preview host is connected.

### 1. Shared status ink and invalid edges — implementation slice

Add dedicated light/dark badge-ink tokens for success/warning/danger/pending:

| Ink     | Light     | Dark      |
| ------- | --------- | --------- |
| Success | `#084d2c` | `#8be3b7` |
| Warning | `#643900` | `#ffd08a` |
| Danger  | `#851c16` | `#ffbbb4` |
| Pending | `#3e258a` | `#d0c0ff` |

Use them for `StatusBadge` text, icon and edge where appropriate; keep semantic surfaces and all other semantic token consumers stable. The sheet's proposed ink is the chosen direction. Target at least **7:1 badge text** on the existing corresponding surfaces in both themes, and 3:1 meaningful edges/focus. Coordinate shared-foundation changes with the HR self-service work. Inventory duplicated UI values in `FloorMap.module.css`; update only matching badge/UI consumers if affected, never persisted area colors.

Remove `ring-3 ring-destructive/20` from Input and Select presentation. Keep a danger border, inline error and 2px focus utility. Test rest, invalid, focused-invalid, disabled and composed scanner/select controls in both themes and densities. No component API redesign is needed.

Gate: shared control, field semantics, status and contrast regressions pass; built CSS has one restrained, visible focused-invalid edge. Capture the actual application examples before merging.

### 2. Catalogue quantity alignment — implementation slice

Right-align numeric quantities and apply tabular numerals in `FinishedGoodsTable` and the relevant card/mobile value consumers. Retain unit labels and format/status breakdowns. Verify all existing paths: products/storage-unit tabs, scan-packages header action, cards/table control, phone list, filter removal/clear, debounced search, continuation and page-size reset, Previous/Next without a total page count, Back/Forward restoration and warehouse-isolated preference state.

Exercise summary preparation, unavailable/not-ready, reset with its one automatic restart, reserved/moving semantics, empty warehouse versus no matches, view-only grants and scoped warehouse totals. No page/filter count may replace a warehouse total.

Gate: quantity presentation improves without modifying arithmetic, references, grants, filtering or pagination. Filter-empty has an actionable recovery. Summary states never invent zero.

### 3. Scan — verify existing adoption; change only a demonstrated gap

Use `JobScanScreen`, `TicketCard`, `ticketDraft` and existing message keys. Add/edit/remove multiple tickets; retain source row even for one. Exercise PALLET/BOX/OTHER, required-field blur errors, invalid optional quantities opening their disclosure, per-field scanning, machine-read review, duplicates and their explicit acknowledgment. Verify mapped/unmapped location, Change, stock note and sticky action safe-area padding.

Save stays disabled with the correct reason during reading, incomplete identities, invalid quantities and unreviewed duplicates. Permission-limited users see only `ViewOnlyNotice`. Failed saves keep drafts and coded feedback. Simulate a lost response and an **unchanged** retry; prove the same request ID is replayed without a second write. The confirmed screen shows count, location, stock note, Scan more and View records. Preserve draft navigation guards and late capture callback blocking.

Gate: baseline functionality passes; modify presentation/copy only for an observed mismatch. Do not add HR's pinned uncertain UI to finished goods as a visual change.

### 4. Floor — verification only unless a specific gap is found

Verify UI-B-DEMO and UI-B-REFERENCE, including the existing complete-data boundary for large floors. Preserve map/list/split, 2D/3D, filters, labels, off-page selection, pointer cancellation, edit/resize/activation and draft guards. Unknown inventory is unavailable, not zero. Map selection, status and physical area color remain separate.

Details open in a compact sheet below **851px workspace width**, or below **1400px in split view**; split is available from **1100px**. Wide workspaces use inline details. These are workspace measurements, not sheet breakpoints. Verify focus return and reselect-to-clear behavior. Schematic geometry is not a layout replacement.

### 5. HR — verification and handoff only

No edits to `TodayScreen.tsx`, `HrShared.tsx`, `HrUi.tsx` or `useHrWrite.ts` while the separate [HR self-service plan](hr-employee-self-service-improvement-2026-10-11.md) is active. Shared tokens from step 1 are coordinated there. This plan does not own new employee home, leave, announcements or payroll policy.

Verify gate loading/unavailable/denied/timezone notice; NOT_LINKED, INACTIVE, TIMEZONE_UNSUPPORTED, NOT_CLOCKED_IN, CLOCKED_IN, CLOCKED_OUT, NONWORKING, UNRESOLVED_OPEN and OUTSIDE_EMPLOYMENT. UNRESOLVED_OPEN with a pending correction hides the correction action. Honor server `nextAction` even on nonworking days. Test pending, saved, refused, denied and uncertain outcomes; uncertain retries the exact pinned command even if live state changes. Check server business dates, overnight work, identity scope, correction/history routes and immutable closed-period exports.

Gate: current behavior is preserved and handed off with any source-backed issues. Pending navigation guard and uncertain persistence remain distinct.

## Validation and release gates

1. Capture repository status; preserve concurrent HR, search and runtime work. Read applicable local Next guides under `node_modules/next/dist/docs/` before application code changes. Use shared/Tailwind presentation, with global CSS only for genuinely shared tokens. Verify production CSS ordering.
2. Run relevant existing tests, not every unrelated suite on each documentation edit. Shared targets: `FormField.test.tsx`, `StatusBadge.test.tsx`, `theme-contrast.test.ts`, `sharedControls.test.tsx`, `SelectControl.test.tsx`. Workflow targets include `TicketCard.test.tsx`, `JobScanScreen.test.tsx`, `ticketDraft.test.ts`, **`useCatalogueState.test.tsx`**, `CatalogueFilterControls.test.tsx`, `DataGate.test.tsx`, `CollectionToolbar.test.tsx`, `FinishedGoodsMobileList.test.tsx`, **`useFloorWorkspaceView.test.tsx`**, `FloorMap.workspace.test.tsx`, `FloorMap.labels.test.tsx`, `HrScreens.test.tsx`, `HrSimplification.test.tsx`, `TodayScreen.independent.test.tsx`, `TodayPendingGuard.independent.test.tsx` and `useHrWrite.independent.test.tsx`. Add tests only for new behavior or a regression.
3. Use isolated local/staging synthetic fixtures: `pnpm dev:seed --storage-ui` provides UI-B-DEMO, UI-B-REFERENCE, archived and no-floor buildings; `--pagination` provides 121 products and NEEDLE; `--hr` provides attendance fixtures. These mutate test data: select the intended test environment first, never production.
4. Browser-check 390/768/1024/1280px and 1440px at 200% zoom, Thai/English, light/dark, fine/coarse pointers, keyboard, long names and all relevant states. At 1024px with a coarse pointer, assert 48px controls and 16px inputs. Check tab arrows/Home/End, map Enter/Space, disclosures and chip removal. Sheet DOM checks prove semantics and local interaction only, not real layout or backend behavior.
5. Text/placeholder contrast ≥4.5:1, large text and meaningful non-text edges/focus ≥3:1; proposed badge ink ≥7:1. Run axe A/AA rules and name any unperformed screen-reader, camera/touch-device or large-scene checks. Capture before/after screenshots by route/state. Historical evidence is not evidence for this revision.
6. For application slices, run `pnpm check`, focused tests and `pnpm build`; verify compiled production CSS. Resolve slice failures and report unrelated concurrent baseline failures separately. Formatting is checked on changed documents; full repository formatting must pass at merge or unrelated failures be identified.
7. Review each concrete slice before merge. **Merging to main automatically deploys production; it needs explicit release authorization.** Revert only the affected presentation slice if it loses a domain action, permission boundary or accessibility behavior. Planned presentation changes need no data migration.

## Audit disposition and evidence

Kiro used `claude-opus-5.5`, high effort, and approved the direction with no P0. Its [independent report](../reviews/design-sheet-system-adoption-2026-10-11/kiro-audit.md) remains unchanged; [plan-v1.md](../reviews/design-sheet-system-adoption-2026-10-11/plan-v1.md) preserves its exact input.

| Finding                              | Resolution                                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 scan actions/validation         | Corrected specimen; every-ticket actions and disabled-save model made explicit in steps 0/3.                                                                                                                                              |
| P1-2 product/unit semantics          | Distinct specimen views and warehouse scope; reserved/moving, reset/preparation and cursor checks in step 2.                                                                                                                              |
| P1-3 write outcome models            | Separate state examples and contracts; FG unknown-response editing remains a documented behavior outside visual scope.                                                                                                                    |
| P1-4 attendance and concurrent scope | Corrected labels/tones/date/receipts/requests; HR step is verification/handoff only.                                                                                                                                                      |
| P1-5 status ink ownership            | Dedicated adoption slice with chosen inks and ≥7:1 gate, coordinated with HR.                                                                                                                                                             |
| P1-6 palette provenance              | Snapshot strip explicitly dated and current app primary shown; app remains authority.                                                                                                                                                     |
| P1-7 variant drift                   | Frozen JavaScript/CSS/tokens and font paths; existing evidence marked historical.                                                                                                                                                         |
| P1-8 density                         | Sheet uses the current pointer-aware query; coarse-tablet gate specified.                                                                                                                                                                 |
| P2 follow-ups                        | Truthful floor selection/dimensions, compact-sheet thresholds, corrected test suffixes, missing HR/catalogue states, accurate identity/guard scope, invalid edge decision, localized terms/fallbacks and automatic release rule included. |

Existing baseline regression run: **8 files, 39 tests passed**, covering shared field/status/contrast, ticket quantity/draft, catalogue state and attendance pending/retry guards. It does not prove full workflow or deployed state. Fresh sheet checks passed **68 language/theme/state combinations**, **16 selected-rule structural axe runs** and **1,480 DOM/event/source assertions**. The proposed opaque badge pairs calculate to **7.96:1–9.72:1** from their hex colors. See `docs/design-sheet/evidence/adoption-checks.json`; these are not browser layout or production checks.

The collaborative preview opened metadata but its automation host was disconnected. Fresh visual layout, computed density, browser axe, production-build/CSS and physical-device checks have not been performed for this documentation revision. Source and DOM verification can proceed; those release gates remain open. Deployment status is unverified.
