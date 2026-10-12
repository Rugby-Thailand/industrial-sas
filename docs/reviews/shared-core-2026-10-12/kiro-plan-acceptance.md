# Shared-core plan acceptance (Kiro, final)

Plan: `docs/plans/shared-core-navigation-2026-10-12.md` revision 2. Inputs: `/tmp/shared-core-plan-review.md` (B1–B6) and `/tmp/shared-core-codex-audit.md`. This was a read-only check: no repo edits, tests, installs or git changes.

## Verdict: ACCEPT. Implementation may start.

## Blocker disposition

| Blocker                                | Resolution in revision 2                                                                                                                                                                                                                                                                                                       | Status   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| B1 FG has no in-app guard on this base | Decision 1 adopts the guard for JobScan only, as an explicit behavior addition. Dirty = tickets, pending = mutation, discard revokes preview URLs. Other FG editors keep their own dialogs, and wider adoption is a follow-up.                                                                                                 | Resolved |
| B2 base-only defects                   | Decision 2 tests D1–D5, redirected Back and the unchanged-query push red-first.                                                                                                                                                                                                                                                | Resolved |
| B3 metadata repair mechanism           | Decision 3 uses a bounded, idempotent wrapper owned by the shell. It merges metadata on same-URL replace and passes through on cleanup, restoring only methods it still owns. Tests cover StrictMode, remount and retained Next references.                                                                                    | Resolved |
| B4 save→navigate race                  | Decisions 4 and 5: entries live in a synchronous ref. `settle(then?)` cleans its entry and continues only after the buffer traversal. An unexpected history write invalidates the pending removal. No timeouts.                                                                                                                | Resolved |
| B5 single-owner contract               | Decision 4 gives one buffer, one listener set and one prompt. Save is offered only for a sole dirty saveable entry, and pending blocks leaving. With no provider, actions pass through and a dev warning fires. There is no hook-local owner. Decision 5 adds `onNavigationIntent` for payslip cleanup and `isGuardTraversal`. | Resolved |
| B6 HR Back scope                       | Decision 6 covers all 17 headers. Direct opens fall back to an authorized parent or first visible destination, never `/`. Back is hidden only if nothing is reachable. Tests cover HR-only direct-open and loading states.                                                                                                     | Resolved |
| Codex lifecycle defects 1–3            | Decision 8 adds `useOperationLifecycle(scope)` (generation plus lifetime) and `run(action, onSuccess?)`. Post-await effects move into the synchronous `onSuccess`. HR checks the generation as well as equality (A→B→A).                                                                                                       | Resolved |
| Draft-key scope                        | Decision 9 makes no actor-only key migration and drops no drafts.                                                                                                                                                                                                                                                              | Resolved |

The only unassigned file was `src/features/finishedGoods/shared.tsx` `useOperation`. It returns `useAsyncOperation(...)` unchanged (lines 301–306), so the new `run` signature passes through without an edit. If it needs an edit, Codex write agent owns it.

## Non-blocking notes for implementers

1. `run<T>` returns `T | null`. `null` means stale or failed. Callers whose action legitimately resolves `null` must use `onSuccess` rather than the return value.
2. The Back fallback must be evaluated after the HR access query settles. While it is loading, render Back disabled or hidden; do not resolve the fallback to `/`.
3. Tests touching `isWorkspaceHistoryGuardActive` (`StorageLayoutScreens.test`) are shared by both agents. Kiro lands the bridge first; the Codex URL agent then rebases its reader tests.
4. Each agent reviews the other's diff, as plan step 6 states.

## Frozen interface

```ts
// @/lib/navigationGuard (existing import path, single-owner bridge; Kiro)
export function guardedNavigate(action: () => void): void;            // no owner -> runs action
export function onNavigationIntent(listener: () => void): () => void; // only after all guards allow
export function isGuardTraversal(): boolean;                          // true while owner traverses its buffer

// provider module (Kiro)
interface DraftRegistration {
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly discard: () => void;
  readonly save?: () => Promise<boolean>; // offered only as the sole dirty saveable entry
  readonly saveBlockedReason?: string;
}
export function useNavigationDraft(entry: DraftRegistration): {
  readonly requestTransition: (action: () => void) => void;
  readonly settle: (then?: () => void) => void; // sync ref clean; continue after buffer traversal
};
export function useDraftGuard(dirty: boolean, discard: () => void, pending?: boolean): /* settle control */ unknown; // void callers stay valid

// useAsyncOperation (Codex write agent)
run<T>(action: () => Promise<T>, onSuccess?: (value: T) => void): Promise<T | null>;
// action: validation + server call; onSuccess: synchronous, current-only, runs after release
```

## Final file ownership

- **Kiro (Opus 5.5):**
  - `appHistory.ts`, `NavigationProgress.tsx`, `navigationClient.tsx` and the `c-sidebar-2` skip link.
  - Single-owner guard provider and `@/lib/navigationGuard` bridge. `DraftGuardProvider`/`draftGuard`, and deletion of `useWorkspaceNavigationGuard`.
  - Draft adapters, `PageHeader`/`PageBackButton`, and the HR `showBack`/settle/OutcomeGate call sites.
  - JobScan guard and completion callbacks, the FG/storage screen `onSuccess` migrations, `WorkspaceContextBar` routing and `EmployeePayslipsScreen` intent cleanup.
  - The matching tests.
- **Codex write agent:** `useOperationLifecycle` (new, private), `useAsyncOperation`, `useHrWrite`/`useHrClockWrite`, `useRequestIdentity` internals (persistence formats unchanged) and `shared.tsx` `useOperation` if needed, plus their tests. It does not touch screens.
- **Codex URL agent:**
  - `history.ts` no-op fix and the committed-query subscription, which consumes `isGuardTraversal` only.
  - The shared typed catalogue hook and codecs, plus the FG and location catalogue adapters.
  - `useQueryHistoryWriter`, `useWorkspaceQuery`, `useFloorWorkspaceView` and their tests.
  - It does not touch the guard, provider or screens.
- **Root Codex:**
  - Backend audit (report only) and integration review.
  - Commits after review, full checks, desktop and mobile browser checks, and the PR.
- **Untouched:** `useDraftKey`, `convex/**` and the original working tree.

Order: regression fixes → guard owner/settle (publishes the bridge) → URL core ∥ write lifecycle → screen completions/JobScan/HR Back → cleanup and evidence.
