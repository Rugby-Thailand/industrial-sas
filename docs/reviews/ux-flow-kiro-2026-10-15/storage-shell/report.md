# Storage layout + shared shell — Kiro UX-flow review, 15 Oct 2026

Reviewer: Kiro CLI, `claude-opus-5.5`, high effort. Scope: storage catalogue/building/floor/location journeys, empty/archived/read-only states, warehouse/organization context, setup/access recovery, global search, locale switching and the shared shell. Current working tree at HEAD `733c6aca` including uncommitted changes. Discovery only: no application source, tests, config or translations were changed; files were written only in this directory.

Evidence levels used below:

- **source-traced** — read the code path end to end; not executed.
- **rendered-component-test** — the real production component rendered in jsdom by a probe in `probes/`; only Convex, Clerk, router, workspace/HR context and `QueryGate` seams are mocked, following existing test patterns.
- **browser-verified** — none. The parent owns browser verification.

## Findings

| ID    | Sev | Title                                                                                                                             | Evidence                | Novelty |
| ----- | --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------- |
| SS-05 | P2  | A successful location create/edit in the building workspace raises “Save changes before leaving?”, and no success message appears | rendered-component-test | New     |
| SS-01 | P2  | Building/review/task routes say “Choose a warehouse” but have no warehouse selector                                               | rendered-component-test | New     |
| SS-02 | P2  | Building and review pages that are not found or fail to load show only a one-line notice: no heading, Back, breadcrumb or retry   | rendered-component-test | New     |
| SS-04 | P3  | A warehouse with no buildings says “No buildings match these filters” with no filters applied                                     | rendered-component-test | New     |
| SS-03 | P3  | A member with no accessible warehouse, or any user while the workspace loads, is told “No organization context”                   | rendered-component-test | New     |

### SS-05 (P2): a successful location save is followed by a false unsaved-changes prompt, and the success message is hidden

- **User/role:** storage-layout manager working in the building workspace (`/master-data/storage-layouts/<id>`). This is the main way to create and edit locations.
- **Trigger and reproduction:** Open a DRAFT/ACTIVE building and choose More actions → Add storage stack. Optionally type a name, then choose Create storage stack and let the write succeed. The same happens when you edit an existing location from the map (`?editZone=<id>`) → Save changes.
- **Expected:** The editor closes. The user sees the existing receipt (“Storage stack created. Its location code and QR label are ready for activation.” or “…updated…”). No unsaved-work prompt appears, because nothing is unsaved and the write has finished.
- **Actual (probe):** The write is sent once and the editor closes. Then a modal “Save changes before leaving? You have unsaved changes. Save them, discard them, or keep editing.” opens, even for a pristine default-name create. The URL keeps `?overlay…=1`. **Keep editing** closes the prompt but leaves the editor closed and the overlay query in place, which is a stale foreground entry. **Save and continue** sends no further write and closes. The success receipt is never rendered, so the false prompt is the only visible result of a successful save. This invites “Discard changes” and makes the user doubt the save. No saved data is lost: the write already committed, and floor edits are blocked while a location editor is used.
- **Evidence:**
  - Success path closes the dialog in the same batch that clears pending: `src/features/storageLayouts/StorageZonesPanel.tsx:448`, `:455-457`.
  - Pending is reported upward only through a layout effect: `StorageZonesPanel.tsx:231-234` → `src/features/storageLayouts/StorageLayoutScreens.tsx:1488-1490` → `:1184` (`setPending`).
  - The workspace guard reads that state: `StorageLayoutScreens.tsx:1045-1050`.
  - The Dialog's disclosure runs `step.back()` from its own layout effect when `open` turns false: `src/hooks/useBackDisclosure.ts:48-55`. That goes through `guardedNavigate` into `useNavigationGuard.requestTransition`, which prompts when `pending` is true: `src/components/system/useNavigationGuard.tsx:101-142`.
  - Hidden receipt: compact mode lists only the selected zone (`StorageZonesPanel.tsx:138`). Details, and the message notice at `:1146`, render only when that list is non-empty (`:1111`). A new location is not selected after creation. The same source path also hides “Storage stack archived” after an archive from the compact inspector, because archived zones leave `zones` (`convex/storageLayouts/catalogue.ts:189-191`). That case is source-traced only.
- **Cause (source-traced hypothesis; behavior is reproduced, ordering not instrumented):** The Back step closes in the same commit that clears the child's pending flag. Child layout effects run before the parent-state hops that clear the workspace guard's `pending`, so the guard still sees a pending write and prompts.
- **Smallest fix:**
  - Let the workspace guard read the child's pending state live (a ref updated synchronously, as `childDrafts.latest` does), not through two state hops.
  - Or close the editor through the disclosure's completion owner after pending has settled, per the Back contract's “successful asynchronous writes use the live operation completion owner”.
  - Render the success message outside the selected-zone gate, or select the new location after creation.
- **Test needed:** A caller test in `StorageLayoutScreens.test.tsx` covering compact create and update success with no prompt, the receipt visible, the overlay entry consumed, and the next Back leaving the building normally. Repeat for Thai and archive. Run `pnpm check:navigation`.
- **Confidence:** high for the behavior, medium for the exact ordering. **Novelty:** new. Existing tests open the create dialog (`StorageLayoutScreens.test.tsx:326`) but never complete a successful compact create or update.

### SS-01 (P2): detail and task routes ask the user to choose a warehouse but offer no selector

- **User/role:** any storage or finished-goods member with access to two or more warehouses. This happens on a new device or browser, after storage is cleared, or when a coworker's link points to a building in another warehouse.
- **Trigger and reproduction:** With no stored warehouse, open `/th/master-data/storage-layouts/<buildingId>` directly, or its `/review` page, or any finished-goods task page.
- **Expected:** The page that says “Choose a warehouse to see its work and records.” lets the user choose one, then shows the requested building.
- **Actual (probe):** The panel shows “No warehouse selected / Choose a warehouse…”, but the page renders 0 `warehouse-select` controls. In the control case on `/master-data/storage-layouts`, the selector does render. The header context is `TaskWorkspaceContext`, which renders nothing when no warehouse is selected. To recover, the user must notice the sidebar, go to the catalogue, pick a warehouse, and then find the building again; the deep link is lost. If the stored warehouse is a _different_ accessible warehouse, the backend returns `found:false`, so the page says “Storage building not found.” with no hint to switch (see SS-02).
- **Evidence:**
  - Selector shown only on the two top-level routes: `src/components/examples/c-sidebar-2.tsx:80-84`, `:88`, `:171-185`.
  - Nothing rendered when no warehouse is selected: `c-sidebar-2.tsx:483-498`.
  - Instruction without action: `src/components/system/QueryGate.tsx:21-23`, `src/components/system/LedgerPanelStatus.tsx:66-71`, `messages/en.json:169`.
  - No auto-selection with more than one warehouse: `src/lib/workspace/workspace.ts:42-51`.
  - Building in another warehouse returns `found:false`: `convex/storageLayouts/catalogue.ts:483-484`.
- **Cause:** By design, detail routes hide the switcher so that a draft cannot change warehouse (see the comment at `c-sidebar-2.tsx:80`). That design does not cover the state where no warehouse is selected at all.
- **Smallest fix:** When `selectedWarehouseId === undefined && selectable`, render the existing selector, either as the `action` of the `WAREHOUSE_MISSING` panel in `QueryGate` or in `TaskWorkspaceContext`. No draft can exist in this state, so the known warehouse-switch guard gap (F05, 13 Oct) is not widened. Optionally, return enough information from a `found:false` result to suggest the building's warehouse when the actor can access it.
- **Test needed:** A shell or caller test: deep link with no stored warehouse → selector present → choose → building renders on the same URL (locale/query/hash kept). Also test that pages with a warehouse already selected still show no switcher.
- **Confidence:** high. **Novelty:** new. The 13 Oct audit row 02 judged warehouse scoping “sound” and did not cover the missing-selection recovery.

### SS-02 (P2): building/review “not found” and read-failure states have no page frame or way back

- **User/role:** any storage member following a stale, deleted, other-warehouse or mistyped building link, or meeting a transient read error.
- **Trigger and reproduction:** Open `/en/master-data/storage-layouts/<id>` or `/en/master-data/storage-layouts/<id>/review` when the layout query returns `found:false` or `ok:false`.
- **Expected:** A page heading, a Back control or breadcrumb to “Buildings & spots” (the route's declared parent in `back-navigation.json`), and Retry for a read failure. This matches other recovery surfaces such as `WorkspaceAccessBoundary` and `not-found.tsx`.
- **Actual (probe):** Only `Storage building not found.` or `The storage layout could not be loaded.` is rendered. The page has 0 headings, 0 links and 0 buttons, and nothing explains possible causes (another warehouse, archived, deleted). Recovery depends on the browser Back button or the sidebar.
- **Evidence:**
  - Both route pages render only the feature component, with no header: `src/app/[locale]/(desktop)/master-data/storage-layouts/[buildingId]/page.tsx:11-12`, `[buildingId]/review/page.tsx:11-12`.
  - The page header appears only on the ready path (`StorageLayoutScreens.tsx:1112`).
  - Non-ready returns: `StorageLayoutScreens.tsx:546-549`, `:3061-3064`, `QueryFailure` at `:157-160`. The same pattern exists in `FloorQuery` (`:1229-1237`).
- **Smallest fix:** Wrap the non-ready states in a `PageHeader` that uses the existing breadcrumb to the catalogue (the review route's parent is the building). Add a Retry action for `!ok`. Add a not-found body that names the selected warehouse and links to the catalogue. Review the navigation inventory targets and run `pnpm check:navigation`.
- **Test needed:** Caller tests for not-found and failed reads on both routes: heading present, Back/breadcrumb goes to the declared parent, a direct link creates no synthetic loop, and Retry re-queries.
- **Confidence:** high. **Novelty:** new. The 14 Oct R16 entry concerned duplicate headings in `WorkspaceAccessBoundary`, not these states.

### SS-04 (P3): the first-use catalogue empty state says “No buildings match these filters”

- **User/role:** a manager or viewer of a new warehouse with no buildings yet. This is the first screen after sign-in, since `/` redirects to the storage catalogue.
- **Trigger and reproduction:** Open `/th/master-data/storage-layouts` with empty search and status “All statuses” in a warehouse that has no buildings.
- **Expected:** The first-building guidance that already exists in both catalogues: “No storage buildings yet / Create a building to start defining floor-by-floor capacity.” (TH: “ยังไม่มีอาคารจัดเก็บ / สร้างอาคารเพื่อเริ่มกำหนดความจุแยกตามชั้น”). Filter-mismatch copy should appear only when a filter is applied, as the All-locations view already does.
- **Actual (probe):** EN shows “No buildings match these filters / Change the search text or status filter to see more buildings.” TH shows “ไม่มีอาคารที่ตรงกับตัวกรอง”. This tells the user to change filters that are not set. The header's New building button is the only next step.
- **Evidence:**
  - Unconditional filter copy: `src/features/storageLayouts/StorageLayoutScreens.tsx:230-231`.
  - Unused first-use keys: `messages/en.json:324-325` and `messages/th.json:324-325`. No `t("emptyTitle")` exists in `src/`; the call was last present before commit `983fb5a6`.
  - Correct pattern elsewhere: `src/features/storageLayouts/StorageLocationCatalogue.tsx:290-312`.
- **Smallest fix:** Choose `emptyTitle/emptyBody` when `search === "" && status === "ALL"`. Otherwise keep `noMatches` and add a Clear filters action. Optionally add a New building action, gated by manage permission (see the known F08).
- **Test needed:** Catalogue render test for the unfiltered empty state versus the filtered empty state, in both locales.
- **Confidence:** high. **Novelty:** new. The 13 Oct row 05 assumed “distinct empty/filter-empty states” existed.

### SS-03 (P3): the workspace bar says “No organization context” when an organization exists

- **User/role:**
  - A signed-in member of an organization whose scoped membership has no ACTIVE warehouse. This happens when the scope list is empty or all of its warehouses are archived.
  - Every user, briefly, while the workspace query loads.
- **Trigger and reproduction:** Open the storage catalogue or the finished-goods catalogue as such a member, or on a slow connection.
- **Expected:**
  - Zero warehouses: “No warehouse available” (an existing key), with advice to ask an administrator for warehouse access.
  - Loading: a loading state.
  - The page panel should not say “Choose a warehouse” when there is nothing to choose.
- **Actual (probe):**
  - Zero warehouses: the bar shows “No organization context / Organization and warehouse access comes from your verified account.”, and the page shows “No warehouse selected / Choose a warehouse to see its work and records.”
  - Loading: the bar shows “No organization context”.
- **Evidence:**
  - The early return treats `!selectable` like a missing organization: `src/components/shell/WorkspaceContextBar.tsx:16-22`, `messages/en.json:122-124`.
  - `selectable` is derived from the warehouse count: `src/lib/workspace/workspace.ts:38`.
  - The loading state has an undefined organization: `src/components/providers/WorkspaceProvider.tsx:104-110`, `:127-133`.
  - Zero warehouses is reachable: `convex/workspace/current.ts:26-60` filters scoped warehouses to ACTIVE.
  - `QueryGate.tsx:21-23` does not distinguish “none available” from “none selected”.
- **Smallest fix:** Split the early return into separate loading, organization-missing and zero-warehouse branches; use `noWarehouses` plus an administrator hint for zero warehouses. In `QueryGate`, show a distinct no-access state when `warehouses.length === 0`.
- **Test needed:** WorkspaceContextBar and QueryGate tests for loading, zero-warehouse and multi-warehouse unselected states, in both locales.
- **Confidence:** high for the rendering. Medium for how often zero-warehouse members occur, since no fixture creates one. **Novelty:** new.

## Rejected or not counted

- **Locale switch loses state or bypasses unsaved-work guards.** Rejected. `src/components/shell/LocaleSwitcher.tsx:41-48` keeps `search` and `hash` and runs through `guardedNavigate`, and `LocaleSwitcher.test.tsx` covers this.
- **Global search navigates past guards or permissions.** Rejected. `src/components/shell/search/GlobalSearchProvider.tsx:104-120` (permission check at `:110`, `guardedNavigate` at `:114`) checks `targetPermissions` and then uses the dialog completion owner plus `guardedNavigate`.
- **Archived buildings expose editing.** Rejected. Edit, location and settings controls are gated on `status !== "ARCHIVED"` (`StorageLayoutScreens.tsx:583`, `:1025`, `:1159`, `:1288`; `StorageZonesPanel.tsx:142`). The status toggle becomes a badge (`BuildingStatusToggle.tsx:136-142`), and a read-only notice is shown.
- **A building with no floors is a dead end.** Rejected. `mapNoFloors` is shown (`StorageLayoutScreens.tsx:1191`, covered by a test), and settings and Add floors stay available for non-archived buildings.
- **The All-locations empty state is misleading.** Rejected. It already distinguishes filtered from unfiltered and offers Clear (`StorageLocationCatalogue.tsx:290-312`).

## Product-decision observations (not counted as bugs)

- `OrganizationRequired` sends a user who just picked an organization to a fixed `/<locale>/master-data/storage-layouts` (`src/components/auth/OrganizationRequired.tsx:20-23`). The original deep link is dropped, and HR-only members are then redirected again by `HrLandingRedirect`. Keeping the validated `returnTo` would be friendlier.
- There is no in-app organization switcher, only Clerk `UserButton` (`src/components/shell/AccountButton.tsx`, Clerk 7.7.4). Whether multi-organization users switch through Clerk's account UI was not verified.
- Known items were not repeated: 13 Oct F02 (0.1 m step), F04 (hidden transport errors), F05 (warehouse switch without guard), F06 (New building Back), F07 (Open adds `editing=1`), F08 (read-only gating), F10, F11, F14, F17 and F18, plus the 14 Oct duplicate-label inventory.

## Coverage

- Read: AGENTS.md, PRODUCT.md, `docs/contracts/back-navigation.md` and the storage route entries in `back-navigation.json`, the 14 Oct system audit and Kiro report, the 13 Oct daily bug search, the 13 Oct storage-actions README and layout rows 01–43, and the Next.js Vitest guide.
- Storage routes: catalogue, new, building, review, legacy floor redirect.
- Feature code: `StorageLayoutScreens` (catalogue, new form, building content, settings, workspace guard, floor form wiring, review), `StorageZonesPanel` (create/edit/archive, compact inspector, messages), `StorageLocationCatalogue`, `BuildingStatusToggle`, `useStorageBuilding`, `FloorMap` inspector/sheet host.
- Shell: `c-sidebar-2` (header, drawer, workspace context, navigation), `WorkspaceContextBar`, `LocaleSwitcher`, `AccountButton`, `HrLandingRedirect`, the search provider, loader and triggers.
- Providers: `WorkspaceProvider`, `WorkspaceAccessBoundary`, `draftGuard`, `useNavigationGuard`, `useBackDisclosure`, `useWorkflowStep`, `QueryGate`, `LedgerPanelStatus`.
- Access recovery: `(desktop)/layout.tsx`, `OrganizationRequired`, `appAccess`, the locale root redirect, `not-found`, `error`, setup.
- Backend: `convex/workspace/current.ts`, building layout/inventory reads (`catalogue.ts`).

## Probes and checks

All probes are in `probes/`, outside the normal suites. Each asserts the expected behavior, so a failure is evidence of the defect, not a fix.

```sh
pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/storage-shell/probes/vitest.config.mts --reporter=verbose
pnpm exec tsc -p docs/reviews/ux-flow-kiro-2026-10-15/storage-shell/probes/tsconfig.probes.json
pnpm exec eslint docs/reviews/ux-flow-kiro-2026-10-15/storage-shell/probes/
```

| Check            | Result                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest probes    | **12 failed, 3 passed (15)**, exit 1, ≈3.5 s. Raw output: `probes/probe-run.log`. The passes are the SS-01 catalogue control and two SS-05 observation cases (prompt choices send 0 extra writes). |
| Probe TypeScript | exit 0                                                                                                                                                                                             |
| Probe ESLint     | exit 0                                                                                                                                                                                             |

The full test suite, `pnpm check:navigation` and the app server were not run, as instructed.

## Limitations

- Nothing was browser-verified. SS-05's prompt depends on React effect ordering, which jsdom reproduces with the real Dialog, workflow-step and guard code. It still needs one real-browser check, including what the next native Back does after “Keep editing”; this probe did not exercise it.
- Probes mock Convex, Clerk, router and workspace context. The SS-03 zero-warehouse membership and the SS-01 other-warehouse `found:false` path were traced in backend source, not run against `convex-test`.
- Not covered in depth: the floor editor (reserved areas, offsets), rack/position modes, the QR dialog, keyboard map navigation, mobile sheet focus beyond source reading, AI search, and the HR or finished-goods screens beyond shell context.
