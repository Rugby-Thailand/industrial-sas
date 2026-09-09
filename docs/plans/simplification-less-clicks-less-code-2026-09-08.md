# Simplify storage planning: fewer clicks, faster corrections, less code

Date: 2026-09-08  
Target: `codex/storage-planner` in `/Users/macbook/Development/industrial-sas-storage-planner`  
Status: implemented and verified on 2026-09-08; results and limitations: `../../artifacts/ui-simplification-2026-09-08/results.md`. Runtime timing/profile targets were not measured; overall production source grew by98 lines while shared packing scope shrank by1.

## Outcome

Let users see the next action, correct the relevant value in context, and reserve an exact position without repeating the same review. Reduce duplicated UI implementation while retaining the existing FG, batch, storage, move, and stacking rules.

“Faster” means fewer required interactions and lower measured task time. Runtime performance improvements require profiling; none are claimed yet. This review used current source and existing manual/QA evidence, not a new live-browser test run.

## What already works — retain it

- Placement is already editable directly, with shared 2D/3D controls and calculated stacking Z.
- The first candidate is already selected. Do not add another automatic-selection mechanism.
- Catalogue search, filters, tab, and presentation preferences are already remembered.
- Exact-unit correction links, batch editor state preservation, and bulk dimension copying already exist in parts of the flow. Extend coverage rather than rebuild them.
- `PlacementEditor`, `PalletScene`, `DestinationScanner`, packing arithmetic, and packing validation are already shared.
- Reservations and physical placement are separate. Cancellation and physical return have different effects.

## Priorities and interaction targets

| Priority | Change | Current evidence | Target |
| --- | --- | --- | --- |
| 1 | Reserve directly from the placement summary | Placement button opens a review dialog containing another reserve action | After adjusting a valid position: **2 clicks → 1 click** to reserve |
| 2 | Correct the selected unit without losing the destination work | Exact-unit correction routes exist; coverage and restoration differ between screens | One correction entry action; retain valid destination, coordinates, and view on return |
| 3 | Present the next useful action directly in unit lists | Action availability depends on unit state and screen | Avoid opening a detail page solely to find an action; measure each affected route first |
| 4 | Reuse the destination picker for storage and moves | `Recommendations` and `MoveSelection` independently assemble and filter destination lists | One picker, consistent search, existing store/move rules retained |
| 5 | Reuse packing row controls | `PackingScreen` and `BatchManager.AvailableEditor` repeat editable row and conversion concerns | One implementation of common row fields and draft conversion, with distinct save commands |
| 6 | Remove measured rendering or query waste | No fresh performance profile yet | Optimize the observed bottleneck; do not add speculative caching or dependencies |

The correction and list-action targets must be compared against recorded baseline flows before implementation. Already-direct paths should not be redesigned merely to claim improvement.

## Stage 1 — Capture a small, repeatable baseline

1. Record branch, working-tree changes, and existing checks. Preserve the current dirty worktree and batch implementation.
2. Use the same test units to record: create and pack, correct dimensions, choose storage, reserve and confirm, move, stack, and repack 4 → 2.
3. Count button/link activations from a defined starting screen to a defined result. Record typing and QR verification separately; do not hide these interactions in the totals.
4. Capture desktop and mobile screenshots in Thai and English. Record task duration over repeated runs under the same conditions.
5. Profile the destination page and drag interaction before deciding on performance work. Note requests, render work, and responsiveness.

Gate: baseline scenarios and screenshots exist; distinguish pre-existing failures from regressions.

## Stage 2 — One visible review, one reservation action

Keep the destination summary next to the preview. Always show the selected unit, building, floor, named location, exact X/Y/Z, orientation, and fit result. For a move, show both origin and destination. For a stack, show the supporting pallet and resulting height.

Replace the repeated review modal with `Reserve this position` / `จองตำแหน่งนี้`. The action uses the existing reservation mutation and busy/error handling. Keep manual move reasons and any required suitability acknowledgement in the visible summary before enabling reservation.

Invalid positions remain visible with the reason and a disabled reservation action. Unknown storage conditions must not be presented as a verified match. Preserve the current backend candidate ordering; do not relabel it as a globally optimal or shortest-travel recommendation.

After reservation, display identity verification and physical-placement confirmation clearly. If verification currently requires an extra entry dialog, evaluate embedding the existing scanner component in the reserved state. Starting a camera remains an explicit action. Scanning must never confirm physical placement automatically.

Gate: valid reservation, invalid geometry, double click, stale availability, failed request/retry, and refresh pass. QR checks and explicit physical confirmation remain required where applicable.

## Stage 3 — Corrections beside the data

- Place a small edit action beside editable dimensions and the location selection. Use a tooltip and accessible name for icon actions; retain text on the primary next action.
- Reuse the existing exact-unit correction route/editor. Preserve the selected destination, valid coordinates, view, and list context across the correction round trip.
- Revalidate after correction. Keep an invalid draft visible with an explanation instead of silently resetting it to a different position.
- Treat changing where a stored unit is placed as a move. Do not bypass move rules with a generic location edit.
- Keep master location geometry/name edits in their existing authorized editor, with a return path to the affected unit. Geometry changes must respect existing occupancy and locks.
- If repacking replaces unit IDs, follow the returned replacement records. Never attach old reservations or placements to a replacement by inference.
- Audit unit list actions by state: measure, choose storage, continue reservation/move, or move stored unit. Reuse existing actions wherever already available.

Gate: exact-unit editing, unsaved navigation, refresh, changed dimensions, replacement IDs, stored-unit restrictions, and read-only permissions pass. Returning to a list restores its context.

## Stage 4 — Remove duplicated UI code

Make these extractions only after the interaction behavior is settled:

| Source | Proposed change | Boundary to preserve |
| --- | --- | --- |
| `PalletScreens.tsx: Recommendations` and `MoveScreen.tsx: MoveSelection` | Shared destination picker and search normalization | Separate recommendation queries and store/move eligibility |
| Exported `PlacementEditor` inside `PalletScreens.tsx` | Move the existing component into its own module and remove the redundant review UI | Existing reserve/reserveMove mutations, geometry, support resolution, error handling |
| `PackingScreen.tsx` and `BatchManager.tsx: AvailableEditor` | Shared packing row fields, draft conversion, and applicable validation presentation | Create versus repack commands; revision, unit-ID, and quantity checks |
| Repeated unit action decisions | Small typed state-to-action helper if inspection confirms duplication | Permissions, support locks, active reservations, and move state |

Avoid a universal workflow framework or a large component controlled by many mode flags. Reuse existing packing functions rather than introducing new arithmetic. Splitting a file alone is not a code reduction.

Inspection baseline: `PalletScreens.tsx` 1,984 lines; `PackingScreen.tsx` 1,453; `BatchManager.tsx` 790; `MoveScreen.tsx` 887; `StackScreen.tsx` 438 — 5,552 lines total. These sizes identify review scope, not how much is duplicate.

Measure net production lines across both original and newly introduced files. Require a documented net reduction for the consolidation work, with no deletion of meaningful tests to achieve it. Do not set an arbitrary percentage before extracting the actual duplication.

Gate: no lost behavior or route changes; focused component/domain tests and type checking pass after each extraction. Existing deep links continue to work.

## Stage 5 — Optimize measured delays

Investigate repeated scene calculations, avoidable query work, and unnecessary rerenders during editing. Change only bottlenecks demonstrated by the baseline profile. Keep lightweight input updates immediate and retain clear pending feedback for network actions.

Do not cache availability or locks as authoritative data. The server must revalidate reservations and confirmations against current state. Avoid virtualization, new state libraries, or a new renderer unless measurement justifies the complexity.

Gate: compare the same tasks before/after. Report observed latency and interaction counts, including tradeoffs; avoid unsupported speed claims.

## Stage 6 — Combined verification and evidence

After each stage: implement → run focused tests → inspect UI → review code → fix → rerun affected tests. Before completion, run `pnpm check` and `pnpm build`, then inspect the production result as well as the app on port **3100**.

Required cases:

- Normal creation, packing, measurement, recommendation, reservation, verification, and placement.
- Blank/invalid inputs, no units, no suitable locations, unknown storage conditions, server errors, and permission failures.
- Collision, overhang, small support, maximum level, and total stacking height. Weight/load enforcement remains **out of scope**; retain existing measured weight data without adding load rules.
- Wrong QR, simultaneous reservations, duplicate submission, stale drafts, refresh/retry, back navigation, cancellation, and actual return.
- Supporting pallet remains locked while an upper unit or its reservation depends on it. Moving the upper away releases the lock only when the existing workflow permits it.
- Repack 4 → 2 produces exactly two active units. Retired units stay excluded; repacking cannot alter a stack or locked reservation. Product quantities remain unchanged by stacking or moving.
- Thai/English, desktop/mobile, keyboard focus, icon accessible names, and long labels. Explicitly distinguish viewport emulation from actual touch/camera testing.

Save before/after screenshots, short videos per changed functionality, interaction counts, test results, and known limitations under `artifacts/ui-simplification-2026-09-08/`. Update the full manual and recommendation highlight only after the flow is stable.

## Recommended first delivery

Complete Stages 1–2 first: capture the baseline, then remove the repeated reservation review. It gives a specific one-click reduction with a small UI change. Next improve correction round trips and consolidate the duplicated destination and packing UI. Leave broader navigation redesign and backend rewrites outside this plan.
