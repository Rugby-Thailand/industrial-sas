# Storage + shared shell — implementation result (SS-01 … SS-05)

Worktree: `/Users/macbook/Development/industrial-sas-ux-flow-20261015-storage` at `faca0cf5` (origin/main). Uncommitted; no commits, pushes or PRs. No browser use, deployments, credentials or production data. `WorkspaceProvider` and `warehouseStore` were not edited.

## Revalidation on current source

All five findings still reproduced on `faca0cf5` before any change. The stale probes no longer fit the redesigned sidebar and storage workspace (for example, the SS-03 probe throws `useSidebar must be used within a SidebarProvider`). I therefore reproduced each finding with new caller tests in the normal suites rather than reusing the probes. A stash run with only the five production source files reverted (new tests and messages kept): **20 new behavior tests fail before the fix and pass after it**. ShellControls was checked separately: 3 new tests fail before, 14/14 pass after.

| ID    | Status | Current-source cause (re-verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SS-05 | Fixed  | The spot editor already closes through `operation.complete` → `editorDialogRef.complete`, but that live completion runs `guardedNavigate` with no retained scope. The floor-draft guard in `BuildingModelWorkspace` was still (a) dirty, because `editing && dialogOpen` counted the spot editor, and (b) pending, because spot pending is mirrored through two layout-effect state updates that arrive after the completion's passive effect. Result: a prompt after a successful create/rename/archive. Also, compact receipts render only inside the selected-location details, so a create (which selects nothing) showed no receipt. |
| SS-01 | Fixed  | `QueryGate` showed `WAREHOUSE_MISSING` with no control. The sidebar context bar shows the selector only on the two top-level routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| SS-02 | Fixed  | Building and review non-ready states rendered only a bare `Notice`, with no heading, breadcrumb or Back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| SS-03 | Fixed  | `WorkspaceContextBar` showed "No organization context" for both loading and a zero-warehouse member. `QueryGate` asked a member with zero warehouses to "Choose a warehouse".                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SS-04 | Fixed  | The building catalogue always used `noMatches`, and `emptyTitle`/`emptyBody` had no caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Changes

- **SS-05** (`StorageLayoutScreens.tsx`, `StorageZonesPanel.tsx`)
  - The floor-draft guard now records only the floor's own write as `pending`, using a new `onFloorWriteChange`/`floorWritePending`. The combined floor-or-spot `pending` still blocks editor closure, `editStep` and floor actions.
  - Spot writes stay protected by the spot editor's own `useNavigationDraft`/`usePendingGuard` registrations, which settle in the same commit.
  - `onDialogChange` now reports only the unavailable-area editor, whose edits join the floor draft. A spot editor opens only while the floor is clean, and it guards its own draft.
  - A compact panel whose message has no rendered details (create, archive, or hidden inspector) portals the receipt to a host below the floor form (`data-testid="storage-zone-receipt"`).
- **SS-01** (`QueryGate.tsx`)
  - When warehouses exist but none is selected, the panel offers a labelled warehouse select (`warehouse-gate-select`) as its action. The select calls the existing `workspace.selectWarehouse`, so the page stays on the same URL (locale/query/hash unchanged) and the gated page then mounts.
  - Nothing gated is mounted in this state, so no draft can be lost. Once a warehouse is selected, detail and task pages still offer no switcher.
- **SS-03** (`QueryGate.tsx`, `WorkspaceContextBar.tsx`)
  - Zero warehouses now shows `panel-WAREHOUSE_UNAVAILABLE`: "No warehouse available" with an administrator hint.
  - The context bar distinguishes three states: loading (`role="status"`, "Loading warehouses…"), an organization with no warehouse, and a missing organization.
- **SS-02** (`StorageLayoutScreens.tsx#BuildingUnavailable`)
  - Not-found and refused reads render a `PageHeader` with a heading, the breadcrumb trail and header Back. The explicit fallback is the declared parent: the catalogue for a building, and the building for its review.
  - Not-found names the selected warehouse, covering the other-warehouse case.
  - A refused read (`ok:false` is always an `AUTHORIZATION_DENIED` outcome on a live subscription) shows the existing `DENIED` panel with its request ID. It has no Retry, because retrying would repeat the same denial; the parent qualification allows "Retry _or_ the declared parent as appropriate". Thrown read errors still go to the route error boundary.
- **SS-04** (`StorageLayoutScreens.tsx`, `StorageLocationCatalogue.tsx`)
  - An unfiltered empty catalogue uses `emptyTitle`/`emptyBody`.
  - A filtered empty catalogue keeps `noMatches` and adds a "Clear filters" button. A new `onClearFilters` clears search and status in one history step.
- **Messages (en/th):**
  - `Workspace.noWarehousesHint`, `Workspace.loading`
  - `Panel.warehouseUnavailable`, `Panel.warehouseUnavailableHint`
  - `StorageLayouts.clearFilters`, `notFoundTitle`, `notFoundHint`, `notFoundHintGeneric`, `loadErrorTitle`, `buildingCrumb`
- **Navigation inventory** (`docs/contracts/back-navigation.json`): real case titles were added to:
  - the building and review route policies, with `StorageBuildingRecovery.test.tsx` added to their `tests`;
  - `StorageZonesPanel:createDialogOpen` and `:$overlay:Dialog:createDialogOpen` (create, rename and pending cases);
  - `StorageZonesPanel:archiving` and `:$overlay:ConfirmDialog:archiving` (archive receipt);
  - `BuildingModelWorkspace:editStep` (next Back after create closes the floor editor).

  No policies, targets or exemptions were changed. I confirmed that a misspelled case title makes the checker fail.

## Tests (all pass after the fix)

- `StorageLayoutNavigation.test.tsx` → `compact workspace spot completion`, which uses the real `BuildingModelWorkspace`, Dialog, `useBackDisclosure`, `useWorkflowStep`, `DraftGuardProvider` and native history:
  - create in EN/TH: no prompt, receipt visible, overlay consumed; the next Back closes the floor editor and the following Back reaches the origin;
  - rename while browsing and while editing;
  - archive receipt after a live rerender drops the spot;
  - pending create held through native Back, then closing without a prompt.
- `StorageBuildingRecovery.test.tsx` (new), which uses the real `WorkspaceProvider`, warehouse store and `QueryGate` with the actual `StorageBuildingEditor`/`StorageBuildingReview`:
  - direct building and review links with header Back replacing to the declared parent;
  - real-origin Back in TH, with query and hash;
  - denied read with its request ID;
  - choosing a warehouse in place, after which the building renders on the same URL;
  - a stored warehouse that doesn't hold the building is named, with no switcher;
  - a zero-warehouse member.
- `QueryGate.test.tsx`:
  - choosing in place in EN/TH on the same URL;
  - an existing selection gets no chooser (control);
  - zero warehouses in EN/TH.
- `ShellControls.test.tsx`: a zero-warehouse organization member in EN/TH, and loading.
- `StorageLayoutScreens.test.tsx`: the unfiltered first-use state in EN/TH, and the filtered state with one-step Clear filters that keeps path and hash.

## Checks run

- `pnpm check:navigation`: 68/68 fixtures; contract OK (58 route/error policies, 293 owners, 26 action intents).
- `pnpm lint`, `pnpm typecheck:ts6`, `pnpm format:check`: pass.
- Vitest `unit` + `unit-node` + `a11y` projects: 241 files, 2629 tests passed. Later focused rerun: 89 files, 1200 tests passed.
- `pnpm ci:test-discovery` reports only that the new `StorageBuildingRecovery.test.tsx` is not yet tracked by git, which is expected until the parent stages it.
- Not run here: the pinned-Bun `pnpm typecheck`/full `pnpm check`, Playwright (including `tests/e2e/navigation/storage-editor.spec.ts`), and the convex-runtime/integration projects.

## Limitations

- No browser verification. The SS-05 timing is reproduced in jsdom with real React effect ordering; a real-browser check of compact create/rename/archive followed by native Back is still needed.
- The other-warehouse not-found case is exercised through the real QueryGate/provider with a mocked Convex query that scopes the building to warehouse B. The backend `found:false` path is source-traced only.
- The compact receipt is portaled into a host below the floor form. The navigation checker did not flag the new `message` branch (it does not follow the assigned `receipt` element), so the `StorageZonesPanel:message` presentation entry was left unchanged rather than edited speculatively. Codex should confirm that is acceptable.
- The selector inside the `WAREHOUSE_MISSING` notice sits in a `role="status"` region, following the existing `LedgerPanelStatus` action pattern. Screen-reader behavior was not verified on devices.
- Finished-goods task pages share `QueryGate`, so they also gain the in-place chooser and the zero-warehouse state. Their existing tests pass, but no FG caller test was added.
