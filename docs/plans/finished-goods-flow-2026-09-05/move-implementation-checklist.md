# Stored pallet moves — implementation checklist

Worktree: `codex/storage-planner`. Scope follows `stored-pallet-move-plan.md`.

## Verification sequence

1. Unit/integration tests: state transitions, source and target occupancy, exactly one active move, idempotency, tenant/warehouse boundaries, ownership, stale revisions, invalid codes, no-op and collision rejection.
2. UI tests: stored entry point, empty/no-fit/read-only/error states, review, pickup acknowledgement, destination verification and placement acknowledgement, server resume, cancellation and verified return.
3. Occupancy tests: duplicate physical pallet counts and overlapping source/target footprint union; both positions still block unrelated operations.
4. Full repository typecheck, lint and tests; production build after changes settle.
5. Live desktop/mobile using dedicated QA pallet P-000005 from FG-PACK-QA-0906. Original source before move: DEMO-BLDG / Floor 1 / สินค้าสำเร็จรูป A / POS-000004, local X 1.2 m, Y 0 m, Z 0 m, rotation 0; quantity 501 pieces; 1.2 × 1 × 1.5 m. Do not relocate the user's P-000001 or modify P-000004 draft.
6. Reserve then cancel before pickup; confirm source remains occupied and target is released.
7. Reposition, try incorrect pallet identification, confirm pickup, refresh, verify destination, confirm actual placement; confirm same pallet identity/quantity and movement history.
8. Start another move, report an issue, verify and return to source; confirm only the target hold is released.
9. Capture desktop/mobile/moving/completed screenshots, browser errors and final test/build logs; show important screenshots inline.

## Delivery constraints

- Working UI uses existing styling and controls; no unselected generated redesign is installed.
- New records belong only to the local development workspace.
- No changes to authentication memberships, paid services or cloud deployments.
- Record known limitations explicitly rather than claiming perfect correctness.
