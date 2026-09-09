# Finished-goods inventory worktree: selective reuse review

Reviewed: 2026-09-06. Scope: inspect donor implementation and identify reusable logic for the proposed packing-and-measurement flow. No application code imported in this review.

## Worktrees

- Current running planner: `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`.
- Donor: `/Users/macbook/Development/industrial-sas-finished-goods-inventory`, branch `codex/finished-goods-inventory`.
- Both currently point to commit `183557c7689f8c22e2bfe311b1a4d30d47b8185e`. Their feature implementations are working-tree changes, including untracked files. A branch merge or cherry-pick of HEAD would not transfer these features.
- Read actual donor files; preserve both worktrees' existing uncommitted changes.

## Recommended imports and adaptations

| Priority | Donor source | Reuse | Required adaptation |
| --- | --- | --- | --- |
| 1 | `convex/model/finishedGoods/packing.ts` and `packing.test.ts` | Pure package splitting, allocation conservation, positive quantity/dimension checks, optional weight, measurement acknowledgement, 50-package transaction bound. | Donor quantities are integer thousandths; current pallet quantities are display-unit numbers. Introduce an explicit quantity boundary rather than copying numbers directly. Map donor `depthMm` to current `lengthMm`. Retain current 100,000 mm dimension limit instead of donor 1,000,000 mm. |
| 1 | `convex/model/uom/quantity.ts` and its small model dependencies | Exact decimal parsing/formatting and integer arithmetic for batch allocation. | This helper was removed from the planner extraction. Restore only the needed dependency closure, with its tests. Define unit precision explicitly: the donor permits three decimal places even for PCS, while our proposed whole-piece splits must remain integral. |
| 2 | `src/features/finishedGoods/CreateFgWizard.tsx` | Two-step state, editable/addable/removable package rows, allocated/remaining totals, validation gating, preserving identical request payload on uncertain retry. | Extract state behavior into our existing UI and shared viewer. Donor draft state and pending request live only in memory; keep current actor/warehouse-scoped draft and retry persistence, and extend it to batches. Add selected-row editing, confirmed replacement, mobile cards and explicit copied-measurement acknowledgement. |
| 3 | `convex/finishedGoods/receipts.ts:createReceipt` | Validate everything before writes, reuse product identity, create a batch and all its packages atomically, fingerprint request payload, replay success and reject conflicting retries. | Implement against `finishedGoodsProducts` and `finishedGoodsPallets`, adding a batch relation. Donor directly requires customers, staging, handling units, lots, putaway tasks and the inventory ledger. Do not copy its mutation wholesale into the extracted planner. |
| 4 | `convex/finishedGoods/receipts.ts:receiptDetail/listReceipts` | Batch stored/pending quantities, partial completion status, next pending package identity. | Derive progress from current pallet/placement statuses and use the existing exact-placement flow for each pallet. Retain independent completion when other pallets have no fitting position. |
| 5 | `convex/finishedGoods/putaway.ts:updateMeasurements` | Expected-version check and invalidation of a previously prepared choice when measurements change. | Add optimistic version protection to current measurement edits if needed; preserve current reservation/stored edit guards. Current reservation already checks measurement freshness. |
| Later | `convex/finishedGoods/labels.ts` | Stable pallet label identity, initial print versus explicit reprint, idempotency, label actions that do not move stock. | Donor depends on handling units, label templates/jobs and print permissions. Reuse only if printed pallet labels enter the next scope; keep current fixed-square location QR presentation. |

## Important differences to resolve

1. **Split modes differ.** Donor `splitPackages(total, perPackage)` fills packages to a target quantity, with a final remainder. Example: 1,001 pieces at 500 per pallet produces 500 + 500 + 1. Our planned “Equal split into two pallets” must produce 501 + 500. Keep the donor helper for “quantity per pallet” and implement a separate equal-count split.
2. **Copied dimensions need explicit confirmation.** Donor auto-generated full rows start checked when their quantity matches the template quantity. Our proposed flow requires copied measurements to be clearly identified and confirmed; do not copy this default.
3. **Refresh recovery is additional work.** Donor preserves state when moving between wizard steps and retries identical requests while mounted. It does not persist the wizard draft or pending payload across a reload.
4. **Creation has different inventory meaning.** Donor creates AVAILABLE inventory in staging through a production-receipt ledger transaction. The current planner creates planning records and marks physical storage only after destination verification and confirmation. Porting the ledger would be a separate inventory expansion, not a prerequisite for multi-pallet packing.
5. **The donor is not an exact placement engine.** `putaway.ts` ranks locations/areas or predefined positions with envelope checks and customer/product affinity. Its confirm API accepts a location ID, not a pallet's local X/Y/Z and orientation. Its `fitsEnvelope` helper cannot replace our occupancy-aware `firstFit`/`placementError` logic.
6. **Do not overwrite schema, permissions, API bindings or translations.** Both implementations use different tables, routes, permission codes and models. Add specific fields/functions/messages to the current architecture.

## Preserve from the current planner

- Exact local X/Y/Z placement and orientation, support elevations, occupancy/reservation collision checks and reserved floor exclusions.
- Atomic reservations and replacement, destination verification per operator, and explicit confirmation of physical storage.
- Building/floor/zone edit protection when space is occupied.
- Current authentication/tenant boundaries, actor-scoped draft recovery, request persistence, shared 2D/3D controls and scanner lifecycle handling.
- User-requested compact header controls, removed organization label, transparent search/filter row and stable QR backgrounds.

## Implementation sequence

1. Adapt and test the pure quantity/allocation model, including whole-unit and decimal-unit rules, both split modes and shared dimension limits.
2. Add a batch draft and selected-pallet packing UI on top of current product screens and viewer; persist draft and pending submission payload across refresh.
3. Add one idempotent atomic batch-creation operation using current products/pallets, preserving existing single-pallet records.
4. Add batch progress and a next-pallet queue that enters current exact-placement screens.
5. Port relevant donor test scenarios, then test current auth, retry/reload, mobile, reservation conflicts, partial no-fit and the entire creation-to-storage flow.

## Verification performed

Executed in the donor worktree:

```sh
pnpm exec vitest run convex/model/finishedGoods/packing.test.ts src/features/finishedGoods/CreateFgWizard.test.tsx tests/integration/finished-goods.integration.test.ts
```

Result: **3 test files passed, 20 tests passed** (2.60 seconds).

These cover quantity conservation, remainder handling, invalid/unchecked measurements, wizard navigation, identical uncertain retries, receipt/product reuse, ledger rollback, tenant/warehouse boundaries, destination revalidation, confirmation ownership and idempotent labels/stock movement. This was a targeted donor test run, not a fresh full-app/browser certification or proof that a port will pass unchanged.

No application behavior, database data or running dev servers were changed by this review.
