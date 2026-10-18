# Component reuse and UX consistency: implementation (2026-10-10)

Implements [the approved plan](../plans/component-reuse-and-ux-consistency-2026-10-10.md) with the original [design sheet](../design-sheet/index.html) as the visual target. Kiro built the shared layer and coordinated four Kiro crew workers with non-overlapping ownership (HR, Finished Goods, job scan, storage), then ran a final pass on gaps found by Codex's concurrent audit. Codex fixed the shared Button's server/client boundary and several common consumers; those fixes are kept and listed separately below.

Kiro implemented the source changes and a bounded UI improvement batch after auditing all 81 initial screenshots. Codex audited, corrected and integrated the work while preserving concurrent changes, then verified the production application in 91 final captures. Tailwind v4 remains the foundation. No commit, push, deployment, schema change, seeding or real application write was performed. The private worktree received the existing locked dependencies through an offline install; no package versions changed.

## Result

Each recurring UI rule now has one implementation that features compose:

- **Density.** 48px touch targets compact to 36px under one `dense:` variant (≥ 48rem with a fine pointer).
- **Field rhythm.** Labels sit 2px above inputs; related fields and field messages are 8px apart.
- **Task spacing.** 16px between sections and 24px between task groups.
- **Focus.** Fields keep the outline on the border; other controls use a separated 2px ring.
- **Surfaces.** One framed surface per task.
- **Shared controls.** Headings, search, segmented choices, pending actions, status, notices, disclosures, confirmations, empty states, summaries, tables and measurements each have one implementation.

Replaced feature copies were deleted, and ESLint now rejects re-introducing them.

## Baseline and workspace notes

- **Merge conflict markers.** The pristine `messages/en.json` and `messages/th.json` contained unresolved stash-merge markers (`<<<<<<< Updated upstream` at line 1397), so typecheck and every test that imports messages failed.
  - The conflict was resolved as a union of both sides. The upstream JobScan barcode-image keys and the stashed HR namespaces were both kept. The duplicate `locationLookupDenied` key appears on both sides with identical text, so it was kept once.
  - Both files parse and contain no duplicate keys. Nothing else in the baseline was changed.
- **Baseline after the marker fix** (before any code change):
  - typecheck: pass;
  - lint: pass;
  - `format:check`: fails on 12 pre-existing documentation files;
  - tests: 10 failed out of 2,680.
  - Five of those failures are deterministic and unrelated (see Checks). The other five were 5s timeouts under full-suite load in `StorageLayoutScreens`, `PackingScreen` and `ProductScreens`; none of them recur in the final run.
- **Message edits.** Concurrent workers edited messages only through a locked, formatting-preserving merge script (`output/cr-tools/messages.mjs`, ignored by git). It requires identical English and Thai key paths.

## Changed files

The initial Kiro implementation compared with the pristine baseline manifest: 20 added, 125 modified and 5 deleted files, excluding ignored `output/` tooling and the parallel UI-audit draft. This includes Codex's shared-module fixes and the message-conflict resolution. `messages/*.json` changes are the conflict resolution plus the patches `patch-shared`, `patch-hr-1`, `patch-fg-1/2`, `patch-jobscan-1` and `patch-storage-1/2`. The UI audit batch adds `patch-ui-batch-1` and the files marked "(UI batch)" below; Codex's concurrent root HR merge (`output/cr-tools/report-codex-integration.md`) is not itemised here, and Codex's final three-way integration owns the exact file list.

### Added

- `docs/reviews/`: `component-reuse-implementation-2026-10-10.md`
- `src/components/storageLayouts/`: `measureText.ts`
- `src/components/system/`: `useNavigationGuard.test.tsx`, `useNavigationGuard.tsx`
- `src/components/ui/`: `ButtonControl.tsx`, `ConfirmDialog.tsx`, `DescriptionList.tsx`, `SearchField.tsx`, `SectionHeader.tsx`, `SegmentedControl.tsx`, `buttonActivation.test.tsx`, `buttonVariants.ts`, `disclosure.ts`, `sharedControls.test.tsx`, `sidebar.test.tsx` (UI batch)
- `src/features/finishedGoods/jobScan/`: `TicketCard.test.tsx`
- `src/features/hr/`: `EmployeeForm.test.tsx`, `PeriodsScreen.test.tsx`
- `src/hooks/`: `useMeasureFormat.ts`
- `src/i18n/`: `sharedCopyCoverage.test.tsx`
- `src/lib/format/`: `measure.ts`

### Modified

- `./`: `eslint.config.mjs`
- `docs/plans/`: `component-reuse-and-ux-consistency-2026-10-10.md`
- `messages/`: `en.json`, `th.json`
- `src/app/`: `globals.css`
- `src/app/[locale]/`: `not-found.tsx`
- `src/app/[locale]/(auth)/sign-in/`: `SignInScreen.tsx`
- `src/components/examples/`: `c-sidebar-2.tsx`
- `src/components/providers/`: `DraftGuardProvider.test.tsx`, `DraftGuardProvider.tsx`, `IdentityProvider.tsx`
- `src/components/shell/`: `AccountButton.tsx`
- `src/components/shell/search/`: `SearchDialog.tsx`, `SearchDialogLoader.tsx` (UI batch)
- `src/components/shell/`: `LocaleSwitcher.test.tsx` (UI batch)
- `src/components/table/`: `DataTable.tsx`, `DataTable.test.tsx` (UI batch)
- `src/components/storageLayouts/`: `AreaColorPicker.tsx`, `FloorLocationTable.test.tsx`, `FloorLocationTable.tsx`, `FloorMap.module.css`, `FloorMap.tsx`, `FloorMapCameraControls.tsx`, `FloorMapDrawing.tsx`, `FloorWorkspaceLocationList.module.css`, `FloorWorkspaceLocationList.tsx`, `FloorWorkspaceToolbar.module.css`, `FloorWorkspaceToolbar.tsx`, `StorageZoneDraftPreview.test.tsx`, `StorageZoneDraftPreview.tsx`, `StorageZoneVisualizer.tsx`
- `src/components/system/`: `CollectionToolbar.tsx`, `CursorPagination.tsx`, `DataGate.tsx`, `LedgerPanelStatus.tsx`, `PublicInfoNav.tsx`, `SetupChecklist.tsx`
- `src/components/ui/`: `CheckboxControl.tsx`, `CollapsibleSection.tsx`, `EmptyState.tsx`, `FormField.tsx`, `IconButton.tsx`, `Notice.tsx`, `PageContainer.tsx`, `PageHeader.tsx`, `Panel.tsx`, `ScanCodeInput.tsx`, `SelectControl.tsx`, `StatusBadge.tsx`, `StatusReason.tsx`, `TableScroller.tsx`, `animated-toggle.tsx`, `button.tsx`, `input.tsx`, `select.tsx`, `sidebar.tsx`
- `src/features/finishedGoods/`: `BarcodeCameraBox.tsx`, `BarcodeCropControls.tsx`, `BarcodeImagePicker.tsx`, `BatchManager.test.tsx`, `BatchManager.tsx`, `CatalogueFilterControls.tsx`, `DestinationPicker.tsx`, `DestinationScanner.tsx`, `FinishedGoodsCatalogue.tsx`, `FinishedGoodsMobileList.tsx`, `FinishedGoodsTable.tsx`, `MoveScreen.test.tsx`, `MoveScreen.tsx`, `PackingCompletion.tsx`, `PackingScreen.test.tsx`, `PackingScreen.tsx`, `PalletScene.tsx`, `PalletScreens.test.tsx`, `PalletScreens.tsx`, `PlacementEditor.tsx`, `ProductBatches.tsx`, `ProductScreen.tsx`, `ProductScreens.test.tsx`, `StackScreen.tsx`, `shared.tsx`
- `src/features/finishedGoods/jobScan/`: `AddLocationForm.tsx`, `JobScanRecords.test.tsx`, `JobScanRecords.tsx`, `JobScanScreen.test.tsx`, `JobScanScreen.tsx`, `LocationImageReader.tsx`, `LocationPhotoCamera.tsx`, `LocationPicker.tsx`, `PhotoCapture.tsx`, `TicketCard.tsx`, `TicketFieldScanner.tsx`, `ticketDraft.ts`
- `src/features/hr/`: `CorrectionForm.tsx`, `DayDetailView.tsx`, `DayScreen.tsx`, `EmployeeForm.tsx`, `EmployeesScreen.tsx`, `HistoryScreen.tsx`, `HrReviewCompletion.test.tsx`, `HrShared.tsx`, `HrSimplification.test.tsx`, `HrUi.tsx`, `PeriodDetailScreen.tsx`, `PeriodsScreen.tsx`, `ProfileScreen.tsx`, `ReviewDetail.tsx`, `ReviewScreen.tsx`, `SettingsScreen.tsx`, `TimeSideField.tsx`, `TodayPendingGuard.independent.test.tsx`, `TodayScreen.independent.test.tsx`, `TodayScreen.tsx`
- `src/features/storageLayouts/`: `AreaOverview.test.tsx`, `AreaOverview.tsx`, `BuildingAreaDetails.test.tsx`, `BuildingAreaDetails.tsx`, `NamedLocationCatalogue.tsx`, `StorageLayoutScreens.test.tsx`, `StorageLayoutScreens.tsx`, `StorageLocationCatalogue.test.tsx`, `StorageLocationCatalogue.tsx`, `StorageZonesPanel.tsx`, `WorkspaceFloorSelector.tsx`, `storageLayoutShared.tsx`, `useWorkspaceQuery.ts`
- `src/lib/`: `navigationGuard.ts`, `utils.ts`
- `tests/e2e/workspace/`: `barcode.spec.ts`

### Deleted

- `src/components/reui/`: `alert.tsx`, `badge.tsx`
- `src/features/storageLayouts/`: `useWorkspaceNavigationGuard.test.tsx`, `useWorkspaceNavigationGuard.tsx`
- `src/hooks/`: `useUnsavedWarning.ts`

## Shared interfaces (final)

### Tokens (`src/app/globals.css`, Tailwind v4 `@theme inline`)

| Token / utility                                                              | Value and use                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@custom-variant dense`                                                      | `(width >= 48rem) and (pointer: fine)`. The only control-density breakpoint; tablets keep 48px and 16px input text                                   |
| `--spacing-touch` / `--spacing-control`                                      | 48px / 36px (`min-h-touch dense:min-h-control`)                                                                                                      |
| `--spacing-label`, `--spacing-field`, `--spacing-section`, `--spacing-group` | 2px, 8px, 16px, 24px                                                                                                                                 |
| `focus-ring`, `focus-field`, `focus-field-within`                            | 2px outline, offset 2px; field outline on the border, offset -1px (`-within` for a composed field box). Global `:focus-visible` is now 2px (was 3px) |
| `scrollbar-quiet`, `::selection`, input caret                                | Theme-aware browser surfaces                                                                                                                         |

`cn()` (`src/lib/utils.ts`) registers the semantic spacing names and focus utilities with `tailwind-merge`. Without this, `gap-2` would not replace `gap-field` and `min-h-11` would not replace `min-h-touch`. The production palette is unchanged; the sheet's frozen palette and proposed status colours were not copied.

### Components

| Module                                                        | Interface                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/button` (`ButtonControl` client, `buttonVariants` static) | Sizes are `touch` (default), `sm` and `icon`, all 48/36. `default`, `lg` and `icon-sm` remain as aliases at the same density. `pending` and `pendingLabel` render a spinner with the label, disable the button and set `aria-busy`. With `asChild`, `pending` or `disabled` sets `aria-disabled` and cancels mouse, Enter and Space activation without swapping content |
| `ui/IconButton`                                               | Unchanged API; pending is delegated to Button (spinner only)                                                                                                                                                                                                                                                                                                            |
| `ui/input`, `ui/select`, `SelectControl`, `FormSelect`        | 48/36 fields with 16/14px text and field focus. `fieldControlClassName` for textareas. `SelectControl size="compact"` keeps the shared height (it was 44/32)                                                                                                                                                                                                            |
| `ui/FormField`                                                | `FormField` (12/18 medium label, `mb-label`; hint and error 8px below with ARIA links), plus `FieldMessage`, `fieldLabelClassName` and `FieldGroup({ columns: 1\|2\|3 })`                                                                                                                                                                                               |
| `ui/CheckboxControl`                                          | `CheckboxControl` (16px glyph), `CheckboxField({ label, description?, ...input })`, `choiceTargetClassName` (48/36 label target)                                                                                                                                                                                                                                        |
| `ui/SearchField` (client)                                     | `value`, `onValueChange`, `label`, `clearLabel`, `placeholder?`, `disabled?`, `id?`, `name?`, `type?`, `describedBy?`, `onEnter?`, `inputRef?`. Enter is suppressed unless `onEnter` is given; clearing returns focus to the input. `CollectionToolbar` composes it                                                                                                     |
| `ui/SegmentedControl` (client)                                | Generic `value`/`onValueChange`, `label`, `options[{ value, label, icon?, count?, disabled? }]`, `iconOnly?`. A `role="group"` of `aria-pressed` buttons; selection uses the `active` variant. `onOptionActivate` (Codex) re-runs existing re-click logic                                                                                                               |
| `ui/Panel`                                                    | Polymorphic `as` (`section`/`div`/`article`/`aside`/`form`/`fieldset`/`figure`/`li`/`ul`/`p`) with native props. `appearance` is `surface` (12px radius frame), `plain` or `divided`; `padding` is `default` (16px), `compact` or `none`. `panelClassName()` covers links and other non-Panel elements                                                                  |
| `ui/SectionHeader`                                            | `title`, `description?`, `actions?`, `id?`, `level?: 2\|3`. 18/28 semibold, no outer margin                                                                                                                                                                                                                                                                             |
| `ui/DescriptionList`                                          | `items[{ id?, label, value }]`, `layout: rows\|dense\|grid\|stat`, `columns?`, `label?`                                                                                                                                                                                                                                                                                 |
| `ui/EmptyState`                                               | `size: default\|compact` (compact is inline and left-aligned); `role="status"`                                                                                                                                                                                                                                                                                          |
| `ui/StatusBadge`, `ui/Notice`                                 | Lucide shapes (`TONE_ICONS`) replace the Unicode glyphs. `StatusBadge size="large"`. Notice has a 1px tone edge and a tone icon; the 4px left border is gone                                                                                                                                                                                                            |
| `ui/TableScroller`                                            | `label`, `hint?`, `maxHeight?: "md"`, `className?`. A named, focusable scroll region                                                                                                                                                                                                                                                                                    |
| `ui/CollapsibleSection` (client)                              | `keepMounted?` (default `false` unmounts closed content), `appearance: card\|plain`, `defaultOpen?`, `open?`/`onToggle?`, `id?`, `badge: ReactNode`. Content is a `role="group"` named by the label                                                                                                                                                                     |
| `ui/disclosure`                                               | `summaryClassName` for intentional native `<details>`; draws one CSS chevron keyed by `details[open]` (no client state)                                                                                                                                                                                                                                                 |
| `ui/ConfirmDialog` (client)                                   | Title, description, review `children`, `error`, cancel and confirm labels, `pendingLabel`, `tone`, `pending`, `confirmDisabled`, `onConfirm`. Cannot be dismissed while pending; the caller runs the write and closes on success                                                                                                                                        |
| `system/DataGate`                                             | `OutcomeGate<O extends { ok: true } \| { ok: false; requestId }>` renders loading and refusal (with request ID); `DataGate` keeps the `TenantOutcome` contract on top of it                                                                                                                                                                                             |
| `system/useNavigationGuard`                                   | Moved from `features/storageLayouts/useWorkspaceNavigationGuard`. Exports `useNavigationGuard` and `isNavigationHistoryGuardActive`. Copy is `App.navigationGuard.*`, titled per decision (`title`, `titleNoSave`, `titlePending`); the save action uses Button pending                                                                                                 |
| `providers/draftGuard`, `DraftGuardProvider`                  | Unchanged registration seam, now used by HR, Finished Goods and job scan                                                                                                                                                                                                                                                                                                |
| `system/CursorPagination`, `ui/StatusReason`                  | Copy comes from `Pagination.*` and `App.closeExplanation`; the `locale` prop was removed                                                                                                                                                                                                                                                                                |
| `PageContainer`, `PageHeader`                                 | 24px between task groups; h1 is 24/32 at every width, balanced                                                                                                                                                                                                                                                                                                          |
| `lib/format/measure`, `hooks/useMeasureFormat`                | `formatLength`, `formatDimensions`, `formatArea`, `formatNumber`. SI symbols in both languages, route-locale digits, at most 3 decimals for lengths and 2 for areas. Stored units are unchanged                                                                                                                                                                         |

Hook-free modules (`SectionHeader`, `DescriptionList`, `Panel`, `FormField`, `EmptyState`, `StatusBadge`, `Notice`, `disclosure`, `buttonVariants`) have no `"use client"`. Interactive modules declare it themselves. There is no client barrel, and no module exposes compound static members.

## Migrated consumers

- **HR (`src/features/hr`).**
  - **Selects and headings.** EmployeeForm's four selects (and five other HR selects) use `FormSelect`; `SelectField` is deleted. `SectionTitle` (7 files) and inline h2s use `SectionHeader`; `HrSectionHeader` and `SettingsHeading` are deleted.
  - **Surfaces.** HR card copies use `Panel`/`panelClassName`. HrStatStrip and HrTimeCell are flattened: rule-separated, with recorded times in large mono figures.
  - **Disclosure, transport and status.** `HrDisclosure` is replaced by `CollapsibleSection appearance="plain" keepMounted` (Review, Settings, PeriodDetail). `HrQueryState` is replaced by `OutcomeGate` (12 uses). `HrStateChip` is replaced by `StatusBadge size="large"`. `Facts` and inline fact lists use `DescriptionList`.
  - **Controls and tables.** The Review tabs use `SegmentedControl` with counts. Submits use Button pending; `useHrWrite` and `WriteFeedback` are untouched. Form layout uses FieldGroup, FieldMessage and CheckboxField. The Periods list is a `DataTable`.
  - **Copy.** "Schedule"/"กำหนดการ" and the online-clocking policy sentence. The sentence was checked against `convex/hr/self.ts`: server time, assigned site, no presence check.
- **Finished Goods (`src/features/finishedGoods`, excluding job scan).**
  - **Surfaces and headings.** The `panel` constant (33 uses) and inline copies are replaced by Panel/panelClassName, flattened to one surface per task. All raw h2s use `SectionHeader`.
  - **Actions and controls.** Pending buttons. DestinationPicker uses `SearchField`. The catalogue view and layout switches use `SegmentedControl`. Empty states use compact `EmptyState`. Stack, placement, pallet, move and batch summaries use `DescriptionList`.
  - **Catalogue totals.** A stat strip labelled "Warehouse totals" (Products, To measure, To store, In storage) shows "Unavailable" when the summary projection is missing.
  - **Confirmations.** Legacy-unit cancellation, product discard and reservation release use `ConfirmDialog`.
  - **Unsaved work.**
    - ProductScreen and pallet measurement are dirty only when the local draft could not be stored, because typed edits persist on the device.
    - BatchManager's in-memory corrections are dirty; Discard remounts the editor.
    - In-flight writes are registered as pending.
  - **Measurements and fields.** `mmText` and inline `/1000` maths are replaced by `useMeasureFormat`. Form layout uses FieldGroup and CheckboxField. Native summaries use `summaryClassName`. PackingScreen's summary table uses `TableScroller` and `ui/table`. Barcode camera and crop controls use the shared density.
  - **Copy.** Short "Add" action (accessible name "Add finished good"), search placeholder "Search by code or name" (accessible name unchanged), and the no-match text.
- **Job scan (`src/features/finishedGoods/jobScan`).**
  - **Ticket surface.** The ticket, capture toolbar, advisory and duplicate review share one Panel. AddLocationForm and LocationImageReader are divided sections.
  - **Fields.**
    - Ticket fields use FormField, FieldGroup and FormSelect. AI origin is a small label beside the field and clears on edit.
    - The optional fields sit in a plain `CollapsibleSection` ("Optional details" with a count). It opens itself when an optional quantity is invalid.
    - "Leaving factory" and "At customer" share a "Sheets per pallet" label, because both are จ.น.แผ่น/พาเลท in `convex/model/finishedGoods/jobScans.ts`. Each input keeps a full accessible name.
    - Field errors use FieldMessage with ARIA links.
  - **Actions and records.** Save shows "Save" and is announced as "Save N tickets". Records use SearchField, SegmentedControl (keeping the existing reset on re-click) and `ConfirmDialog` for delete (same request ID). LocationPicker uses SearchField. Empty states use compact EmptyState.
  - **Unsaved work.** Tickets are registered with `useDraftGuard`; Discard clears only the unsent tickets, and a pending save blocks discarding.
  - **Copy.** "Job tickets" / "One per pallet." and the extraction advisory.
- **Storage (`src/features/storageLayouts`, `src/components/storageLayouts`).**
  - **Tables.** FloorLocationTable, BuildingAreaDetails (`maxHeight="md"`, sticky head) and the location catalogue (`DataTable`) use TableScroller.
  - **Controls.** Three searches use SearchField; three view switches use SegmentedControl (URL and guard transitions kept). Pending buttons.
  - **Summaries and surfaces.** `Metric` is replaced by `DescriptionList` and deleted. Surfaces use Panel, headings use SectionHeader, and the building workspace uses `PageHeader`. The planner chrome is flattened.
  - **Forms and disclosure.**
    - Zone dialogs use FormField and FieldGroup.
    - The floor-dimension disclosure is fixed: it was announced as expanded but could not collapse. It is now `keepMounted` so constraints still apply, and the form is `noValidate`; `saveDraft` checks validity and reopens the section first.
    - Native summaries use `summaryClassName`.
  - **Toolbar and units.** The canvas toolbar, location list and floor-map CSS modules use the 48/36 density and 16/14px input text through `@reference` globals.css and `@variant dense`, so the breakpoint is defined once. All area and length display uses the shared formatter; Thai "ตร.ม." becomes "m²". Copy moved to StorageLayouts keys (88 key paths across two patches, including deletions of unused keys).
- **Common consumers.**
  - **Coordinator.** SetupChecklist summaries, AccountButton trigger, sidebar brand row and LedgerPanelStatus surface.
  - **Codex.** SearchDialog input, sidebar menu button density, Clerk appearance helpers (IdentityProvider), PublicInfoNav, sign-in and not-found links, ScanCodeInput, AnimatedToggle hit area and PhotoCapture's remove button.

## Deleted code

- **Files.**
  - `src/features/storageLayouts/useWorkspaceNavigationGuard.tsx` and its test (moved to `components/system`);
  - `src/hooks/useUnsavedWarning.ts`;
  - `src/components/reui/alert.tsx` and `badge.tsx` (unused duplicates of Notice and StatusBadge).
- **Symbols.**
  - HR: `SelectField`, `SectionTitle`, `HrSectionHeader`, `HrQueryState`, `Facts`, `HrDisclosure`, `HrStateChip`, `SettingsHeading`, and the unused HR tone maps;
  - Finished Goods: the `panel` constant, the `Panel` re-export and `mmText` from `finishedGoods/shared.tsx`;
  - Storage: `Metric`, plus the job scan `LocationSummary` export.

## Drift prevention (`eslint.config.mjs`)

These rules are additive to the existing native-select ban. Tests and `_prototype/` are exempt.

- **Control density.** `min-h-11`, `size-11` and `md:min-h-7/8/9` in class strings fail with "use the shared control density".
- **Surfaces.** The surface class combination `rounded-(lg|xl) border border-border bg-surface p-3…6` fails with "use Panel/panelClassName". Popovers (`p-2 shadow-lg`) are deliberately not matched.
- **Number formatting.** `toLocaleString()`, `toLocaleString(undefined, …)` and `new Intl.NumberFormat()` and `new Intl.NumberFormat(undefined, …)` fail with "use the route locale".
- **Headings.** Raw `<h2>` fails in `src/features/**` and `src/components/storageLayouts/**`. Allowed exceptions: the FloorMap inspector labels and the non-route reference previews (`Fg1SourcePlan`, `F1F2ReferencePreview`).
- **Empty state primitive.** Importing `ui/empty` anywhere except `EmptyState` fails.
- **Shared-layer boundary.** `src/components/{ui,system,table,providers}` may not import `@/features/**`. The old provider → storage-feature import is gone.

Every rule was confirmed to fire using a temporary probe file, deleted afterwards. Review rule: a routine `className` override of control height, focus, typography or semantic colour means a missing shared variant. Add a named variant to the owning module rather than overriding it locally.

## Intentional exceptions

- **HR.** The ReviewDetail comparison table stays bespoke. The PeriodDetail per-employee totals stay on TableScroller with `ui/table` (DataTable has no footer slot). Today keeps the clock action ahead of the schedule strip, as an existing test encodes. The Today page title stays "My day" (navigation namespace). The uncertain-save hint keeps "retrying is safe" rather than the sheet's shorter failure sentence.
- **Finished Goods.** `PalletScreens`/`PalletScene` still use `tr()` bilingual literals, apart from touched labels. PackingScreen and MoveScreen in-flight writes are not registered as pending guards (baseline behaviour). The PalletScene SVG drag handle keeps its own focus outline.
- **Job scan.** The per-ticket meta row and remove action stay, because they are needed with several tickets. The duplicate-review and records select-all checkboxes keep their row-specific layout.
- **Storage.** The canvas toolbar search remains a CSS-module box: it sizes by container width, but now uses the shared sizes and returns focus on clear. Input labels keep "(m)"/"(ม.)" because they name the unit the user types. The SVG canvas shapes, popover menus and FloorMap inspector headings keep their own treatment. The storage-spot list is now a single divided column.
- **Scene and shell chrome.** `storageScene/SceneToolbar` inherits shared Button sizing, including its overlay popover. Shell layout rows of `min-h-12` are layout, not controls.

## Behaviour changes to review

- **Re-clicking a selected option.** A selected SegmentedControl option no longer calls `onValueChange`. Where a re-click had an effect (job-scan record reset, HR review recovery, storage `editZone` clearing), it is kept through `onOptionActivate`.
- **Unload warning.** Finished Goods forms whose typed edits persist on the device no longer warn on unload. They warn only when the local write failed or a save is in flight. In exchange, in-app links, search and Back are now guarded by the shell prompt, which they were not before.
- **Copy and units.** The visible product-catalogue "Add" text is shorter (the accessible name is unchanged). DataTable gains `captionHidden`; the HR periods table keeps its caption as an accessible name only. Dimension text now reads "1.2 × 1 × 1.4 m". Areas show at most 2 decimals. Thai areas use "m²" instead of "ตร.ม.".
- **Sizes.** Controls previously 44px on touch (`min-h-11`, `size-11`, select compact) are now 48px. Some 28–32px desktop controls are now 36px.

## Initial isolated-tree checks (historical)

These checks predate final root integration. The merged application passes pnpm check (2,876 tests) and the default Turbopack build; see the final Codex audit.

| Command                                                                                    | Result                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the 143 changed or added source, test, config, message and doc files | Pass                                                                                                                                                                                                                                                                                                                                         |
| `pnpm format:check`                                                                        | Fails only on the same 12 pre-existing documentation files as the baseline (`docs/manuals/hr-user-guide-th/*`, `docs/reviews/assets/github-deployment-cleanup-2026-10-10/*`, three HR review docs). None was touched                                                                                                                         |
| `pnpm typecheck`                                                                           | Pass                                                                                                                                                                                                                                                                                                                                         |
| `pnpm lint` (`--max-warnings=0`)                                                           | Pass, with the new drift rules                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                                                                | 2,732 passed, 5 failed (235 files; baseline 2,670 passed, 10 failed). The 5 failures are pre-existing and deterministic, caused by the in-progress HR backend and route work: `permissions.integration` ×2, `public-api-registered-coverage`, `public-function-contract`, and `observability/event` (the `hr` route segment). No new failure |
| `pnpm check`                                                                               | Exit 1 at `format:check`, because of the same 12 pre-existing documentation files                                                                                                                                                                                                                                                            |
| `pnpm build` (Turbopack)                                                                   | Cannot run here: `node_modules` is a symlink to `/Users/macbook/Development/industrial-sas/node_modules`, outside the worktree root ("Symlink [project]/node_modules is invalid, it points out of the filesystem root"). This is an environment limit, not a code error                                                                      |
| `pnpm exec next build --webpack`                                                           | Pass: compiled, 45/45 static pages, every route listed                                                                                                                                                                                                                                                                                       |

New interaction tests:

- **Shared controls** (`ui/sharedControls.test.tsx`): pending lock and label; pending slotted link blocked for mouse and Enter; SearchField clear and focus return, Enter suppression and `onEnter`; SegmentedControl pressed state and change; `CollapsibleSection` draft kept with `keepMounted` and hidden from the Tab order, default unmount, controlled deep-link open; distinct facts with duplicate labels and the section name; ConfirmDialog not dismissible while pending, with the error kept.
- **Message coverage** (`i18n/sharedCopyCoverage.test.tsx`): renders the shared copy (guard prompt, StatusReason, TableScroller, LedgerPanelStatus, CursorPagination) with exactly each route scope's selected namespaces, in English and Thai, and fails on any missing message.
- **Codex's Button tests** (`ui/buttonActivation.test.tsx`).
- **Feature tests**:
  - EmployeeForm: select labels, errors, disabled linked member, payload and pending lock;
  - PeriodsScreen table;
  - FG and job-scan guard registration inside DraftGuardProvider, with pending blocking Discard;
  - TicketCard editing regressions;
  - PackingScreen summary scroll region;
  - storage zone fields with an unknown condition.
- **Updated test.** `tests/e2e/workspace/barcode.spec.ts` now expects the "Job tickets" heading. It was not run (no browser automation in this task).

## UI audit improvement batch (2026-10-11)

Applied after the image audit; per-item statuses, exceptions and checks are in the [UI audit](component-reuse-kiro-ui-audit-2026-10-10.md#improvement-batch-applied-2026-10-11). Final adoption state:

- **Shell.** `SidebarProvider` closes the mobile drawer when leaving the mobile layout (G-1, no new guard API). Guard prompts are titled by decision, and the pending state no longer says "not sent" (G-2, two new `App.navigationGuard` keys via the locked merger). The drawer's task context wraps. The search header aligns with its close button. The Clerk user-button trigger derives from `buttonVariants` ghost/icon.
- **Shared primitives.** PageHeader h1 is 24/32. Neutral status uses `Minus`, and a neutral Notice uses `Info`. `summaryClassName` draws its own open/closed chevron. New `focus-field-within` utility and `DataTable captionHidden`.
- **Features.** Ticket required fields show `aria-invalid` only after being left empty (presentation only). HR codes are mono. Periods caption is sr-only. The storage CSS modules use the canonical `dense` variant and shared focus utilities. StorageZoneDraftPreview display text uses `format.length` (mm). AreaColorPicker uses FormField/FieldGroup. The 2D/3D toggle has a minimum width. The FloorMap scale bar no longer collides with the width label.
- **No change, from source evidence.** The ProductScreen reference fields and PalletScreens QR are inside collapsed native disclosures; the restored indicator is the fix. The sign-in widget was not captured because the session is authenticated.
- **Checks.** Focused tests over `src/components`, `src/features/{hr,storageLayouts,finishedGoods}` and `src/i18n` (113 files, 1,052 tests), `prettier --check` on changed files, `pnpm typecheck` and `pnpm lint`: all pass.

## Remaining risks and next steps

- **Not verified in a browser.**
  - Layout and contrast: 390px, tablet and desktop layouts, both themes, long Thai strings, the flattened HR, catalogue, scan and planner composition, and the large success-coloured time figures.
  - The `dense:` pointer condition on real devices.
  - Behaviour: the shell guard with real Next navigation (links, global search, Back), the TableScroller sticky header, and the native-summary chevron (replaces the marker that `flex` suppresses).
  - Physical camera, OCR and photo flows still need a device check.
- **Design-sheet parity still to measure on captures.** Control heights, 2px and 8px gaps, 16px and 24px rhythm, focus edges and status contrast (the sheet's stronger status foregrounds were not adopted; the existing contrast test still passes).
- **Turbopack build.** Run `pnpm build` in a checkout with a real `node_modules`.
- **Concurrent work.** Codex modified shared modules during this session; its changes were integrated and pass the checks above. A Kiro UI image audit draft (`docs/reviews/component-reuse-kiro-ui-audit-2026-10-10.md`) appeared during the session from a parallel run. It is not part of this implementation and was not edited.
- **Follow-ups.** Migrate the remaining `tr()` literals (PalletScreens, PalletScene, StorageLocationCatalogue in places), register pending guards for PackingScreen and MoveScreen writes, and convert unit-embedding input labels if the product wants unit-free labels.

## Final delivery

All five phases, the Kiro per-UI audit and improvement batch, Codex fixes and exact-byte integration are complete. `pnpm check` and the default Turbopack build pass. [Final audit and checks](component-reuse-codex-audit-2026-10-10.md) · [91 production screenshots](../../output/component-reuse-ux-2026-10-10/final/index.html). Earlier checks retain their original stage context.
