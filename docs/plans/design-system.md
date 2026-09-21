# Base design system

## Outcome and scope

Base is applied across Storage Planner on `main`, with a persistent light/dark control in the shared header. The shared controls, page hierarchy, workflow actions, and scene improvements below were implemented on 2026-09-20 using three delegated agents and a coordinating integration review.

Source: https://tweakcn.com/r/themes/cmu9op6pv000004l117146s94

The requested 21st.dev toggle registry returned an authentication error. A local accessible animated sun/moon switch uses next-themes instead, follows the OS initially, and remembers an explicit choice across navigation and reloads. Its label supports Thai and English.

## Color rules

- Neutral light canvas, white cards, and vivid blue primary actions in light mode; black canvas, charcoal cards, and blue primary actions in dark mode. Use Geist and Geist Mono with Thai fallback.
- The imported CSS variables are the source for app surfaces, text, borders, primary actions, focus rings, sidebar, charts, shadows, and radii. Existing `--token-*` names bridge older components to the theme.
- Keep operational colors semantic: green success, amber warning/QC hold, red danger, purple pending. Pair status colors with text or icons; area colors identify physical zones and must remain independent from status colors.
- Use the supplied light foreground on blue primary buttons. Preserve 48px touch controls and the theme’s 4px spacing unit.
- Existing `text-muted` and `bg-accent` have legacy meanings. Do not blindly apply standard shadcn examples: migrate these usages explicitly before changing their global meanings.

## Layout and hierarchy standard

| Element           | Rule                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell         | Sidebar for destinations; header for warehouse, language, and appearance; account in the sidebar footer. Keep page actions in page content. |
| Page heading      | One h1, 24px/32px semibold; concise supporting text at 14px/20px; one primary action.                                                       |
| Section heading   | h2, 18px/28px semibold; consistent optional description and secondary action.                                                               |
| Body and metadata | 14px/20px body, 12px/16px metadata; reserve muted text for secondary information. Allow Thai text to wrap naturally.                        |
| Spacing           | 4px base; 8px related controls, 16px card padding, 24px sections, 32px major groups.                                                        |
| Page width        | Lists and floor planners use available width; forms cap at roughly 48rem; detail summaries cap at roughly 80rem.                            |
| Surfaces          | Canvas → bordered card → overlay. Use modest shadows for floating content, not every nested section.                                        |
| Data tables       | Consistent toolbar, search, filters, count, pagination, row height, numeric alignment, and action placement.                                |
| Mobile            | Wrap header controls and toolbars, stack forms, keep page-wide overflow absent, and scroll tables within their own container.               |
| Interactions      | 48px primary/touch controls, visible keyboard focus, clear disabled states, reduced-motion support.                                         |

## Implementation priorities

1. **P1 — Normalize shared primitives.** Audit Button, StatusBadge, Notice, select, table, dialogs, and sidebar against both themes. Separate brand color from selected/hover surfaces and muted text from muted backgrounds. Verify text contrast at 4.5:1 and meaningful controls at 3:1, including links, placeholders, destructive states, and focus rings. Acceptance: shared specimens cover every state in both languages and modes.
2. **P1 — Unify page templates.** Extend existing PageHeader, PageBackLink, CollapsibleSection, EmptyState, and TableScroller rather than building parallel components. Standardize Storage Layouts and Finished Goods lists first, then product, batch, and pallet details. Acceptance: consistent heading/action locations, spacing, toolbar, pagination, and empty/loading/error states.
3. **P2 — Simplify task hierarchy.** Give each workflow one obvious next action: create batch → pack → measure → place → move/stack. Put location, lot, quantity, and current status ahead of secondary metadata. Keep destructive actions secondary and clearly named. Acceptance: operators can identify the next step without opening several sections.
4. **P2 — Align floor planners.** Audit 2D/3D renderer colors separately from CSS. Preserve customer area colors, ensure selection and occupancy remain distinguishable, and standardize legends, inspector widths, and action bars. Acceptance: selection, reserved space, QC hold, and empty capacity are readable in both modes.
5. **P2 — Responsive and state coverage.** Review 390px, 768px, and desktop widths; Thai/English; keyboard navigation; long names; loading, empty, failed, read-only, and populated states. Add focused regression coverage for shared behavior, not snapshots of every class.

## Implementation record — 2026-09-20

| Area                   | Delivered                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared controls        | Neutral visible input borders, accessible focus and dark-mode link colors, semantic status badge surfaces, consistent select/table/dialog/button states. Primary brand colors preserved.                                              |
| Page templates         | Shared 24px/32px semibold PageHeader across buildings and Finished Goods, optional concise summary, existing longer help preserved, wrapping actions, 16px card padding, consistent section spacing.                                  |
| Forms and catalogs     | Product and new-building forms limited to 48rem; redundant summaries removed; neutral view selectors; responsive search; 48px pagination controls; numeric alignment and contained table scrolling.                                   |
| Workflow hierarchy     | Status remains visible in compact pallet summaries. Scan/storage next action is above the scene, placement verification precedes QR metadata, and packing completion prioritizes the next storage step.                               |
| Floor scenes           | Both modes now update floors, grids, dimensions, labels, selection, reserved/invalid outlines and package faces. Customer area colors are preserved. Toolbar groups wrap and retain 48px targets; existing inspector widths retained. |
| Realistic data display | Seeded AMBIENT product conditions display a localized value; existing custom storage conditions remain visible and are preserved when saving.                                                                                         |

Shared CSS token regression tests enforce 4.5:1 text and 3:1 meaningful control/focus contrast in both modes. Measured light/dark ratios: primary button text 6.71/7.32, links on cards 7.01/10.51, muted text on cards 7.77/7.98, and focus on selected surfaces 6.01/6.74. Selected surfaces use the supplied accent palette rather than interpolating brand blue through an unintended pink hue.

Final combined validation: `pnpm check` passed (88 test files, 853 tests), including type checking and lint. Browser validation completed 70 initial checks across five representative screens plus 8 targeted rechecks after the final corrections, with no recorded geometry failures, main-content axe violations, or runtime errors. The building-status round trip was repeated successfully and its test fixture restored to Active.

Browser evidence lives in `output/design-system/`: Thai/English × light/dark × 390/768/1440px checks on building list/detail, Finished Goods list, product detail, and pallet detail. Automated checks cover page and main-content overflow, a single h1, runtime errors, and WCAG A/AA findings in main content. Test suites also cover loading, empty, error, view-only, long content, status transitions, and workflow actions. Automated checks supplement visual review; they are not a claim that every possible page/state has been manually reviewed.

**Scope boundary:** placement scene data does not expose a QC-hold field. Warning/QC semantic colors are retained, but inventing a new QC workflow or API field is outside this visual update. Independent QC-hold scene rendering requires a separately specified data change. Physical barcode-camera validation remains a device check.

## P1 — Building actions and status toggle (browser feedback, 2026-09-20)

Status: implemented on `main` (2026-09-20), with the broader design-system implementation recorded below.

### Remove duplicate content and actions

- **Comment 1:** Remove the bottom “Quick Change · แก้ไขด่วน” button on building details. Audit similar repeated actions elsewhere and retain one clear, discoverable entry point for each action.
- **Comments 2–3:** Remove the bottom “ตรวจสอบและเปิดใช้งาน” (review and activate) button from both active and draft building details. Activation must remain available through the status workflow below, with existing validation preserved.
- **Comment 4:** Treat the highlighted building summary card below the scene as another duplicate to remove. Keep building code, name, status, and dimensions available once in the main building information area; do not discard unique information.
- Apply the shared detail-page change to all buildings, including the annotated DEMO-ANNEX and LOCAL-DRAFT examples. Avoid leaving an empty action grid or unnecessary space below the scene.

### Draft / Active switch

- **Comment 5:** Replace the building-card status badge on the Storage Layouts list with a labeled Draft / Active switch, visually consistent with the existing light/dark toggle. Use explicit state text rather than sun/moon icons or color alone. Reuse the same control wherever building status can be changed, including a table view if it exposes this status.
- Draft → Active must run the existing activation checks. If review or missing setup is required, guide the user through it; do not bypass validation because the entry point is now a switch.
- Active → Draft is allowed only when safe. Implemented rule: any STORED or RESERVED placement anywhere in the building blocks the transition, including unmeasured/location-only stock and move holds. Existing move workflows retain their source placement until completion and reserve their target, so both ends are protected. RELEASED history and empty floors, zones, or storage-location definitions do not block the transition.
- Enforce the guard on the server against current data, including stock added concurrently. Disable the reverse action in the UI with a visible, localized explanation; a stale client must not be able to bypass the rule.
- Show pending state and prevent repeated submissions. Reflect the saved status only after success; on failure keep the previous status and show the reason. Users without status-change permission retain a read-only status indicator.
- Keep the switch separate from the card's navigation link so toggling never opens building details. Support keyboard operation, accessible names identifying the building, Thai/English, both themes, and reduced motion.

### Acceptance checks

Verified with `pnpm check` (87 test files, 839 tests), server integration tests for empty round trips, occupied/reserved rejection, stale versions, permissions, and a stock insertion after the eligibility read; component tests cover read-only, pending/saved state, validation, and transport failures. Authenticated browser checks confirmed an occupied demo is disabled, incomplete drafts link to review, an empty building returns to Draft and reactivates, duplicate detail content is absent, and mobile has no horizontal overflow. The existing empty pagination fixture was restored to Active after the browser round trip.

- No duplicate bottom quick-edit/activation buttons or building summary card on active or draft detail pages; necessary information and actions remain discoverable.
- A valid draft activates through the switch; an invalid draft explains what needs fixing.
- An empty active building can return to draft when domain rules allow it; an occupied or reserved building cannot, including a direct request or concurrent placement.
- Card navigation, list/table status updates, permission handling, loading/failure states, and mobile layout continue to work.

## Realistic local data

Run `pnpm dev:seed` against the guarded local Convex deployment. The run reuses existing fixtures and rebuilds warehouse summaries. It includes household goods, beverages, machine parts, snacks, and cartons; six zones; draft and created batches; pallets awaiting measurement and placement; reserved pallets; and stacked storage. The fixture manifest records 48 pallets and two buildings including a draft building. The 905 planned annex rows describe capacity, not 905 seeded pallets.

Keep `pnpm dev:seed --pagination` optional: its synthetic 121-row catalogs are useful for pagination checks but are not representative everyday demo data. Never use this local seed on production.

## Implemented — Compact status explanations and recovery (browser feedback, 2026-09-20)

Status: implemented on `main`. Compact building controls now use the shared `StatusReason` component in cards, the location table, and the detail toolbar. Occupied-state explanations open on hover/focus or click/tap; failed activation shows an explanation immediately and a named link to building review only for known setup failures. Network, access, and stale-version failures stay in context. Error identity includes the building, warehouse, status, and version. The 48px icon slot preserves row and card height. Server-side guards and saved status remain authoritative.

Additional audited uses: protected unit selectors in `BatchManager` use authoritative lock reasons; Finished Goods warehouse totals have one scope explanation; active floor editing help now uses the same accessible control instead of a native title. Detailed repacking, physical move/stack, unsaved-change, failed-load, and form-validation notices remain visible. Catalogue batch rows do not expose reliable lock metadata, so no extra restrictions were inferred.

Validation: `pnpm check` passed (89 test files, 863 tests, type checking, and lint). Focused checks cover focus/Escape, persistent popovers, announcements, recovery links, permission denial, repeat-write protection, and obsolete errors across versions/buildings/warehouses. Authenticated browser checks verified stable card heights, automatic error display, correct review navigation, mobile touch, and no runtime errors. All 12 Thai/English × light/dark × 390/768/1440px combinations passed overflow, popover positioning, and automated accessibility checks. Screenshots are in `output/design-system/compact-status-*`.

### UX principles

- **Progressive disclosure:** show the record’s state immediately; reveal secondary reasons on demand. This reduces repeated text without removing the information.
- **Visual hierarchy and stable layout:** status and next action deserve prominence. Keep the switch, state label, and one condition icon in a consistent row; an explanation appearing should not resize every card in the grid.
- **Visibility of system status:** distinguish a normal restriction from a failed action. A lock means a valid state prevents a change; a red error icon means an attempted action failed. Keep Draft/Active text visible.
- **Actionable recovery:** explain why and offer the specific next step. Setup, occupied storage, missing permission, stale data, and a network failure need different remedies.
- **Equivalent access:** hover is a convenience; keyboard focus and touch must also reveal explanations. Keep task-critical instructions visible where the user performs the action.

### Proposed building-card behavior

| State                                         | Compact appearance                                       | Explanation and action                                                                                                                                                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready                                         | Switch + Draft/Active label                              | Normal status change; no redundant information icon.                                                                                                                                                                                                                    |
| Occupied/reserved                             | Disabled switch + Active label + lock icon               | Hover/focus explains why Draft is blocked. The separate lock button is focusable and opens a popover on click/tap. The popover can offer “View stored units” only when a verified route/filter can show the relevant records. Never release reservations automatically. |
| Initial loading or saving                     | Stable switch row + spinner                              | Disable repeat changes. Announce loading/saving through a live region without a paragraph below every card.                                                                                                                                                             |
| Activation fails because setup is incomplete  | Unchanged Draft + red error icon                         | Hover/focus gives a readable explanation, e.g. “Activation failed. Review building setup.” Click/Enter/tap on the icon link opens the building’s existing review page. That page must expose the actual unresolved checks.                                              |
| Network failure or stale version              | Unchanged state + error/retry indicator                  | Explain retry/refresh in place. Do not route to setup as if configuration caused every failure.                                                                                                                                                                         |
| Missing permission or unavailable status data | Read-only status, with a compact explanation when useful | Explain access/unavailability; do not offer a repair destination the user cannot access.                                                                                                                                                                                |

When an attempted change fails, automatically show a brief contextual error message or open its explanation once and announce it to assistive technology. The persistent icon then remains available for inspection. Do not require users to discover a silent failure by hovering. Clear stale errors after a successful retry or a newer authoritative result; do not show an old failure against a newly changed state.

The status icon is visually about 16–18px but has a 48px touch target. Use a readable 14px/20px message, a maximum width around 20rem, wrapping Thai/English text, and viewport collision handling. The icon must sit above the card’s stretched navigation link so activating it cannot accidentally open the wrong destination or toggle the status.

### Tooltip, popover, and link contract

- Text-only hover/focus explanations use the existing Tooltip primitive. They remain open when the pointer moves onto the content and dismiss with Escape. Do not rely on the native `title` attribute alone.
- A disabled native switch cannot be the only explanation trigger. Provide a focusable adjacent icon, with an accessible name including the building and the action/reason.
- A setup-error icon is a real link to the review page, described by a tooltip. Keep the link itself outside the tooltip; clicking goes directly to the remedy on desktop and touch.
- An explanation that needs multiple actions uses a click/tap popover with buttons/links and proper focus handling, rather than putting interactive controls inside a tooltip.
- Keep one live-region announcement for a new failure; avoid duplicate announcements from the icon, tooltip, and alert. Existing server authorization, version checks, and occupancy safeguards stay authoritative.

### Other candidates identified in the current app

| Location                                                                                       | Proposed use                                                                                                                | Boundary                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Building status in cards, location table, and building detail toolbar (`BuildingStatusToggle`) | First rollout: shared compact blocked/error treatment.                                                                      | Retain full reasons on the review page.                                                       |
| Pallet move/stack restrictions (`PalletScreens`, `StackScreen`)                                | Lock indicator beside unavailable actions in lists and compact summaries; link to the blocking upper pallet when available. | Keep physical stacking and verification instructions visible in the active task.              |
| Batch repacking (`PackingScreen`)                                                              | Show a lock reason on compact batch actions for reserved, moving, or stored units.                                          | Keep the main repacking-blocked notice visible once inside the editing workflow.              |
| Floor/zone editing (`StorageLayoutScreens`)                                                    | Compact info/lock beside an unavailable secondary action, with a clear “Save floor changes first” explanation.              | Keep unsaved-work warnings and geometry/placement validation visible while editing.           |
| View-only permissions                                                                          | One context badge explaining the restriction instead of repeating the same paragraph for each control.                      | Do not conceal why the whole page is read-only or expose unauthorized actions.                |
| Summary/occupancy help                                                                         | Info icon for definitions, calculation scope, and optional background.                                                      | Unknown/partial totals must remain visibly marked; never hide uncertainty behind hover alone. |

Do not apply this mechanically to every Notice or alert. Inline field errors, failed saves, active move problems, physical verification, unsaved changes, and destructive-action consequences must remain visible in their task context.

### Implementation sequence and acceptance

1. Introduce a reusable status-reason indicator composing the existing Tooltip/Popover and shared icon/button styles. Model message, severity, and optional verified recovery destination separately from business rules.
2. Apply it to BuildingStatusToggle once so the cards, table, and building toolbar stay consistent. Map known error codes to the correct message/remedy; retain a safe generic explanation for unknown errors.
3. Validate keyboard focus, Escape, touch, screen-reader announcements, newly failed changes, retry, late responses, permission denial, and preserved card navigation. Check both themes, Thai/English, and 390/768/1440px widths. Card height should not change when a blocked explanation opens.
4. Extend to the audited compact secondary controls above after checking each restriction’s meaning. Keep full contextual messages on their workflow pages.

References: [WCAG hover/focus content](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html), [WAI tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) (work in progress), and [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

## Validation and handoff

Run `pnpm check`. Browser-check the authenticated warehouse with light/dark switching, reload persistence, an explicit light preference on a dark OS, and narrow-screen overflow. Use the same fixture to assess the planned list and workflow changes. Before release, also run the production build and dependency audit described in README.md; a dev preview is not a release.

## Implemented — One building workspace for floor viewing and editing

Status: implemented on `main`. The building detail page now owns the selected floor, view, editing mode, and zone-edit intent. It renders one shared floor map with editing tools alongside it on wide screens and below it on small screens. The redundant page header, floor summary, and floor navigation pencils are removed. Legacy floor routes redirect into the unified workspace.

Draft protection covers floor/view changes, same-origin links, ordinary browser Back, reload/unload, and open area/zone editors. Save failures keep the draft; pending saves lock geometry controls. A nested editor must be completed or canceled before Save-and-continue; Discard and Keep editing remain available. Drafts retain their original versions during external updates, while clean floors reconcile saved geometry. Dimension overrides can now be cleared correctly to inherit building defaults, with an integration regression covering subsequent default changes.

Validation: `pnpm check` passes (92 files, 897 tests). Authenticated browser checks passed legacy floor redirect, one-map rendering, Save/Discard/Keep editing, Back protection, save-and-switch, restored fixture values, and populated-floor editing/accessibility/mobile overflow. Zone editing stays in place, closes correctly after Back → Keep editing, and old zone deep links preserve their target. All 12 Thai/English × light/dark × 390/768/1440px editing layouts passed automated accessibility and overflow checks without runtime errors. Screenshots are stored in `output/design-system/unified-*`.

### Outcome

Make the building detail page the single workspace for inspecting and editing every floor. Selecting a floor changes the workspace in place. Retire the separate floor-editor experience while preserving old links. Keep the whole-building model as an alternate view.

### Confirmed current behavior

`BuildingModelWorkspace` and `FloorForm` already share `FloorMap` (the latter through `FloorPlan`). The building page navigates to a separate floor route for its pencil action and map zone-edit action. `FloorForm` additionally owns dimension overrides, floor offset placement, reserved blocks, area calculations, zone management, dirty-state detection, save/version checks, and occupied-layout impact handling. The shared map should remain a single instance in the unified workspace; embedding the entire existing floor form beneath the existing map would duplicate it.

### Proposed interaction

1. Keep one building header: identity, dimensions, Draft/Active status, building settings, and Storage / Building model view selection.
2. Keep floor selection directly below the header. Selecting a floor shows its map and tools without changing pages. Move the pencil action to one clearly labelled “Edit floor” control for the selected floor; remove repeated navigation pencils on every floor tile.
3. Default to inspection. “Edit floor” reveals dimensions/inheritance, offset placement, and reserved-area editing in a collapsible panel beside the existing map on wide screens, below it on narrow screens. Show draft geometry on that same map. Clearly label unsaved changes.
4. Keep the map's existing inspector for selected zones/pallets. Zone edit opens the existing editing dialog in place. Zone creation, editing, deletion, positions, inventory, and related tools remain available in the selected floor's storage section. Preserve their current permissions and safeguards.
5. Show a compact Save / Cancel bar only while the floor has changes. Remove the repeated floor identity/dimension summary and the full-width “already saved” action. Save errors and occupied-layout impact details remain visible near the editing controls.
6. Before changing floors, changing to the whole-building model, closing editing, or leaving with unsaved changes, offer Save / Discard / Keep editing. Switch only after a successful save or explicit discard. Blocked saves keep the draft intact. Zone mutations remain unavailable while unsaved floor geometry could invalidate them; explain why using the compact reason pattern.
7. Preserve the selected floor, view, and zone-edit intent in the URL, e.g. building detail `?floor=2&editZone=...`. Reload and browser back/forward restore the context; validate missing or invalid floor/zone values. Retain old `/floors/2` links as compatibility redirects into the building workspace with that floor selected and editing opened. Preserve `editZone` intent from existing links.

### Implementation sequence

- Extract the floor editing state and controls from `FloorForm` into reusable pieces, leaving existing mutations and validation unchanged.
- Give the building workspace ownership of selected-floor/view/edit state; render one shared map from either saved values or the active draft.
- Integrate floor geometry/reserved-area controls, area summary, and `StorageZonesPanel`; wire the map inspector directly to zone editing instead of route navigation.
- Implement dirty-state transitions, failed-save retention, authoritative-version handling, and permission-aware editing. Refresh saved values after successful mutations without resetting an unrelated draft.
- Update floor pencils, review-page floor links, map links, and legacy route redirects to the canonical workspace. Avoid nested forms and duplicate mutation controllers.
- Remove duplicate floor page presentation only after parity checks pass.

### Acceptance checks

- One map and one set of selected-floor controls; no trip to a second editor page for routine edits.
- All existing dimension, offset, reserved-area, zone/position, inventory, and map actions still work, with the same authorization, collision, occupancy, and version safeguards.
- Dirty drafts survive failed saves; floor switching/back navigation cannot silently discard edits or apply them to another floor.
- Old bookmarks and zone-edit links land in the correct floor and dialog; malformed parameters fail gracefully.
- Read-only and archived buildings expose inspection without editing actions.
- Verify Thai/English, light/dark, desktop/mobile, keyboard focus, dialogs, map sizing, and no horizontal overflow. Test populated and empty floors, reserved/occupied zones, concurrent updates, save failures, and successful save/cancel flows.

Scope: consolidate the existing workflows; do not change stock movement rules, introduce a new geometry engine, or relax activation/occupancy restrictions.

## Implemented — Map label visibility and a scalable floor-location table

Status: implemented. The shared floor map now has a remembered label toggle, one paginated location table, and on-demand selected-location management details.

### Map labels

Add a clearly named Show location labels toggle in the map toolbar, available in both 2D and 3D (and the compact toolbar menu). Default on to preserve current behavior, then remember the user's choice across floors and reloads. Off hides the floating location name/count boxes and their connecting lines only; locations, pallets, reserved areas, selection outlines, and map hit targets remain usable. Keep accessible names on selectable map objects. Users can still select a location and read its full name and details in the inspector. Do not automatically restore all labels when searching or selecting. This is a display preference, not an unsaved floor edit.

### One location table

Replace the wrapping location-button group with a semantic table. Consolidate the repeated lower location-card grid into that same table/selected-location workflow, rather than rendering hundreds of buttons plus hundreds of detailed cards. Preserve every existing QR, position, inventory, edit, and archive function through the inspector or its existing dialogs.

- Columns: code, full location name, dimensions, stored/reserved unit counts, and a compact action column. Use existing authoritative count/status data; retain explicit unknown/unmeasured information and do not equate zero rendered placements with an empty location.
- One shared search for names, codes, exact positions, and pallet identifiers. Support sortable code/name/count columns and pagination (25 rows by default; 50/100 options), with total filtered count and predictable ordering. Verify current query limits before promising complete results; use server pagination/search if the data source is capped.
- Selecting a table location highlights it on the map and updates the inspector. Map selection selects/reveals the corresponding table row/page. Sorting and pagination retain selection by location ID. If filtering excludes it, clear selection explicitly rather than displaying stale detail.
- Table pagination limits rendered rows, not which locations exist on the map. Search has the same meaning in both views; paging must not make floor geometry disappear.
- Show QR codes, positions, and pallet details on demand for the selected location. Keep primary table rows compact and avoid rendering all expanded details or QR images in the background.
- On mobile keep code/name and the selection action readable, with remaining columns in a horizontally scrollable table container. Use semantic headers, keyboard-accessible selection/actions, visible selected state, and full-name wrapping or expansion rather than inaccessible truncation.

### Implementation sequence and acceptance

1. Separate floating label rendering from zone geometry/hit targets in FloorMap. Add the persisted display toggle and keyboard/touch-accessible label.
2. Share search and selected-location state between the map, table, and existing zone-management controls. Reuse existing dialogs and server safeguards.
3. Replace the button group and duplicate card overview with the paginated table; preserve detail links and deep-link selection. Lazy-render selected details.
4. Test empty floors, no search results, unknown/unmeasured inventory, long Thai/English names, selected off-page rows, deletion/filter changes, view-only permissions, and unsaved-edit protection.
5. Browser-check 2D/3D, both themes and languages, keyboard/touch, reload preference persistence, narrow layouts, and representative floors with hundreds of locations. Profile both scene rendering and table/detail rendering; table pagination alone does not solve a slow scene.

Success means one compact location browser, selectable map geometry with labels on or off, no lost actions, and usable interaction at realistic warehouse scale.


### Implementation notes and verification

- The location-code button selects a row; QR, inventory, position, edit, and archive actions remain in the selected-location details. This avoids repeating action buttons across every row.
- Complete floor reads and layout safety checks now support up to 500 active locations per floor. Creating a 501st location is rejected; oversized legacy data fails explicitly instead of silently omitting locations. Existing per-location limits remain in place. This is a bounded complete-data approach, not server-side pagination.
- Browser verification used a temporary 500-location scene without modifying warehouse data. It checked pagination, search, keyboard map selection revealing the correct page, all 500 map targets remaining present, remembered hidden labels, a single selected detail card, and narrow-screen overflow. The temporary route was removed afterward.
- Automated coverage includes label preference/selection, 260-row table paging and count semantics, selected-detail integration, and the 500/501-location backend boundary with resize and activation safeguards.
- Final validation: typecheck and lint passed; 94 test files / 910 tests passed. All 12 Thai/English × light/dark × 390/768/1440px browser combinations passed without page errors or body overflow. The 500-location browser scene had no detected WCAG A/AA violations in the main content.

## Location browser consolidation

Replace the separate table controls and lower storage-location section with one location browser below the floor map. Put the shared search, inventory filters, table/grid switch, and an icon-only Add location action in its toolbar. Keep page size bottom-left and navigation bottom-right; hide the redundant visible range line while retaining screen-reader feedback. Grid and table share ordering, pagination, filtering, and location selection. Empty filters must not classify incomplete inventory as empty.

Move selected-location management into a side panel, retaining QR codes, positions, inventory, editing, archive, and existing permission/unsaved-change safeguards. Keep creation available from the toolbar even without a selected location. Test both presentation modes, filtering and clearing, selected details and creation, compact layouts, locales, and themes.


Status: implemented. The toolbar now owns shared search, inventory filter chips, table/grid presentation, and the Add icon. The page-size selector is bottom-left and page navigation bottom-right. Selected management details open in an accessible side sheet; the compact workspace no longer renders a duplicate lower storage section. Searching does not open the sheet while typing. Closing the sheet returns focus to its opener, and editing reuses the existing dialog and safeguards.

Browser validation: search, grid filters and clearing, table/grid switching, selected detail sheet and close, Add dialog and cancel, no duplicate lower section, and 16 Thai/English × light/dark × desktop/mobile × table/grid combinations passed. No page errors or horizontal body overflow; no detected WCAG A/AA violations in main content.

Final automated verification: typecheck, lint, and 94 test files / 916 tests passed. Changed application/test files pass formatting checks; the diff has no whitespace errors.

## Shared select controls — implemented

All application dropdowns now use SelectControl. The floor browser's grid sorting and page size no longer use native select exceptions. PageSizeSelect shares labels, option mapping and numeric selection validation between cursor and floor pagination, preserving their existing 20/25 defaults and 50/100 options. SelectControl owns default/compact sizing; header selectors no longer define independent shape, border, height and typography styles. ESLint rejects native selects and direct select primitive imports outside the shared implementation.

Validation includes existing shared-select keyboard, empty/disabled/loading/error tests and migrated floor sorting/pagination tests. Full suite: 94 files / 916 tests passed.

## Shared UI patterns

Consolidate repeated presentation without moving business rules into generic components. CollectionToolbar owns search layout and action placement; IconButton owns accessible naming, tooltip text, disabled/loading behavior and button semantics. PaginationFooter shares placement and navigation while callers retain cursor or numbered-page state. DetailsPanel and FormField share repeated structure with caller-owned content and validation.

Reuse existing StatusBadge, StatusReason, BuildingStatusToggle, Notice, EmptyState, RouteLoading and QueryGate/LedgerPanelStatus rather than wrapping them in another general-purpose state component. Warehouse activation rules remain in their existing feature module. Prefer small composable APIs and explicit label/value/action inputs; migrate concrete consumers and test form submission, keyboard, focus and navigation behavior.

Implemented consumers: FloorLocationTable and finished goods ProductScreens now share CollectionToolbar/IconButton; cursor and floor pagination share PaginationFooter; selected storage details and finished goods filters share DetailsPanel; storage fields/override fields and finished goods Field use FormField. Existing feature-specific filtering, pagination state, permissions and mutations remain with their callers. Shared-control regression tests cover pending actions, form submission prevention, page boundaries and accessible field descriptions.

Verification: typecheck and lint passed; 97 files / 920 tests passed. Storage browser checks covered toolbar, filters, grid, selected details, creation, accessibility, and 16 locale/theme/layout/viewport combinations. Finished goods browser checks covered shared search/clear, filters, focus return, and mobile overflow. Browser testing caught a search-clear hit-target issue; the shared toolbar now uses inset positioning instead of a transform that conflicts with pressed-button styling, verified with real pointer clicks. Local web and backend development services are running.

## Inline location inspector — replaces automatic location drawer

The floor workspace now mounts its location-management controller inside the map's inline inspector. Selection from the map/table/grid updates one inspector without opening a sheet or blocking the page. The existing inspector fallback remains for standalone map previews. Create and Edit remain explicit dialogs. Location identity, QR, positions, inventory links, movement and archive actions retain existing permissions and mutation safeguards. QR and positions expand in place; inventory can collapse. A Selected location toolbar shortcut scrolls/focuses the inline panel on narrow screens. Clearing selection restores its empty prompt.
