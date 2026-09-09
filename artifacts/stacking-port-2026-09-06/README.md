# Pallet stacking port — completed 2026-09-06

Current worktree: `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`.
Source: `/Users/macbook/Development/industrial-sas-pallet-stacking`, branch `codex/pallet-stacking`.
App: http://localhost:3100 — existing dev server left running.

## Scope

Pallet-on-pallet stacking only. Unit packaging is authoritative; the product packaging field is a legacy fallback. BOX/OTHER and retired units cannot participate.

**Weight/load rules are deferred at the user's request.** No stacking weight input, maximum supported load field, weight requirement, weight correction or load enforcement was ported. Existing optional measurement weight is preserved. Stacking configuration only writes permission and maximum levels.

A stored lower pallet can opt into supporting another pallet. The server calculates upper Z from the confirmed supporting placement, preserves the root floor/rack ceiling, validates footprint/collision/levels through every ancestor, and reserves the support. Confirmation requires the supporting pallet identity, the upper pallet identity, and acknowledgement of placement. Existing stored uppers use the move workflow. The lower pallet stays locked until upper reservation cancellation or completed movement away; pickup alone does not release it. Return-to-source retains its original support relationship.

## Six tested stages

| Stage | Result | Evidence |
| --- | --- | --- |
| 1. Capture current state | Both dirty worktrees captured; baseline 461 tests passed | state-manifest.json; source/destination-before.tar.gz; source/destination-status.txt; source-feature.patch; stage-1-baseline.log |
| 2. Backend | 42 workflow/move/stack integration tests and typecheck passed | stage-2-tests.log |
| 3. Batch compatibility | 62 FG integration tests and typecheck passed | stage-3-tests.log |
| 4. UI | 189 UI tests; typecheck and lint passed | stage-4-tests.log |
| 5. Combined regression | 491 tests in 58 files; typecheck and lint passed | stage-5-full-check.log |
| 6. Browser, review and fixes | Final 493 tests in 58 files; typecheck, lint and production build passed; desktop/mobile English/Thai inspected | stage-6-final-check.log; stage-6-build.log; PNG screenshots |

`ported-changes.patch` compares this implementation with the stage-1 destination snapshot, including newly added source files. It isolates this port from the destination's pre-existing uncommitted batch work. Source env/database/dependencies and its dev-port change were not copied. Both HEAD hashes and file hashes are in the manifest.

The captured source included an automatic drag-to-stack test without its matching implementation. This port uses explicit pallet-top destination selection and the dedicated stacking screen; the test verifies that supported contract. It does not add automatic drag-based switching between supports.

## Automated cases

- Server-derived stacking height, footprint overhang, clearance and original elevated-surface ceiling.
- Explicit stacking permission; integer level limits; ancestor level limits; one upper pallet per level; cycle guards.
- Concurrent competing reservations: one winner and one refusal, exactly one active support hold; retry replays the same receipt.
- Supporting pallets cannot move or change limits while reserved/stored upper placements hold them.
- Wrong destination/support/upper identities, physical acknowledgement, warehouse scope and authentication.
- Revalidation after changed limits, cancellation, stored-upper moves, pickup and completion, return after interrupted movement.
- Retired/BOX exclusion and unit format precedence over product defaults.
- Defensive batch support locks independent of cached unit status. Repacking becomes possible after all physical holds release.
- 4 → 2 repacking preserves 100 total, creates exactly two active 50-unit replacements, retires the original four and clears replacement stacking settings.
- Existing batch history/idempotency, measurement ownership and product edit regressions remain passing. Stacking preserves optional weight and quantities.
- Empty, permission-restricted, mutation-error, missing-config, pending-save and disabled-confirmation UI states. Accessibility in English/Thai.
- Existing FG, storage, QR, packing and move suite remains green.

Overload checks were intentionally NOT implemented or asserted as supported.

## Live UI evidence

Dedicated existing QA product `BATCH-QA-0906` was used; user TEST001 and other user product quantities were not changed.

1. Its repacked pallet batch began with P-000018 and P-000019, each 50 units; four retired predecessors were absent from the stacking selector.
2. Stored P-000018 on the BULK surface. The UI correctly rejected 2.8 m combined height against that surface's 1.8 m ceiling (`height-blocked-th-desktop.png`).
3. Used the existing verified move flow to put the lower on the 3 m floor surface at X3/Y0. Configured maximum two levels without any weight entry.
4. Previewed P-000019 at server-derived Z1.4 m in 2D/3D. Rotating 90° overhung the lower and disabled reservation. Desktop Thai and mobile English screenshots captured.
5. Reserved on mobile; refreshed the upper page and recovered the reservation. Wrong supporting code P-000001 was rejected; correct support P-000018 accepted. Incorrect upper code P-000018 was rejected; correct P-000019 and simulated placement acknowledgement completed QA storage.
6. Lower page displayed “Move locked — remove the upper pallet first.” No move or stack action was available.
7. Reserved and picked up upper P-000019 for floor X1.2/Y1.2/Z0. A separate browser tab confirmed the lower remained locked in transit.
8. Verified destination POS-000012 and completed the simulated placement. The lower immediately regained Move pallet and Stack on top. Saved locked, in-transit locked, unlocked and moved-upper screenshots.
9. On Thai mobile, selected the now-stored upper via Stack on top. This correctly opened the existing prepared-move flow. Cancelled before pickup; the upper stayed in its floor source and the destination support hold was released.
10. Final product view shows unchanged 210 total: 110 in three existing boxes, and exactly two active pallets of 50 each. Both pallets are now stored independently on the floor. Screenshot: `batch-quantities-unchanged-th.png`.

Both QA browser tabs returned zero error-level console entries. No camera permission/hardware scanner test was performed; code entry and QR payload validation are covered. Physical acknowledgements above were simulated QA actions.

## Review notes

- Reviewed schema/index changes, stack ancestry/locks, reserve/confirm/move/return paths, retired filtering, batch replacement insertion, source/destination compatibility and conditional UI actions.
- Preserved the current shared top-left back-link convention and format-aware box/pallet UI.
- Final UI review clarified the stacking identity button and overhang message; reran the complete suite and production build afterward.
- `git diff --check` passed. Production build used `NEXT_DIST_DIR=.next-build` to preserve the running dev server.
- Screenshots are real browser captures. No generated mockup is presented as implementation evidence.
