# Review: docs/plans/shared-core-navigation-2026-10-12.md

Base: worktree `industrial-sas-shared-core-20261012` at `a050a851` (clean apart from the untracked plan). Read-only review; no repo edits, installs or test runs.

## Verdict: REVISE

The direction is right: one guard owner, a shared URL-state core, narrow write primitives, and a backend audit only. But six findings block implementation. The plan describes the dirty tree, not this base. It leaves the save→navigate ordering and the single-owner contract unspecified, and it omits base-only defects. Each is fixable in the plan text. No redesign is needed.

## What I checked (on this base)

- Guard: `src/features/storageLayouts/useWorkspaceNavigationGuard.tsx`, `src/lib/navigationGuard.ts`, `src/components/providers/{DraftGuardProvider.tsx,draftGuard.ts}`, all `useDraftGuard`/`registerTransitionGuard`/`guardedNavigate`/`isWorkspaceHistoryGuardActive` callers.
- History and progress: `src/components/system/NavigationProgress.tsx`, `src/i18n/navigationClient.tsx`, `src/lib/browser/{appHistory,history}.ts`, `src/components/ui/{PageBackButton,PageHeader}.tsx`, `src/components/examples/c-sidebar-2.tsx` (the only shell, mounted by `(desktop)/layout.tsx`), `HrLandingRedirect.tsx`.
- Next 16.3.8 `client/components/app-router.js`:
  - `HistoryUpdater` is a `useInsertionEffect`. It drops custom state unless `preserveCustomHistoryState`, and it calls `replaceState` for a same-URL push.
  - The patched `pushState`/`replaceState` are installed in a `Router` `useEffect` that captures the then-current functions.
  - `popstate` returns on `!event.state` and reloads on `!event.state.__NA`.
- URL state: `useCatalogueState.ts` (FG), `useLocationCatalogueState.ts`, `useQueryHistoryWriter.ts`, `useWorkspaceQuery.ts`, `useFloorWorkspaceView.ts`.
- Writes: `useAsyncOperation.ts`, `useRequestIdentity.ts`, `useDraftKey.ts`, FG `useOperation`, `features/hr/useHrWrite.ts` (`useHrWrite`, `useHrClockWrite`), `convex/lib/idempotency.ts` (org-scoped index `by_orgId_operation_requestId`).
- Not checked: the dirty tree's newer `src/components/system/useNavigationGuard.tsx` (by instruction), Codex-side backend flows beyond the idempotency index, any runtime or browser behavior.

## Blocking findings

### B1. Finished goods has no in-app guard on this base, so "behavior-preserving" is not the whole story

`JobScanScreen` (:141), `ProductScreen` (:271), `PalletScreens` (:312) and `BatchManager` (:93) use only `useUnsavedWarning`, which is `beforeunload`. Prior defect 2 (scan dirty-ticket Back → Discard) and the L1 callers (`useDraftGuard(..., op.busy)` in Product/Pallet/Periods) exist only in the dirty tree. "Migrate scan/finished goods callers" therefore adds a new in-app prompt.

Product and Batch already have their own leave dialogs (`ProductScreen.tsx:495` `setCancel(true)`, `BatchManager.tsx:232` `pendingHref`), so adopting the guard naively double-prompts.

Required: an explicit scope decision recorded in the plan. Recommendation:

- Adopt the guard for JobScan only. Dirty = `tickets.length > 0`; pending = `operation.busy`; discard clears tickets and revokes preview URLs.
- Do it in its own commit, flagged as a behavior addition.
- Leave Product, Pallet and Batch on their current dialogs and `beforeunload`, as a documented follow-up.

### B2. Base-only navigation defects are missing from commit 1

The prior README's fix #3 says it builds on "earlier pending improvements already present in the working tree". Those improvements are not on this base. Present here:

- D1, stale history destination. `NavigationProgress.tsx`: `historyPending = dest !== null && dest !== pathname`, and `prepare()` never clears `historyDestination`. Link A→B, Back to A, then Link to C leaves the loader up.
- D2, same-URL replace drops `appNavigationIndex`. The index is written only in an effect keyed on `[pathname, locationKey]`, which does not change on a same-URL refresh.
- D3, the same replace drops `__storageWorkspaceGuard` from the buffer entry. `onPopState` then never matches `restoring`, and `removeBuffer` is deferred forever.
- D4, skip link `href="#main-content"` (`c-sidebar-2.tsx`): a null-state fragment entry, plus the progress provider waiting on a pathname that Next will not traverse.
- D5, `navigationClient.useRouter` runs every push/replace in the provider transition, so query-only `useGuardedUrl` selections blank the page.
- Prior #4, `updateBrowserQuery` pushes even when the URL is unchanged.

Required: list D1–D5 and #4 explicitly as red-first tests in commit 1. Redirected Back (#3) is a variant of D1 and must be written against this base's provider, not the wt one.

### B3. No mechanism for repairing history metadata after Next's same-URL replace

"Centralize actual history depth/metadata tracking" is undecided. The previous fix (`trackedReplace`) wrapped `history.replaceState`.

On this base, a wrapper must coexist with Next's patch:

- Next's `Router` `useEffect` binds whatever `pushState`/`replaceState` exist at that moment.
- Descendant layout effects run first, so Next ends up wrapping ours.
- On a Next effect cleanup (StrictMode, remount), Next restores "original", which is our wrapper. If our provider has unmounted by then, a stale wrapper stays installed.

That is the "blanket global" the constraints forbid, unless it is bounded.

Required: choose and document one mechanism.

- Preferred, no patching:
  - The owner re-stamps on its own events. On `popstate`, treat a same-URL entry that lost its marker as the buffer while `buffered` is set (the audit's "self-sufficient guard" option).
  - Write `appNavigationIndex` from a layout effect that runs on every router commit, including same-URL refreshes. I did not verify that the shell provider re-renders on a same-URL refresh. `usePathname` and `useSearchParams` may be referentially stable, so a commit signal that changes on refresh must be found first, or the fallback below used.
- If wrapping is unavoidable:
  - Install once and idempotently.
  - Merge only `APP_HISTORY_KEY` and the guard key, and only when the URL is unchanged.
  - Never uninstall while Next holds a reference; leave a pass-through instead.
  - Cover StrictMode double-mount and provider remount with tests.

### B4. Save→navigate ordering is a real race on this base, and the plan gives no mechanism

- `PeriodsScreen.tsx:220-227`: `write.submit` resolves SAVED, then `router.push` runs at once. The provider still holds `pending=true` from the last render, because the entry map updates over child layout effect → `setDrafts` → provider render → layout effect.
- On the next commit, `removeBuffer()` calls `history.back()` while Next's push is being committed. This is the audit's L1, which is reachable here through HR.
- The same lag affects `guardedNavigate` called right after an await: the guard reads stale `latest.current` and shows the "still being sent" prompt instead of navigating.

Required: specify the ordering contract, with no timeouts.

- Entries live in a ref, which is the synchronous source of truth, and are mirrored to state only for rendering.
- Registration returns `settle(then?)`. It marks the entry clean in the ref at once. If no other entry is dirty or pending, it removes the buffer and runs `then` from the buffer's `popstate`. Otherwise it runs `then` through the normal prompt.
- Write callers that navigate after success (`PeriodsScreen` create, and JobScan after save if B1 is adopted) call `settle(() => router.push(...))` instead of a raw `router.push`.
- Prompt Save/Discard use the same path. Today they call `removeBuffer(prompt.action)`, which is already ordered; keep that.
- The buffer state machine must also cover a history write that lands before the buffer `popstate`, so `removing` cannot stick. On any owner-observed push or commit while `removing`, abort the removal by re-arming or dropping the buffer, and run the pending action once.
- Test with production ordering: a real hook plus the provider, the write resolving inside `act`, and Back from the destination. Confirm it in the browser, because jsdom cancels queued traversals differently.

### B5. The single-owner contract is unspecified for real callers

| Concern                      | Today on this base                                                                                                                                                   | Must be decided                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple entries with `save` | Storage workspace passes `save` and `saveBlockedReason`; HR entries have none                                                                                        | Offer "Save and continue" only when exactly one dirty entry has `save` and no other dirty entry exists. Otherwise offer Discard (all non-pending) or Keep editing. `saveBlockedReason` comes from that entry.                                                                                                                                                                                                           |
| Multiple guards              | Each hook instance pushes its own buffer and listener. `guardedNavigate` chains guards in `reduceRight` order, so two dirty guards mean two dialogs and two buffers. | One buffer, one listener set, one prompt. Delete the per-instance listeners.                                                                                                                                                                                                                                                                                                                                            |
| Non-guard registry consumer  | `EmployeePayslipsScreen.tsx:270` registers a "guard" that clears sensitive payslip state and always allows. `GlobalSearch.test.tsx:234` does the same.               | Split it into `onNavigationIntent(listener)`, which is invoked only after all guards allow. Migrate the payslip screen. The payslip screen's own click, `popstate`, `pagehide` and `visibilitychange` listeners stay; they are sensitive-data hygiene, not guarding.                                                                                                                                                    |
| Provider absence             | Storage hook works standalone (`useWorkspaceNavigationGuard.test.tsx`, `StorageLayoutScreens.test.tsx`). HR `useDraftGuard` is a no-op without the provider.         | Production has one shell (`(desktop)/layout.tsx` → `c-sidebar-2`), so absence happens only in tests and in `(auth)`/`(public)`. Rule: without an owner, registration is a no-op, `requestTransition`/`guardedNavigate` run the action directly, and a dev-only `console.error` fires once if dirty. Migrate the storage tests to wrap the provider. Do not keep a hook-local fallback owner; that recreates two owners. |
| Traversal signal             | `isWorkspaceHistoryGuardActive()` is read by `useWorkspaceQuery` and `StorageLayoutScreens.test`                                                                     | Owner exports `isGuardTraversal()`. Codex's committed-query subscription (commit 3) consumes it. Other modules do not import storage.                                                                                                                                                                                                                                                                                   |
| Same-path click              | `onClick` ignores same path+search, so Next refreshes and D3 follows                                                                                                 | Keep it unintercepted, but rely on the B3 re-stamp. Test it as R1.                                                                                                                                                                                                                                                                                                                                                      |
| Locale                       | Click handler strips the locale prefix and pushes with `{locale}`                                                                                                    | Keep, and test `/th` ↔ `/en`.                                                                                                                                                                                                                                                                                                                                                                                           |

### B6. HR Back restoration has no page list or fallback rule

This base has 17 HR `showBack={false}` headers. Among them are Leave, LeaveReview, Announcements, Notifications, AnnouncementManage and PayslipImport, which the README's 9 do not cover.

`PageHeader` falls back to `"/"`. For an HR-only member, `"/"` is a planner path. `HrLandingRedirect` then `router.replace`s to the first HR item, so Back on a directly opened Today page flashes and returns to Today.

Required:

- An explicit page list.
- A fallback rule: a top-level page opened at index 0 either hides Back or falls back to the first visible HR destination other than itself.
- A test for an HR-only member opening a page directly.

## Non-blocking corrections

1. **URL state (commit 3).**
   - Both hooks seed the fallback once (`useState`/`useRef`) and never reset it when `viewKey`/`key` changes. That confirms the plan's reset item.
   - `useLocationCatalogueState.update` diffs against the render-time `state`. FG re-reads `getSnapshot()`. The shared core must re-read the snapshot.
   - Encodings differ: `fg=<serialized>` versus `locations=<JSON>`. Keep the codecs per feature and keep the preference keys and migrations unchanged.
   - `useQueryHistoryWriter` ends typing only on `popstate`. Keep that behavior in the core.
   - `useFloorWorkspaceView` and `useWorkspaceQuery` should use the same committed subscription, filtered by `isGuardTraversal()`. Today only `useWorkspaceQuery` filters, so catalogue snapshots can read buffer URLs.
2. **Write lifecycle (commit 4). Scope it down.**
   - `useAsyncOperation` returns stale successes and resets on scope change in an effect, which leaves one stale frame. `useHrWrite` derives state during render.
   - "Suppress stale success" does not stop side effects inside `action`, because several callers `router.push` inside it. Return `null` when not current and move post-success navigation out of `action`, where it checks the result and goes through `settle`.
   - Request-ID storage differs and should stay separate, per "keep persistence choices":
     - FG uses localStorage `fg-requests:<scope>`, a map per scope, and a UUID regex.
     - HR uses sessionStorage, one ID per key, and `ID_PATTERN`.
     - Clock uses a strict descriptor plus a tab-local fallback.
   - The only primitive that plausibly has two real callers is the generation/current check. If it deletes no caller code, extract nothing. Write the decision into the plan.
3. **Org scoping.**
   - `useDraftKey` is actor-only (`<scope>:<userId>`).
   - FG request IDs are de facto warehouse-scoped, and backend idempotency is org-scoped. A cross-org reuse is therefore FRESH, not a cross-tenant replay; there is no corruption.
   - Before changing keys, inventory the `useDraftKey` consumers whose persisted payload is not warehouse/org keyed: `fg-product`, `fg-measure`, `fg-destinations`, `fg-move*`, `stack`, `batch-available`, `fg-batch-packing`, `batches`, `fg-catalogue`.
   - Dropping legacy actor-only drafts is user-visible data loss, so state it in the PR.
   - HR (`identityKey = org:actor:employee`) and the clock recovery are already correct. Do not touch the `clockFallback` module variable or `clearHrClockRecoveryExcept`.
4. **Scope switching.** `WorkspaceContextBar.selectWarehouse` bypasses the guard. It is shown only on the exact `/finished-goods` and `/storage-layouts` roots, so exposure is low. Either route it through `guardedNavigate` or document it as out of scope. Clerk org switching is out of scope; it resets identity-keyed state.
5. **Backend (commit 5).** `tenantFunctions`, `writeEnvelope` and `idempotency` are the seam. Keep the audit report-only unless a defect is reproduced in a flow this PR touches.
6. **Commit 6.** "Kiro reviews its [Codex's] frontend changes": the ownership sentence is ambiguous. Each agent should review the other's diff.

## Refined commit plan

Each commit leaves code working, with relevant tests green and red-first evidence noted in its message.

1. **`history.ts` no-op push (Codex).** `updateBrowserQuery` replaces when the URL is unchanged. Covers prior #4, with tests in `history.test.ts`.
2. **Progress and history defects (Kiro).**
   - D1: clear `historyDestination` in `prepare()` and on commit, and let a newer navigation supersede it.
   - D4: no destination when `!event.state?.__NA`, and the skip link focuses `<main>` with `preventDefault`.
   - D5: the locale router bypasses the provider transition when the target pathname equals the current one, so only pathname changes show the cover.
   - D2: index repair via the B3 mechanism.
   - Tests: `NavigationProgress.test.tsx`, `PageBackButton.test.tsx`, `c-sidebar-2.test.tsx`.
3. **Single guard owner (Kiro).**
   - New `src/components/navigation/NavigationGuardProvider.tsx` and `src/lib/navigation/guard.ts` (bridge, `onNavigationIntent`, `isGuardTraversal`).
   - `DraftGuardProvider` becomes the owner. `useDraftGuard` keeps its signature; it is used by about 20 HR call sites.
   - Storage `BuildingWorkspace` registers through the provider with `save`/`saveBlockedReason`.
   - Remove `useWorkspaceNavigationGuard` and the storage-local `activeHistoryGuards`.
   - Implements the B3 re-stamp (fixes D3), the B4 `settle`, the B5 rules, and payslip `onNavigationIntent`.
   - Tests: a real provider with jsdom Back/Forward for R1, StrictMode, two entries, save failure retention, a pending lock, Keep editing, and locale.
4. **Write→navigate ordering (Kiro, with a Codex review).** `PeriodsScreen` create, plus any other post-write `router.push` under a guard, goes through `settle`. Includes a race test and browser confirmation.
5. **Committed query subscription and typed URL state (Codex).**
   - `subscribeCommittedQuery` uses `isGuardTraversal()`.
   - `useUrlState(codec, key)` handles snapshot, baseline pin, no-op detection, typing history and fallback reset on key change.
   - Migrate FG catalogue, location catalogue, `useWorkspaceQuery` and `useFloorWorkspaceView`. Preference keys and query encodings stay unchanged.
6. **Write lifecycle (Codex), minimal.** Only `current()`/generation and stale-success suppression in `useAsyncOperation`, plus render-derived scope reset. Move post-success navigation out of `action`. `useHrWrite`/`useHrClockWrite` semantics stay unchanged. Extract shared code only if it deletes duplicated caller logic.
7. **JobScan guard adoption (Kiro), gated on the B1 decision.** Behavior addition: a dirty-ticket prompt, the scan Back→Discard regression, mobile.
8. **HR Back (Kiro).** The B6 page list and fallback rule, with tests.
9. **Org-scoped FG draft keys (Codex), gated on the inventory in non-blocking item 3.** Legacy actor-only keys are ignored, not imported.
10. **Cleanup, docs and verification (both).**
    - Ownership and invariants documentation.
    - Format, typecheck, lint and scoped tests, then the full checks.
    - Local production browser scenarios: active-scan-menu Back ×5; Keep editing and Discard on desktop and at 390×844; save→navigate→Back; HR-only direct-open Back; account switch.
    - No production data. Builds and timings run without concurrent test load.
    - Cross-review, then the PR.

## File ownership (no concurrent edits to the same file)

| Kiro (claude-opus-5.5)                                                                                                                        | Codex                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/system/NavigationProgress.tsx`, `src/i18n/navigationClient.tsx`, `src/lib/browser/appHistory.ts`                              | `src/lib/browser/history.ts`, `src/hooks/useQueryHistoryWriter.ts`                                                                                                                              |
| `src/lib/navigationGuard.ts` → `src/lib/navigation/guard.ts`, new provider, `src/components/providers/{DraftGuardProvider.tsx,draftGuard.ts}` | `src/features/finishedGoods/useCatalogueState.ts`, `src/features/storageLayouts/useLocationCatalogueState.ts`, `useWorkspaceQuery.ts`, `src/components/storageLayouts/useFloorWorkspaceView.ts` |
| `src/features/storageLayouts/useWorkspaceNavigationGuard.tsx` (delete) plus the guard block in `StorageLayoutScreens.tsx` (~:960-1000 only)   | `src/hooks/{useAsyncOperation,useRequestIdentity,useDraftKey}.ts`, `src/features/finishedGoods/shared.tsx` (`useOperation`)                                                                     |
| `src/components/ui/{PageBackButton,PageHeader}.tsx`, `src/components/examples/c-sidebar-2.tsx`                                                | `src/features/hr/useHrWrite.ts` (read and audit; edit only if commit 6 proves duplication)                                                                                                      |
| HR screens: `showBack` and `settle` call sites; `EmployeePayslipsScreen.tsx` registration                                                     | `convex/**` (audit only)                                                                                                                                                                        |
| `JobScanScreen.tsx` guard wiring (commit 7)                                                                                                   | FG screens' `useOperation`/post-success navigation (commit 6). Coordinate with Kiro on `JobScanScreen.tsx` by landing commit 6 before commit 7.                                                 |

Interface frozen before parallel work. Kiro publishes it in commit 3; Codex commit 5 depends only on `isGuardTraversal`.

```ts
// src/lib/navigation/guard.ts
export type Transition = () => void;
export interface DraftRegistration {
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly discard: () => void;
  readonly save?: () => Promise<boolean>; // offered only when it is the sole dirty entry
  readonly saveBlockedReason?: string;
}
export function guardedNavigate(action: Transition): void; // no owner -> runs action
export function onNavigationIntent(listener: () => void): () => void; // after all guards allow
export function isGuardTraversal(): boolean; // true while the owner traverses its buffer

// provider module
export function useNavigationDraft(entry: DraftRegistration): {
  readonly requestTransition: (action: Transition) => void;
  readonly settle: (then?: Transition) => void; // sync-clean in ref, then run after buffer removal
};
export function useDraftGuard(
  dirty: boolean,
  discard: () => void,
  pending?: boolean,
): void; // unchanged adapter
```

Neither agent commits or pushes without the root agent's review. The open decisions for the root agent are B1 (whether JobScan adopts the guard), B6 (the HR page list and fallback) and non-blocking item 3 (the FG key inventory). Resolve them in the plan before commit 3 starts.
