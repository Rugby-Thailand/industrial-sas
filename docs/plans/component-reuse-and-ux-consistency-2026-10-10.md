# Component reuse and UX consistency plan

Date: 2026-10-10. Status: phases 1–5 implemented in source on 2026-10-10 (Kiro implementation with Kiro crew, plus Codex audit fixes to the shared Button boundary and common consumers). Typecheck, lint, the production webpack build and every test except five pre-existing backend/route failures pass. The Turbopack `pnpm build` cannot run in the isolated worktree because `node_modules` is a symlink outside the project root. Browser parity (desktop/mobile captures, both themes, keyboard) is pending the T3 capture round and the follow-up Kiro UI audit. Delivery, shared interfaces, exceptions and check results: [implementation review](../reviews/component-reuse-implementation-2026-10-10.md).

Decisions taken during implementation: the density variant is `dense:` (viewport ≥ 48rem with a fine primary pointer); semantic tokens are `touch`/`control` sizes and `label`/`field`/`section`/`group` spacing; task surfaces use 12px radius; segmented selection uses the `active` variant; measurements use SI symbols (m, m²) in both languages with route-locale digits.

## Goal and definition

Make each recurring UI rule have one implementation, so changing it updates every screen that uses that rule. Consistency includes appearance, keyboard/focus behavior, labels and validation, responsive layout, and feedback for loading, empty, denied, failed, pending and saved states.

For example, changing the shared field label spacing should update employee forms, product forms and building forms through the same field implementation. Changing a status badge's presentation should update all domain badges, while each feature retains its own status meanings and translations.

Success means fewer independent implementations and fewer files to edit for a shared UX change. Moving files or reducing individual screen length is not sufficient evidence of reuse.

Scope: cover the existing application; adopt the approved original design sheet's visual direction while preserving workflow behavior; deliver incremental migrations; use existing React, Tailwind, Radix and testing infrastructure. No new component framework or global state store is required.

## Research basis and limits

This plan inspects the current working tree, including in-progress HR and shell work. It continues the remaining UI adoption work in [the codebase consolidation plan](codebase-consolidation.md), rather than repeating its already implemented storage/history/request modules.

The user explicitly approved adopting the [original design sheet](../design-sheet/index.html) during the follow-up to this plan. Its composition, control density, spacing, focus treatment and refined copy are now implementation requirements. Read its [source notes](../design-sheet/README.md), [styles](../design-sheet/styles.css) and [refined copy](../design-sheet/sheet.js) alongside production sources. The comparison variants are alternatives, not the selected target. The sheet's frozen palette must be reconciled with current production theme values rather than replacing them with an older snapshot. Synthetic records, preview-only feedback and disabled demo actions are not production requirements.

Kiro was commissioned for a read-only audit using Claude Opus 5.5 at high effort. Its separate evidence report is [component reuse research](../reviews/component-reuse-kiro-research-2026-10-10.md). Recommendations below must be grounded in production consumers, not unused examples, tests or prototypes. Determine production use through imports/routes: the live sidebar is currently in `src/components/examples/c-sidebar-2.tsx`, so its directory name is not grounds to exclude it.

These are source-code findings. This planning task does not establish that every route has been inspected in a running browser, and it does not claim a current accessibility or performance pass. Implementation requires the visual and interaction verification described below.

## Approved visual contract and Tailwind implementation

The application already uses Tailwind CSS **4.3.3** through `@tailwindcss/postcss`. `src/app/globals.css` imports Tailwind and exposes theme tokens through `@theme inline`; `--spacing-touch` already represents 48px. `src/lib/utils.ts` supplies `cn()` using `clsx` and `tailwind-merge`, and `Button` already uses `class-variance-authority` for typed variants. Continue using this infrastructure.

Tailwind supplies styling utilities. Shared tokens define the values, and shared UI modules define the combination of utilities and behavior for each pattern. Feature screens compose these modules. This is how one field-spacing or control-size change reaches the application without editing every screen's class list.

| Approved rule                                                       | Implementation owner                                                                                                      | Acceptance                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 36px desktop controls; 48px mobile/touch targets                    | Shared control-size tokens in `globals.css`; `Button`, `Input`, `SelectControl`, `IconButton` and their composed controls | Ordinary controls use the agreed desktop/mobile scale across forms, search, pagination and actions. Glyphs such as checkboxes can stay small inside accessible touch targets. Preserve input text sizing that avoids unwanted mobile browser zoom. |
| 2px between a field label and its input; 8px between related fields | Semantic spacing tokens, `FormField` and shared field-group composition                                                   | Employee, product, building and ticket forms follow the same field rhythm. Hint/error spacing is controlled separately rather than reducing every FormField gap to 2px.                                                                            |
| 16px task sections; 24px task groups                                | Shared section/group spacing tokens, `PageContainer`, `SectionHeader` and task composition                                | Related content is grouped through headings, spacing and occasional dividers; page-local margin overrides do not recreate competing scales.                                                                                                        |
| Flatter sections and one main surface per task                      | `Panel` appearance variants and shared page/task composition                                                              | Remove unnecessary nested card framing in scan, catalogue, HR and planner chrome. Keep distinct semantic states and interactive selections readable.                                                                                               |
| Clear type hierarchy and readable status labels                     | Shared headings, labels and `StatusBadge`                                                                                 | Preserve the sheet's 24/32 page heading and 18/28 section heading scale, Thai wrapping, and monospace identities. Status uses text plus a symbol or icon, with contrast checked against both current themes.                                       |
| 2px visible focus outline; close field focus treatment              | Shared focus tokens and control variants                                                                                  | Fields match the sheet's close focus edge (`outline-offset: -1px`); other controls retain visible separation. Verify clipping, contrast and keyboard visibility in composed controls.                                                              |
| Refined English/Thai copy with full accessible names                | Existing message catalogues and translated labels passed to shared controls                                               | Short visible actions keep their contextual meaning and accessible names. Job-ticket fields retain their real domain meaning and unit labels; demo-only messages do not enter the production app.                                                  |

Implement shared values in Tailwind v4's existing CSS theme, using complete static utility class names and the existing `cn()`/variant helpers. Use semantic names for recurring field spacing, control density and task spacing; do not introduce a separate Tailwind configuration file, copy the standalone sheet stylesheet into production, or build dynamic class-name strings that Tailwind cannot discover. Keep specialised scene/CSS-module behavior where needed.

The sheet switches to 48px controls at 800px; current application primitives commonly compact at Tailwind's `md` breakpoint. Choose and record one application-wide density breakpoint during the foundation phase, including touch-input behavior. Verify widths around the selected breakpoint, rather than letting each primitive choose independently.

Map the sheet's four workflow specimens to real consumers: job scan and ticket records, Finished Goods catalogue, floor planner with its inspector, and HR attendance/review. Preserve real pagination, camera/OCR, geometry, permissions, actual/planned time distinctions and server-backed feedback. The synthetic `draft` at `sheet.js:417` remains preview data; production values come from the existing draft/query modules.

## What already exists

| Concern              | Existing implementation to reuse                                                                            | Ownership                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Palette and theme    | `src/app/globals.css`, semantic `--token-*` variables                                                       | Global visual rules; preserve legacy `bg-accent`/`text-muted` meanings          |
| Controls             | `Button`, `Input`, `IconButton`, `CheckboxControl`, `SelectControl`                                         | Control sizes, borders, focus, disabled and invalid appearance                  |
| Forms                | `FormField`, `FormSelect`                                                                                   | Label association, required indication, hint/error presentation and ARIA wiring |
| Page composition     | `PageContainer`, `PageHeader`, `Panel`, `PageBackLink`, `PageBreadcrumbs`, `StickyActionBar`                | Width, headings, actions and responsive page structure                          |
| Lists                | `TableScroller`, table primitives, `DataTable`, `CollectionToolbar`, `PaginationFooter`, `CursorPagination` | Presentation and access; features own data, filters, sorting and cursor state   |
| Feedback             | `Notice`, `EmptyState`, `StatusBadge`, `StatusReason`, `LedgerPanelStatus`                                  | Shared presentation; features own meaning and available recovery actions        |
| Overlays             | Dialog and sheet primitives, `DetailsPanel`                                                                 | Accessible overlay foundation; workflows own opening, closing and content       |
| Read/write mechanics | `QueryGate`, `DataGate`, `useAsyncOperation`, `useRequestIdentity`, HR write and access modules             | Preserve existing scopes, authorization and retry guarantees                    |

The main problem is uneven adoption and parallel local presentation, not the absence of a component library.

## Concrete findings and priority

### 1. Adopt shared field presentation first

- `src/features/hr/EmployeeForm.tsx:500` defines `SelectField`, manually repeating label, hint/error IDs, error markup and accessibility wiring already present in `FormSelect`. It has four call sites in that form (`269`, `282`, `294`, `309`). Migrate to the existing module; four instances in one file are not four independent production consumers.
- `src/features/storageLayouts/StorageLayoutScreens.tsx:465` and `src/features/finishedGoods/shared.tsx:149` both wrap `FormField` and `Input`, but support different native versus value-oriented event interfaces. This is a two-implementation opportunity. Keep thin feature adapters unless a third same-intent caller demonstrates a useful common interface.
- HR employee fields, storage building fields and job-scan ticket fields already compose `FormField` (`EmployeeForm.tsx:238`, `StorageLayoutScreens.tsx:478`, `jobScan/TicketCard.tsx:61`). Standardize spacing and validation presentation there. Ticket scan actions, AI-origin markers, numeric rules and code normalization remain feature-owned.

**First pilot:** the four HR selects. Preserve explicit IDs, placeholder/empty labels, disabled options, pending state, on-change semantics and hint/error links. Do not alter validation rules or submit payloads.

### 2. Give section headings a single reusable implementation

- `src/features/hr/HrShared.tsx:324` defines `SectionTitle`, used in seven HR source files, including `EmployeeForm.tsx:228`, `PeriodsScreen.tsx:239` and `ReviewDetail.tsx:575`.
- Repeated section heading markup also appears in `src/features/finishedGoods/ProductBatches.tsx:360`, `ProductScreen.tsx:335` and HR settings. Heading sizes and outer spacing differ.
- `HrUi.tsx:212` already declares `HrSectionHeader`, but the source search found no production JSX consumer. Do not add another parallel helper around it.

Create one `SectionHeader` in `src/components/ui` for ordinary titled task sections. Its small interface should accept `title`, optional `description`, optional `actions` and optional `id`. It owns heading typography and action wrapping; surrounding layout owns section spacing. Introduce a compact variant only where current production usage proves it necessary. Keep decorated settings wrappers and domain content around the shared heading.

Pilot the existing HR `SectionTitle` consumers and a plain Finished Goods section. Remove the replaced heading implementation after migrating its consumers. Review heading levels rather than treating every visual heading as an interchangeable h2.

### 3. Make task surfaces share the existing Panel implementation

`src/features/finishedGoods/shared.tsx:33` exports a `panel` class string that duplicates the global `Panel` styling. Production consumers include `PackingScreen.tsx:1098`, `PalletScreens.tsx:402`, `StackScreen.tsx:233`, `ProductBatches.tsx:386` and catalogue cards. HR forms independently repeat the surface styling in `EmployeeForm.tsx:225`, `PeriodsScreen.tsx:237` and `CorrectionForm.tsx:164`.

Adopt `Panel` for equivalent task surfaces, including a named plain appearance for the approved flatter task sections. Keep layout, selection and row interaction in the feature. Preserve semantic tags such as form, article and aside; extend the existing supported tags and their native prop typing only where actual consumers require it. Do not turn a linked catalogue card into a nested button/link surface or force a table row to become a panel.

**Pilot:** an ordinary Finished Goods packing panel and the HR employee/period forms. Remove the feature-owned class constant once all its presentation consumers migrate. This makes a global surface padding/radius edit reach both feature families.

### 4. Standardize table structure without merging data workflows

- Shared wrappers are already used by HR periods/history/employees and Finished Goods: `PeriodsScreen.tsx:95`, `HistoryScreen.tsx:175`, `EmployeesScreen.tsx:318`, `FinishedGoodsTable.tsx:81`.
- `StorageLocationCatalogue.tsx:383` and `BuildingAreaDetails.tsx:285` build their own table and scrolling presentation. They are candidates to adopt the existing table primitives and `TableScroller`.
- `ReviewDetail.tsx:318` is a compact fixed-layout comparison of evidence, not automatically a catalogue table. Preserve its specific reading purpose.

Start with shared wrappers and primitives; use `DataTable` for simple rows that fit its existing interface. Keep rich per-column filters and mobile cards composed inside features. A universal list with flags for every filter, selection, row action, preview and mobile layout would increase caller complexity.

Share responsive search/clear behavior through `CollectionToolbar` when intent matches. `HrToolbar` is a grouped date/filter bar, so it is not automatically the same pattern as a search toolbar. Pagination presentation can be shared while numbered-page and cursor state remain separate.

**Pilot order:** storage location catalogue, building usage table, then a simple HR period table if the existing `DataTable` interface fits without special-case flags.

### 5. Consolidate semantic status presentation, retain domain mapping

`StatusBadge` is already shared across HR, Finished Goods, storage-kit and setup. HR additionally uses `HrStateChip` in `TodayScreen.tsx:168` and `PeriodDetailScreen.tsx:305`; it differs in size, indicator and tone classes. These two callers justify investigating reuse of the existing badge, not promoting all HR statistics or receipt cells to an app-wide module.

If the larger chip is needed, add one named, evidenced badge size/presentation variant. Keep labels and mappings in `DayStatusBadge`, `CorrectionBadge`, Finished Goods `Status` and `PlacementStatusBadge`. Do not create one global enum that conflates attendance, inventory and building statuses.

Do not centralize every tone class into one universal mapping: badge foregrounds, notice borders, selected controls and physical area identity have different jobs. Palette values stay in CSS tokens; component-specific treatment stays in its owning shared implementation.

### 6. Consolidate behavior only after preserving its guarantees

- `HrDisclosure` (`HrUi.tsx:243`) has consumers in HR review, settings and period detail. It uses `hidden` to keep children mounted. `CollapsibleSection` conditionally removes children (`src/components/ui/CollapsibleSection.tsx:62`) and is used in the floor editor and ticket details. Draft retention and dirty guards can depend on this difference.
- `HrQueryState` (`HrShared.tsx:91`) and `DataGate` have similar loading/denial presentation. HR also handles feature-specific errors and access/timezone restrictions. Only adapt the transport presentation where compatible; keep the relevant domain checks and denial diagnostics. Their declared outcome types differ: `DataGate` takes `TenantOutcome`, requiring successful request IDs and denial metadata that `HrQueryState` does not expose in its type. Use a deliberately minimal shared presentation contract or a correctly typed adapter; do not fabricate IDs/denials or cast away that difference.
- `useHrWrite` explicitly distinguishes saved, refused, denied and uncertain outcomes and pins retry payloads/request IDs. `useAsyncOperation` has a different interface and lifecycle. Reusing their feedback appearance is lower risk than merging their execution semantics.
- Confirmation content appears in job-scan delete, product delete and batch cancellation (`JobScanRecords.tsx:376`, `ProductScreen.tsx:475`, `ProductBatches.tsx:524`). A shared confirmation shell is plausible after documenting their close-while-pending, retry, destructive and successful-dismissal rules. Physical storage acknowledgement and HR certification require their own content and checks.

**Disclosure pilot:** HR review and period forms plus ticket details. Extend the existing disclosure module with an explicit mounting policy if both behaviors are needed; preserve every consumer's current default. Hidden content must not be focusable, and deep-linked content must open before focus is restored.

**Unsaved navigation:** Kiro found that HR uses `DraftGuardProvider`, storage calls its guard directly, and Finished Goods calls a browser-only `useUnsavedWarning` (`ProductScreen.tsx:247`, `JobScanScreen.tsx:139`, `BatchManager.tsx:93`). Verify sidebar/search/link/Back navigation in the real app before treating the inferred Finished Goods gap as a confirmed defect. Move genuinely shared guard mechanics out of the storage feature, then register forms through the existing shared seam. Preserve each form's distinction between unsent edits, locally persisted drafts and pending writes. Keep storage's URL/history protections and HR's pending-navigation locks; avoid double prompts. Coordinate with the in-progress provider and guard changes before implementing this migration.

### 7. Share recurring controls with matching interaction rules

| Pattern                            | Production evidence                                                                                                                          | Proposed owner and interface                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search and clear                   | `StorageZonesPanel.tsx:1156`, `DestinationPicker.tsx:76`, `StorageLayoutScreens.tsx:324`, `JobScanRecords.tsx:217`, plus `CollectionToolbar` | Extract `SearchField` from the existing toolbar: value, value-change callback, translated label/clear label, optional placeholder and disabled state. It owns icon placement, touch target and focus return on clear; features retain debounce and search semantics. Preserve deliberate Enter/submit behavior rather than assuming every field must suppress Enter. |
| Single-choice view/filter controls | `StorageLocationCatalogue.tsx:229`, `FinishedGoodsCatalogue.tsx:232`, `FloorLocationTable.tsx:249`, `ReviewScreen.tsx:196`                   | A small typed `SegmentedControl`: labelled options, current value, change callback and disabled state. Preserve current `aria-pressed` semantics and distinguish these groups from true tabs/radio controls. Review selected appearance once before migration.                                                                                                       |
| Pending action presentation        | `BatchManager.tsx:794`, `PlacementEditor.tsx:492`, `JobScanScreen.tsx:533`, storage create action at `StorageLayoutScreens.tsx:453`          | Extend `Button` with pending state and caller-supplied pending label, following `IconButton`'s existing `aria-busy` and disabled handling. Features own submission and retry. Handle `asChild` links explicitly: native `disabled` alone does not disable an anchor.                                                                                                 |
| Key/value summaries                | HR `Facts` (`HrShared.tsx:293`), storage `Metric` (`storageLayoutShared.tsx:81`), `StackScreen.tsx:283`, `PlacementEditor.tsx:98`            | Promote a small `DescriptionList` for equivalent labelled facts. Callers supply stable item IDs, labels and values; a small rows/grid layout choice is justified by existing usage. Keep HR receipt cells, statistics and specialist scene annotations feature-owned.                                                                                                |

The search pilot should start with the storage-zone search, which already restores input focus after clearing. Kiro's expected focus loss in other searches is a source inference requiring browser confirmation.

### 8. Make shared UX copy change through the translation catalogues

`StatusReason.tsx:95`, `CursorPagination.tsx:36-57` and `useWorkspaceNavigationGuard.tsx:238-260` contain Thai/English strings in code. Move recurring common copy into existing `messages/en.json` and `messages/th.json` namespaces while keeping feature terminology local. This is part of the one-place-change goal: updating common copy should not require edits to several TSX files.

Route message selection is essential: `src/i18n/clientMessages.ts` replaces nested provider messages rather than merging them, and HR does not include `Pagination` or `WriteError`. Use a namespace available to all intended consumers, pass translated labels, or deliberately extend the appropriate route namespace lists. Verify shared controls with each consuming route's actual selected messages.

Locale-aware measurement formatting is a later UI consistency cluster. Existing length/area helpers should provide the foundation; add shared locale formatting only after deciding the common unit display and rounding contract. Browser-locale `toLocaleString()` calls, repeated `/1000` conversions and Thai area-label differences need an inventory. Preserve canonical numeric units and HR's business-date/timezone semantics.

## Intended module structure

Keep the current directories and direct imports. No bulk renaming or new package is needed.

1. `src/app/globals.css`: global semantic tokens and theme values.
2. `src/components/ui`: reusable controls and presentation modules such as fields, headings, badges and disclosure.
3. `src/components/system` and `src/components/table`: recurring application presentation such as query state, search toolbar and pagination. Keep their current locations to avoid migration churn.
4. `src/features/<feature>`: domain adapters, data queries, permissions, mutations, validation, labels, task order and specialised interactions.

Feature code may depend on shared UI. Shared UI must not import HR, Finished Goods or storage feature implementations. Generalize a feature helper only when at least three production consumers share the same intent, or replace a duplicate with an already existing shared module. Two-consumer opportunities stay explicitly provisional.

Use semantic variants with sensible defaults. Avoid per-screen style flags and long boolean prop lists. `className` remains available for composition, but routine overrides of control height, focus, typography or semantic colors should trigger review and adoption of a named shared variant.

Keep static modules usable without adding unnecessary `"use client"` directives. Interactive modules own their client entry points. Named exports and composed children should preserve the installed Next.js module-graph and serializable-prop rules; do not put every shared module behind one client barrel. Relevant installed guides were read: `node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md` and `01-app/03-api-reference/01-directives/use-client.md`.

## Delivery sequence

| Phase                                  | Reviewable changes                                                                                                                                                                           | Exit condition                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0. Inventory and contract              | Map the approved sheet to production consumers; record semantic Tailwind tokens, the shared density breakpoint and exceptions; establish real-app baselines                                  | The sheet's visual rules have explicit owners and measurable acceptance, with feature behaviors preserved                       |
| 1. Shared controls and fields pilot    | Implement the shared 36px/48px control scale, 2px label spacing and focus treatment; replace HR's four custom selects; migrate common copy and compatible read presentation in small changes | Pilot forms match the sheet, accessibility and selected messages work, and denial metadata remains correct                      |
| 2. Heading and table presentation      | Adopt shared Panel surfaces; introduce SectionHeader; migrate HR/FG headings; adopt table/scroll wrappers in storage tables                                                                  | Replaced markup is removed; headings/actions, sorting and mobile access are retained                                            |
| 3. Reusable controls                   | Extract SearchField and SegmentedControl; extend pending Button behavior; adapt the two HR chips to shared badge presentation if appropriate                                                 | Clear/search focus, selected state and pending access are consistent; domain actions and labels remain correct                  |
| 4. Disclosure, navigation and feedback | Preserve explicit disclosure mounting policy; verify and consolidate unsaved navigation; share compatible confirmation/feedback presentation; keep execution feature-owned                   | Drafts/guards survive collapsing, pending navigation remains protected, uncertain retries stay safe, and overlays restore focus |
| 5. Complete adoption and prevent drift | Migrate summaries, compact empty states and remaining equivalent consumers; consolidate compatible locale formatting; remove obsolete adapters; add examples and focused lint restrictions   | Each canonical pattern has a consumer inventory, clear exceptions and one implementation                                        |

Each migration is a small independently reviewable change: establish the shared implementation, migrate named callers, delete replaced code, run relevant checks. Preserve existing public exports temporarily only while they have consumers; do not leave permanent duplicate implementations behind compatibility names.

### Delivery status (completed 2026-10-11)

All five adoption phases are complete: shared tokens/controls, fields and surfaces, reusable interactive presentation, disclosure/navigation feedback, full adoption and drift prevention. Kiro audited all 81 initial desktop/mobile images and applied one improvement batch; Codex resolved findings and preserved concurrent root work. The merged application passes `pnpm check` (2,876 tests) and the default Turbopack build.

[Final audit, consumer inventory and verification limits](../reviews/component-reuse-codex-audit-2026-10-10.md) · [91 production captures](../../output/component-reuse-ux-2026-10-10/final/index.html). Specialist scene/camera controls, unit-entry labels and unrelated feature terminology remain documented exceptions.

## Verification and measurable acceptance

Before implementation, capture the pilot screens in the real app and the corresponding original design-sheet specimens at matching viewports, languages and themes. Keep fixtures synthetic and avoid creating backend records merely to render shared UI examples. Shared examples should cover states and variants without adding a production-visible demo route or new Storybook dependency by default.

- **Change propagation:** demonstrate that one `FormField` edit changes employee, product and building field presentation; one `Panel` edit changes its HR/FG surfaces; one `SectionHeader` edit changes its HR/FG consumers; one badge presentation edit updates feature adapters while preserving their labels.
- **Design-sheet parity:** measure desktop/mobile control sizes, 2px label spacing, 8px related-field gaps, 16px section and 24px group spacing on the pilot forms. Compare real scan, catalogue, floor and HR screens with the approved specimens for flat task composition, focus and copy. Record functional differences required by production rather than copying synthetic data or preview limitations.
- **Adoption:** track canonical pattern, production consumer files, migrated files, remaining duplicates and intentional exceptions. Finish each cluster at zero unapproved independent implementations, rather than targeting an arbitrary line-count reduction.
- **Interaction:** meaningful component tests cover label/error association, controlled/uncontrolled disclosure, preserved drafts, focus return, pending locks and hidden content access. Retain feature tests for permissions, sort/filter/cursor behavior, unknown versus empty state and uncertain-write retry identity. Verify shared controls against each consuming route's selected message namespaces. Avoid tests asserting copied class strings or trivial wrappers.
- **Browser:** inspect representative HR employee/review/period screens, Finished Goods catalogue/product/ticket screens, and storage catalogue/building/floor screens at 390px and desktop; include tablet and long Thai/English strings in the responsive pass. Include shell/search and sign-in/setup when shared changes reach them. Check both themes, keyboard, loading, empty, denied, failed, pending, saved and read-only states where each pattern supports them. Use the T3 collaborative browser during implementation.
- **Checks:** run formatting for changed files, relevant Vitest projects/files, typecheck and lint per migration. Run `pnpm check` and `pnpm build` at the completed implementation boundary. Record pre-existing failures separately because this working tree already contains substantial unrelated edits.
- **Drift prevention:** extend the existing ESLint precedent requiring `SelectControl` only after migration. Target application form/select/table bypasses and imports of feature-private UI. Explicitly allow intentional native file/color inputs, custom composite controls and primitive internals; do not blanket-ban HTML elements. Document review rules for shared style overrides and adding variants.

## Decisions resolved and remaining

Resolved by the user and repository evidence: the original design sheet is the visual target; Tailwind v4 and existing shared UI remain the foundation; consistency covers behavior as well as appearance; feature workflows retain their own domain rules; rollout is incremental; HR selects are the first adoption pilot.

Implementation choices are resolved in `globals.css`: the canonical dense variant is at least 48rem with a fine pointer; semantic tokens express 36/48 sizing, spacing and focus; named variants cover flat task sections. Existing theme identities and feature policies remain. The HR select pilot was completed before broader adoption; final verification is recorded in the implementation and Codex audit reviews.
