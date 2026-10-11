# Component reuse and UX consistency: research (2026-10-10)

Read-only research for a refactor plan. Goal: a shared UX rule (heading style, card surface, search behaviour, pending label, unsaved-change prompt, copy) is changed in one module and applies everywhere it is meant to.

## Method and evidence rules

- Source: working tree at `b232565` plus existing uncommitted work, which was not modified. Several relevant files are dirty (`src/app/globals.css`, `eslint.config.mjs`, `src/i18n/clientMessages.ts`, `src/components/examples/c-sidebar-2.tsx`, `src/components/providers/AppProviders.tsx`, `src/features/storageLayouts/useWorkspaceNavigationGuard.tsx`). Line numbers refer to the working tree.
- Evidence came from `grep -n`, `sed -n`, and from reading files directly. Four parallel read-only sub-surveys (HR, finished goods, storage, shell/system) were cross-checked. Where a sub-survey disagreed with direct reads, the direct reads win; for example, `ui/breadcrumb` is used by `PageBreadcrumbs`.
- Production consumer counts leave out `*.test.tsx`, `_prototype/`, the `/master-data/storage-layouts/demo` route (`FloorMapDemo`), and the FG1/F1F2 reference previews. One exception: `src/components/examples/c-sidebar-2.tsx` is the real production shell. `DesktopShell.tsx:4` re-exports it, so it is counted.
- "≥3" means at least three distinct production files with the same intent. Two-consumer opportunities are labelled **2-consumer**.
- **Source finding** means it was read in code. **Unverified runtime** means it was inferred from code and not observed in a browser. No server, build or test was run.
- Next.js 16.3.8 guides read: `node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md` and `01-app/03-api-reference/01-directives/use-client.md`.

## Summary

1. The shared layer is real and widely adopted. Approximate importing files (import-path grep, which includes imports between shared modules): `button` ~56, `Notice` 27, `PageHeader` 19, `SelectControl` ~19, `FormField` ~12, `QueryGate` 9. It already has one enforced guardrail, the native-select ban in `eslint.config.mjs:51-94`. The plan should extend these modules, not add a parallel `components/shared` tree. That directory does not exist; the shared code is `src/components/ui` and `src/components/system`.
2. The main reason a one-place change does not propagate is local copies of the same rule:
   - section headings: about 45 raw `<h2>`, 9+ class variants, and two HR heading components;
   - card surfaces: the FG `panel` string, plus `rounded-xl` HR cards that `Panel` does not cover;
   - search fields: 4 hand-rolled, with diverging clear and focus behaviour;
   - view switches: 6, with different selected variants;
   - key/value lists: HR `Facts`, storage `Metric`, and inline lists in FG.
3. Some shared primitives hard-code bilingual copy: `StatusReason.tsx:95`, `CursorPagination.tsx:36-57`, and the unsaved-changes prompt (`useWorkspaceNavigationGuard.tsx:238-260`). Changing that copy in `messages/*.json` currently has no effect.
4. "Leaving with unsaved changes" follows three different rules:
   - HR uses the shell `DraftGuardProvider`;
   - storage calls `useWorkspaceNavigationGuard` directly;
   - finished goods uses only `beforeunload` (`useUnsavedWarning`).
5. Some duplicates are pure overlap and can be absorbed without visible change: `HrQueryState` is the same as `DataGate`, and `HrSectionHeader`, `reui/alert` and `reui/badge` are dead code.
6. Other duplicates are domain logic and should stay where they are: status-to-tone maps, write-error vocabularies, permission gates (`HrGate` vs `useCanManage`), HR time formatting, pickers, and the floor-map toolbars.

## Existing guidance and building blocks to extend

Guidance already in force:

- `docs/plans/design-system.md:24-32` sets the hierarchy rules: h1 24/32, h2 18/28 semibold, 48px touch controls, consistent toolbar, search and pagination.
- `design-system.md:37` says to extend `PageHeader`, `PageBackLink`, `CollapsibleSection`, `EmptyState` and `TableScroller` rather than build parallel components.
- `design-system.md:262-268` covers shared UI patterns: small composable APIs, business rules stay with callers, and no extra general state wrapper.
- `docs/plans/codebase-consolidation.md:17` asks to migrate the remaining duplicated markup where semantics match, keep inline inspection separate from modals, and move page-local bilingual labels into catalogues.

The design sheet (`docs/design-sheet/DESIGN.md:195`, `:261`) proposes flatter surfaces, a statistic strip and 36px desktop density. It says explicitly that it is not app authority. It is still the clearest example of a change that should land in one place, and today it cannot.

| Existing module                                            | Production consumers                                                             | Extend for                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `components/ui/Panel.tsx:4-24`                             | 12 files + FG `panel` string (`finishedGoods/shared.tsx:33`, 33 uses in 8 files) | padding variants, wider `as` union, exported class helper                                    |
| `components/ui/PageHeader.tsx:18-73`                       | 19                                                                               | optional meta line, for the building workspace bypass                                        |
| `components/ui/EmptyState.tsx:11-50`                       | 7                                                                                | compact size for inline "no results"                                                         |
| `components/ui/CollapsibleSection.tsx:6-72`                | 2                                                                                | opt-in keep-mounted and plain appearance, to absorb `HrDisclosure`                           |
| `components/ui/TableScroller.tsx:6-35`                     | 5                                                                                | optional hint and max height                                                                 |
| `components/ui/IconButton.tsx:23-62`                       | 11                                                                               | template for a `pending` prop on `Button`                                                    |
| `components/ui/FormField.tsx:6-73`                         | 12                                                                               | export its error/hint paragraph for standalone messages                                      |
| `components/ui/StatusBadge.tsx:26-55`                      | 12                                                                               | `size` variant, to absorb `HrStateChip`                                                      |
| `components/system/CollectionToolbar.tsx:9-60`             | 2                                                                                | extract `SearchField`                                                                        |
| `components/system/DataGate.tsx:14-32`                     | 1                                                                                | becomes the implementation behind `HrQueryState` (10)                                        |
| `components/system/LedgerPanelStatus.tsx:14-119`           | 7                                                                                | single loading/denied/error presentation (already used by `QueryGate`, `DataGate`, `HrGate`) |
| `hr/HrShared.tsx:293-322` `Facts`                          | 3 (HR)                                                                           | promote to `components/ui` as a description list                                             |
| `components/providers/draftGuard.ts:33-58` `useDraftGuard` | 6 (HR)                                                                           | the app-wide unsaved-change registration                                                     |

## Prioritized duplication clusters

### P1-A. Section headings (≥3, all three features)

Evidence (source finding):

- HR has `SectionTitle` (`HrShared.tsx:324-337`, `h2 text-lg leading-7 font-semibold text-text` plus `mb-3`) with 7 consumers: ReviewDetail, TodayScreen, EmployeeForm, CorrectionForm, PeriodDetailScreen, PeriodsScreen, DayDetailView.
- HR also has `HrSectionHeader` (`HrUi.tsx:212-236`) with **0 consumers**.
- Inline HR h2 elements bypass both components: `TodayScreen.tsx:155-157` and `PeriodDetailScreen.tsx:289-291` add `sm:text-xl`; also `ProfileScreen.tsx:67`, `:122-124`, `SettingsScreen.tsx:103` and `DayDetailView.tsx:83-85`.
- Finished goods has 27 raw h2. Most use `text-lg leading-7 font-semibold` with differing margins: `PalletScreens.tsx:421,461,744,1084,1126,1195,1387,1467`, `MoveScreen.tsx:203,540`, `PackingScreen.tsx:1006,1129`, `PlacementEditor.tsx:337,375`, `FinishedGoodsCatalogue.tsx:314,377,422`, `StackScreen.tsx:234,329`, `DestinationPicker.tsx:66`, `ProductBatches.tsx:360`.
- Some FG headings drift further: `text-base leading-6` at `ProductScreen.tsx:335,363,404`, and `text-lg font-semibold` without leading at `JobScanScreen.tsx:357` and `JobScanRecords.tsx:245`.
- Storage headings drift too: `StorageLayoutScreens.tsx:238` (`text-base`), `:1693` (`mt-1 text-lg`), `:2643` and `StorageZonesPanel.tsx:1117` (plain `font-semibold`).
- `FloorMap.tsx:869,892` use `text-xs text-muted` inspector labels. That is a different intent; leave them alone.

Proposal: add `components/ui/SectionHeading.tsx`, hook-free and without `"use client"`.

- Props: `title: ReactNode`, optional `id` (for `aria-labelledby`), `description`, `action` (a right-aligned slot that wraps on narrow screens), `icon` (decorative), and `level?: 2 | 3` (default 2).
- It owns the typography from `design-system.md:25`. It does not apply outer margin; the parent's `space-y-*` controls spacing.
- Keep `SectionTitle` as a re-export during migration. Delete `HrSectionHeader`.
- Leave the public legal pages (`app/[locale]/(public)/*/page.tsx`, 17 bare h2) as prose.

### P1-B. Card surface (≥3)

Evidence (source finding):

- `Panel` uses `rounded-lg … p-4` (`Panel.tsx:16`).
- FG duplicates it as a string, `panel` (`finishedGoods/shared.tsx:33`), used 33 times. Inline copies with `p-3` bypass both: `PalletScreens.tsx:527,1289` and `DestinationScanner.tsx:78`.
- HR cards use `rounded-xl`, so a radius change in `Panel` would not reach them: `EmployeeForm.tsx:225`, `CorrectionForm.tsx:164`, `PeriodsScreen.tsx:237`, `EmployeesScreen.tsx:191`, `HistoryScreen.tsx:242`, `HrUi.tsx:48`.
- Storage writes the classes inline on elements that `Panel`'s `as` cannot express: `StorageLayoutScreens.tsx:398` (form, `sm:p-6`), `:832` and `:1852` (figure), `:1683` (aside, `rounded-xl`), `:2641` (section); also `StorageZonesPanel.tsx:1108`.

Proposal:

- Widen `Panel`'s `as` to include `aside`, `figure` and `ul`.
- Add `padding?: "default" | "compact" | "none"`.
- Export a `panelClassName(options)` helper from the same file, so `finishedGoods/shared.tsx:33` can become an alias, then be removed.
- Radius (lg vs xl) is a design decision; record it once, then migrate the HR cards.

### P1-C. Shared primitives with hard-coded copy (≥3 app-wide consumers each)

Evidence (source finding):

- `StatusReason.tsx:95` hard-codes "ปิดคำอธิบาย / Close explanation". It has 4 consumers; `App.close` already exists.
- `CursorPagination.tsx:36-57` hard-codes Thai/English labels and is used on 5 screens. The `Pagination` namespace already has `pagination`, `previousPage` and `nextPage`.
- `useWorkspaceNavigationGuard.tsx:238-260` hard-codes the whole prompt. It renders for every HR form through the shell `DraftGuardProvider` (`c-sidebar-2.tsx:76-124`, `DraftGuardProvider.tsx:58-69`).

Proposal: move this copy into catalogues first, because these modules are app-wide. Namespace availability is a constraint; see the i18n risk section.

### P1-D. Loading/denied gate duplicate (≥3)

`HrQueryState` (`HrShared.tsx:91-110`, 10 consumers) and `DataGate` (`DataGate.tsx:14-32`, 1 consumer) are the same: undefined → LOADING, not ok → DENIED with the request id, otherwise render children. Only the children signature differs.

Proposal: implement `HrQueryState` as a thin adapter over `DataGate`. Nothing changes visually, and the gate logic then lives in one place.

### P2-A. Search field (≥3)

Evidence (source finding): four hand-rolled search inputs, plus `CollectionToolbar` (2 consumers: `FinishedGoodsCatalogue.tsx:250`, `FloorLocationTable.tsx:214`).

| Site                               | Clear button                    | Focus after clear                | Enter prevented | Notes                                                                          |
| ---------------------------------- | ------------------------------- | -------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `CollectionToolbar.tsx:30-56`      | IconButton, inset               | not handled; the button unmounts | yes             | design-system.md records the inset fix                                         |
| `StorageZonesPanel.tsx:1156-1185`  | Button `size-11` (44px)         | returns to the input (`:1184`)   | yes             |                                                                                |
| `DestinationPicker.tsx:76-104`     | Button using `-translate-y-1/2` | not handled                      | no              | the transform pattern that `design-system.md` reports was fixed in the toolbar |
| `StorageLayoutScreens.tsx:324-333` | none                            | n/a                              | no              | `<label>` wrapper                                                              |
| `JobScanRecords.tsx:217-233`       | none                            | n/a                              | no              | `size-5` icon, `pl-12`                                                         |
| `FloorWorkspaceToolbar.tsx:66-80`  | own                             | not checked                      | yes             | raw `<input>`, CSS module; defer                                               |

Proposal: extract `SearchField` from `CollectionToolbar` and have `CollectionToolbar` compose it.

- Props: `value`, `onValueChange(value)`, `label`, `clearLabel`, optional `placeholder`, `type`, `disabled`, `id`.
- It owns: the decorative icon, Enter suppression, the 48px inset clear button, and returning focus to the input after clear.
- Debouncing stays with callers (`useDebouncedSearch`).
- Unverified runtime: focus loss after clearing in `CollectionToolbar` and `DestinationPicker` is expected from DOM semantics (the focused button unmounts) but was not observed in a browser.

### P2-B. Single-choice view or filter switch (≥3)

Evidence (source finding), all `role="group"` with `aria-pressed` buttons:

- `StorageLocationCatalogue.tsx:229-254` (icon, `secondary`, bordered container);
- `StorageLayoutScreens.tsx:1027-1056` (icon, `size="sm"` with `min-h-11`, which is 44px against the 48px rule);
- `FinishedGoodsCatalogue.tsx:232-249` (text, `secondary`) and `:261-285` (IconButton);
- `FloorLocationTable.tsx:249-270`;
- `ReviewScreen.tsx:196-221` (`active` variant plus a count chip);
- `JobScanRecords.tsx:188-214` (raw `<button>` underline tabs).

The selected-state variant (`secondary` vs `active`) and the container style differ by screen.

Proposal: add `components/ui/SegmentedControl.tsx` as a client component.

- Generic `T extends string`. Props: `label` (group name), `value: T`, `onValueChange(value: T)`, `options: readonly { value: T; label: string; icon?: LucideIcon; count?: number }[]`, optional `iconOnly` and `disabled`.
- Keep the `aria-pressed` semantics the current tests rely on.
- Ship one appearance. Migrate the underline tabs in `JobScanRecords` only if design accepts the same look; don't add appearance switches to cover every variant.

### P2-C. Pending action label (≥3)

Evidence (source finding): `busy ? t(pendingKey) : t(idleKey)` with ad-hoc `disabled`, and no `aria-busy` anywhere:

- `StorageLayoutScreens.tsx:453-454` and `:3012-3018`;
- `BatchManager.tsx:794-798`;
- `PlacementEditor.tsx:492-497`;
- `JobScanScreen.tsx:533-538`;
- `JobScanRecords.tsx:396-402`;
- `PackingScreen.tsx:1424-1430`.

At `PackingScreen.tsx:1424-1430`, `disabled={!editable}` does not reference `op.busy`. Whether `editable` covers busy was not verified.

`IconButton.tsx:43-50` already owns `pending` (it adds `aria-busy` and `disabled`).

Proposal: add `pending?: boolean` and `pendingLabel?: ReactNode` to `Button` (`button.tsx:44-65`), hook-free. When pending, the button is disabled, sets `aria-busy`, and shows `pendingLabel` (or keeps its children). Callers keep their own text keys.

### P2-D. Key/value summaries (≥3)

Evidence (source finding):

- HR `Facts` (`HrShared.tsx:293-322`, 3 consumers; keyed by label, so duplicate labels collide).
- Storage `Metric` (`storageLayoutShared.tsx:81-94`, dt `text-xs text-muted`, dd semibold tabular), used at `StorageLayoutScreens.tsx:250-258` and `storageLayoutShared.tsx:50`.
- Inline lists with drifting dt styles: `StackScreen.tsx:283-291` (`text-muted`), `ProductBatches.tsx:538-541` (no dt style), `PlacementEditor.tsx:98-106`, `PalletScreens.tsx:1271`, `FloorLocationTable.tsx:466`, `BuildingAreaDetails.tsx:224`, `ReviewDetail.tsx:192`, `TodayScreen.tsx:242`, `HistoryScreen.tsx:255`, `EmployeesScreen.tsx:205`.

Proposal: promote `Facts` to `components/ui/DescriptionList.tsx`, hook-free.

- Props: `items: readonly { id?: string; label: ReactNode; value: ReactNode }[]`, `layout?: "rows" | "grid"` (rows matches `Facts`; grid matches the 2–3 column metric style), `columns?: 2 | 3`, `dense?`.
- Use named exports only.
- `HrStatStrip` (`HrUi.tsx:66-114`, **1 consumer**) stays HR-only until a second statistic strip ships.

### P2-E. Unsaved-change rule (≥3)

Evidence (source finding):

- HR forms (6) call `useDraftGuard` (`draftGuard.ts:33-53`). The shell-wide `DraftGuardProvider` turns that into the `useWorkspaceNavigationGuard` prompt, which intercepts links, Back/Forward and `guardedNavigate` (`lib/navigationGuard.ts:24-30`).
- Storage calls the hook directly (`StorageLayoutScreens.tsx`).
- Finished goods uses only `useUnsavedWarning`, a 12-line `beforeunload` hook (`hooks/useUnsavedWarning.ts:3-12`), at `PalletScreens.tsx:312`, `BatchManager.tsx:93`, `ProductScreen.tsx:247` and `JobScanScreen.tsx:139`. `BatchManager.tsx:214-239` has its own discard dialog.
- Unverified runtime: in FG, in-app sidebar or search navigation with a dirty draft probably shows no prompt.
- Layering: a provider imports a feature hook (`DraftGuardProvider.tsx:11` imports `@/features/storageLayouts/useWorkspaceNavigationGuard`), and the provider's comment says "every HR form".

Proposal:

1. Move the guard hook to `components/system` (or `lib`) and its copy into a shell namespace.
2. Migrate FG `useUnsavedWarning` callers to `useDraftGuard(dirty, discard, pending)`.
3. Keep `BatchManager`'s in-dialog discard only if the product wants a second, local prompt.

`useWorkspaceNavigationGuard.tsx` and `AppProviders.tsx` are dirty; coordinate with that work first.

### P2-F. Locale-aware measurements (≥3)

Evidence (source finding):

- The area unit is localized in only some places. `AreaOverview.tsx:39` and `BuildingAreaDetails.tsx:102` use "ตร.ม." in Thai. These always use "m²": `WorkspaceFloorSelector.tsx:70`, `StorageLayoutScreens.tsx:2956,2961`, `StorageZonesPanel.tsx:688,771`, `StorageLocationCatalogue.tsx:599`.
- Several sites format numbers with the browser locale instead of the app locale: `WorkspaceFloorSelector.tsx:70` and `StorageZonesPanel.tsx:687,770` (`toLocaleString()`), and `StorageZonesPanel.tsx:920`, `StorageLocationCatalogue.tsx:596`, `BuildingAreaDetails.tsx:239` (`undefined` locale).
- Length formatting is spread across `mmText` (`finishedGoods/shared.tsx:310`), `metres` (`lib/storageLayouts/storageKit.ts:7`) and inline `/1000` (`BatchManager.tsx:432`, `StackScreen.tsx:289-291`).
- next-intl `useFormatter` is used once (`JobScanRecordRow.tsx:34`).
- Unverified runtime: the output differs only when the browser locale differs from the route locale.

Proposal: add a client hook `useMeasureFormat()` returning `area(squareMillimetres)`, `length(millimetres)`, `count(n)` and `percent(ratio)`. It builds on `useFormatter` and catalogue unit labels. `hr/format.ts` keeps its time-zone business-date logic.

### P3. Smaller clusters

- **Empty states (≥3):** `FinishedGoodsCatalogue.tsx:312-335` (icon, h2, body and action, the `EmptyState` API without `role="status"`), `DestinationPicker.tsx:106-116`, `StorageZonesPanel.tsx:1200-1210`, `BatchManager.tsx:426-434`, `BuildingAreaDetails.tsx:280-282`. Add `size?: "default" | "compact"` to `EmptyState`. `StackScreen.tsx:306` is a choose-something placeholder; keep it.
- **Scrollable tables (≥3):** `StorageLocationCatalogue.tsx:378-383` and `FloorLocationTable.tsx:493-499` re-create TableScroller's region, `tabIndex` and overflow by hand. `BuildingAreaDetails.tsx:284` scrolls without a focusable region. Add `hint?: boolean` and `maxHeight` to `TableScroller` and use `ui/table`. `ReviewDetail.tsx:318` is a fixed comparison table and `PackingScreen.tsx:1346` is desktop-only inside a panel; review those separately.
- **Disclosure (≥3 combined):** `CollapsibleSection` (`StorageLayoutScreens.tsx:1630`, `TicketCard.tsx:169`) unmounts closed content (`CollapsibleSection.tsx:62`). `HrDisclosure` (`HrUi.tsx:243-309`; `ReviewDetail.tsx:154`, `SettingsScreen.tsx:460`, `PeriodDetailScreen.tsx:362,431,761`) keeps content mounted with `hidden`, which preserves drafts, and adds `role="group"` and `motion-reduce`. Extend `CollapsibleSection` with `keepMounted?: boolean` (default false, so storage behaviour does not change) and `appearance?: "card" | "plain"`. Separately, `StorageLayoutScreens.tsx:1633-1635` passes `open: true` without `onToggle`, so the header cannot collapse while overrides exist. This is a source finding; the runtime effect was not checked.
- **Standalone inline errors (≥3):** `EmployeeForm.tsx:403,552` and `PeriodsScreen.tsx:264` use `text-xs`. `CatalogueFilterControls.tsx:339`, `TicketFieldScanner.tsx:113`, `TicketCard.tsx:132`, `PhotoCapture.tsx:198` and `useWorkspaceNavigationGuard.tsx:325` use `text-sm`. `FormField.tsx:62-69` already has the canonical `text-xs leading-relaxed text-danger role=alert`. Export it as `FieldMessage`. Whether each error is linked via `aria-describedby` was not checked.
- **Status chip (2-consumer):** `HrStateChip` (`HrUi.tsx:155-177`; TodayScreen and PeriodDetailScreen) copies `StatusBadge` at a larger size with its own tone maps (`HrUi.tsx:13-31`) and a dot glyph instead of `StatusBadge`'s shape glyphs (`StatusBadge.tsx:16-24`). Add `size` to `StatusBadge` and migrate when HR is next touched.
- **Selectable list row (2-consumer):** `ReviewScreen.tsx:337-342` and `FloorLocationTable.tsx:366`. Watch for a third before extracting.
- **Page header bypass (1 consumer):** the building workspace (`StorageLayoutScreens.tsx:1002-1022`) builds its own breadcrumb, back button and `h1 text-xl`, so PageHeader changes don't reach it. Either add an optional `meta` slot and compact density to `PageHeader`, or record it as an intentional workspace header. `JobScanScreen.tsx:324` is a completion state; keep it.
- **Toolbar group (2-consumer):** `HrToolbar` (`HrUi.tsx:34-55`; ReviewScreen and HistoryScreen). Keep it in HR.

## Keep feature-specific

- **Domain status tones:** FG `STATUS_TONES` (`shared.tsx:35-44`), HR `STATUS_TONES`/`CORRECTION_TONES` (`HrShared.tsx:192-222`) and `placementStatusTone` (`storageKit/PlacementStatusBadge.tsx:7-19`). They map different vocabularies; only `BadgeTone` is shared.
- **Write execution:** `useHrWrite` (IDLE/PENDING/SAVED/REFUSED/DENIED/UNCERTAIN plus safe retry) and its `WriteFeedback` (`HrShared.tsx:125-190`, 7 consumers), vs `useAsyncOperation` (`hooks/useAsyncOperation.ts:27-90`) with feature error mappers (`useWriteError`, `storageErrorMessage`, `useHrError`). Consolidation plan item 6 defers merging these. Share presentation only after the execution states are aligned.
- **Permission gates:** `HrGate` (HR access provider, per-code permission, time zone and sites) vs `useCan`/`useCanManage` (`hooks/useCan.ts:4-7`, one warehouse permission, 14 files). The providers and models differ. A generic gate would hide which authority applies.
- **Other HR-only pieces:** `format.ts`, `PlanText`, `TimeText`, `Duration`, `HrTimeCell` (1 consumer) and `HrInitials` (`ui/avatar.tsx` has 0 consumers; don't revive it for this).
- **FG-only pieces:** `Steps`, `QR`, `palletDisplayStatus`, `PackingCompletion`, `ViewOnlyNotice` (4 FG consumers).
- **Pickers:** `DestinationPicker` (move/placement destinations) vs `jobScan/LocationPicker` (scan, camera, paging). These are different workflows; share only `SearchField` and `EmptyState`.
- **Floor canvas chrome:** `FloorWorkspaceToolbar`, `SceneToolbar`, `FloorMapCameraControls` and the CSS modules in the FloorMap cluster.

## Cleanup candidates (no production importers)

- `src/components/reui/alert.tsx` and `reui/badge.tsx` duplicate `Notice` and `StatusBadge`.
- `HrSectionHeader` (`HrUi.tsx:212-236`).
- `ui/avatar.tsx`, `ui/progress.tsx`, `ui/separator.tsx`.

Confirm test and shadcn-registry usage before deleting. Single-consumer modules worth reviewing rather than deleting: `DataTable` (StorageLayoutScreens), `FormSelect` (PackingScreen), `PageBackLink` (FG `Missing`), and `RouteLoading` (`(desktop)/loading.tsx`).

## Phased migration

Each phase is one or more small PRs. Run `pnpm check` (format:check, typecheck, lint, test) and `pnpm build` on each.

1. **Phase 0 — decisions, no code.** Record the design choices that a single module will then own:
   - card radius (lg or xl);
   - selected segmented variant (`secondary` or `active`);
   - section heading size (with or without `sm:text-xl`);
   - Thai area unit (ตร.ม. or m²);
   - whether FG should get the in-app unsaved prompt.

   Add the outcome to the "Shared UI patterns" section of the design-system guidance (owner's call; this report changes no docs).

2. **Phase 1 — no visible change, highest leverage.**
   - `HrQueryState` → `DataGate` adapter (pilot: `HrShared.tsx` itself, covering 10 screens at once). Guard with `HrScreens.test.tsx` and `HrSimplification.test.tsx`.
   - Move the copy from `StatusReason.tsx:95` and `CursorPagination.tsx:36-57` into the catalogues.
   - Delete the dead modules listed above.
3. **Phase 2 — new hook-free primitives, with three pilots across features.**
   - `SectionHeading`: re-export through `SectionTitle` (7 HR files), then `PalletScreens.tsx` (9 h2) and `StorageZonesPanel.tsx:1117`.
   - `Panel` padding and `as`, plus `panelClassName`: pilots `finishedGoods/shared.tsx:33`, `DestinationScanner.tsx:78`, `StorageLayoutScreens.tsx:2641`.
   - `Button` `pending`: pilots `BatchManager.tsx:794`, `PlacementEditor.tsx:492`, `StorageLayoutScreens.tsx:453`.
4. **Phase 3 — interactive primitives.**
   - `SearchField`: pilots `StorageZonesPanel.tsx:1156` (already the best behaviour), `DestinationPicker.tsx:76`, `StorageLayoutScreens.tsx:324`.
   - `SegmentedControl`: pilots `StorageLocationCatalogue.tsx:229`, `FinishedGoodsCatalogue.tsx:232`, `ReviewScreen.tsx:196`.
   - `CollapsibleSection` `keepMounted`: pilot `HrDisclosure`, then remove it.
5. **Phase 4 — structural and copy work, alongside the owning workflows.**
   - `DescriptionList`: `Facts`, `Metric`, `StackScreen.tsx:283`.
   - `EmptyState` compact: `FinishedGoodsCatalogue.tsx:312`, `DestinationPicker.tsx:106`, `StorageZonesPanel.tsx:1200`.
   - `TableScroller` options: `StorageLocationCatalogue.tsx:378`, `FloorLocationTable.tsx:493`, `BuildingAreaDetails.tsx:284`.
   - Unsaved-change unification (P2-E) and `useMeasureFormat` (P2-F).
   - Catalogue migration for the remaining bilingual literals: `PalletScreens.tsx` (86 `tr("…")` calls, 126 lines with Thai script), `StorageLocationCatalogue.tsx` (local `tr` at `:121-122` and `:538-539`), `BuildingAreaDetails.tsx`, `AreaOverview.tsx`, `FloorLocationTable.tsx:73`, `PalletScene.tsx:596-1153`, `ProductScreen.tsx:60`, `PackingScreen.tsx:838`.

## Risks

**Accessibility**

- Keep the existing semantics that tests and assistive technology rely on: `aria-pressed` groups, `role="status"` on `EmptyState` and `role="alert"` on danger notices, `aria-describedby` wiring in `FormField`, focus return when a sheet closes, and the 48px touch rule.
- Some current controls are 44px and would change size when centralized: `min-h-11` at `StorageLayoutScreens.tsx:1038,1050` and `size-11` at `StorageZonesPanel.tsx:1180`.
- `keepMounted` with `hidden` still submits hidden form fields. That is why it must stay opt-in.
- Lucide 1.31 applies `aria-hidden` automatically to icons without accessible props (`node_modules/lucide-react/dist/esm/Icon.mjs:36`). Icons missing an explicit `aria-hidden` are therefore not defects.

**i18n**

- Client messages are scoped per route, and nested providers replace rather than merge (`src/i18n/clientMessages.ts:1`, `:16-39`).
- The HR scope (`:38`) has no `Pagination`, `Write` or `WriteError`.
- A shared primitive should therefore read from a namespace present in every scope (`App` or `Panel`), or the change must add its namespace to every scope. Missing keys surface only at runtime.
- `clientMessages.ts` is dirty; coordinate.

**Permissions**

- Shared components must take capability as data (`disabled`, `readOnly`, `action` slots). They must not call `useCan`, `useCanManage` or `useHrAccess`.
- Server checks remain authoritative (`hooks/useCan.ts:3`).
- Don't merge `HrGate` with warehouse permissions.

**Server/client boundary (Next.js 16.3.8 docs)**

- App pages are thin Server Components that render client feature screens. The route wrappers call `setRequestLocale`; examples are `finished-goods/page.tsx` and `storage-layouts/demo/page.tsx`.
- Keep `SectionHeading`, `DescriptionList`, the `Panel` helper and the `Button` `pending` prop hook-free and without `"use client"`, so they stay usable in either graph. The directive is needed only on entries rendered directly from Server Components (`use-client.md:8-10`); `server-and-client-boundary.md:273` makes the same point.
- Interactive primitives (`SearchField`, `SegmentedControl`, `CollapsibleSection`) take callback props. Functions cannot cross from server to client (`server-and-client-boundary.md:157-166`, `use-client.md:50`). Only client screens should use them, which is true of every current consumer.
- Use named exports, not compound static members such as `List.Item`; static members break when a Server Component imports a client module (`server-and-client-boundary.md:263-269`).
- Don't add a `"use client"` barrel.

**Worktree**

- The real shell lives under `components/examples/`. Lint or test globs that exclude `examples` would skip production code.
- Dirty files in the guard, shell, providers, CSS and ESLint config overlap phases 1–4. Rebase onto that work rather than editing alongside it.

## Verification and drift guardrails

**Tests**

- Unit tests per new or extended primitive:
  - `SectionHeading`: level and id;
  - `SegmentedControl`: `aria-pressed` and keyboard;
  - `SearchField`: Enter suppression, clear, focus return;
  - `Button` `pending`: `aria-busy` and disabled;
  - `CollapsibleSection` `keepMounted`: draft retained;
  - `DescriptionList`: duplicate labels.
- Re-run the owning feature suites for each pilot: `StorageLayoutScreens`, `StorageLocationCatalogue`, `HrScreens`, `HrSimplification`, `ProductScreens`, `PalletScreens`, `MoveScreen`, `JobScanRecords`, `DestinationPicker`.
- Add an i18n test that renders each shared primitive using only `pickMessages(messages, ROUTE_NAMESPACES[scope])` for every scope. This catches missing namespaces.

**ESLint ratchets**

- Extend the existing `no-restricted-syntax` and `no-restricted-imports` blocks (`eslint.config.mjs:51-94`).
- Seed a per-file `ignores` allowlist with today's offenders. Remove a file from the list as it migrates, so `--max-warnings=0` keeps passing and new copies fail.
- Candidate selectors:
  - `JSXOpeningElement[name.name='h2']` in `src/features/**` and `src/components/storageLayouts/**`;
  - `JSXOpeningElement[name.name='table']` outside `ui/table.tsx`;
  - `Literal[value=/rounded-(lg|xl) border border-border bg-surface/]` and the matching `TemplateElement`;
  - `BinaryExpression[right.value='th']` outside `src/i18n/**` and `hr/format.ts`;
  - Thai-script `Literal` outside the i18n files, `app/global-error.tsx` (which has no provider) and dev previews;
  - `CallExpression[callee.property.name='toLocaleString'][arguments.length=0]`;
  - `no-restricted-imports` on `@/components/ui/empty` outside `EmptyState`, `hooks/useUnsavedWarning` once migrated, and `components/reui/*`.

**Browser**

- After each visual phase, re-run the matrix documented in `design-system.md`: Thai/English × light/dark × 390/768/1440px, overflow, a single h1, and axe on main content.
- Physical-device camera checks stay manual.

## Unverified runtime behaviour referenced above

- FG in-app navigation with a dirty draft shows no prompt.
- Focus is lost after clearing search in `CollectionToolbar` and `DestinationPicker`.
- The browser-locale number formatting differs visibly.
- The controlled `CollapsibleSection` at `StorageLayoutScreens.tsx:1633` cannot collapse.
- `PackingScreen.tsx:1424` can be clicked while busy.

Each should be confirmed with a focused test or browser check before it is treated as a defect.

## Coordinator review

The [curated implementation plan](../plans/component-reuse-and-ux-consistency-2026-10-10.md) incorporates this research with these constraints:

- `HrQueryState` and `DataGate` render equivalent transport states, but their declared outcome types differ. `TenantOutcome` requires successful request IDs and denial metadata. A migration must define a minimal presentation interface or a correctly typed adapter, without fake metadata or unsafe casts.
- Current production controls deliberately support compact desktop sizing and larger mobile targets. Reconcile older documentation before treating every size difference as a defect; this refactor does not adopt the design sheet's proposed dimensions automatically.
- Use focused lint rules after migrating consumers. Blanket bans on raw headings, tables, language checks or native inputs need explicit exceptions for prose, evidence comparisons, custom controls, primitive internals and fallback shells.
- New `pending` handling on a slotted Button must account for anchor behavior; HTML `disabled` alone does not disable a link.
- Prioritize the existing `FormSelect` adoption pilot, shared task surfaces and ordinary section headings. Additional abstractions and changes to unsaved-navigation behavior require their own bounded pilots and meaningful interaction verification.
