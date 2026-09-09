# Batch storage viewer and partial repacking

Implemented in `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`, for the side-conversation request to view storage or edit a preparation batch with a simpler UI.

## Delivered flow

1. Open an FG product and its preparation batches.
2. Map icon opens batch storage details; eye icon opens a specific unit.
3. Select a unit to inspect its 2D/3D position, building, floor, location and X/Y/Z. Continue storage or the existing move workflow through the contextual action.
4. Pencil icon opens available-unit packing. Stored, reserved, moving and supporting units remain protected.
5. Edit or split the available quantity, enter actual external dimensions and confirm measurements.
6. Review the number of replacements and unchanged quantity, then confirm. The original unit codes remain in history; replacements receive new codes.

Switching Storage/Edit preserves unsaved editor input. Closing the dialog or refreshing discards unsaved local changes; only explicit confirmation writes the repack. A live revision or physical-hold change disables stale edits and asks the user to reopen.

## Data rules

- Selected units must be current, unique, in the same batch, and physically available.
- Physical placement, support-child and active-move records are checked independently of the unit status.
- Retained physical units are not patched. Their IDs, quantities, measurements and placements remain unchanged.
- Selected quantity and full batch quantity are conserved in minor units.
- Replacements start awaiting placement and do not inherit stacking settings.
- Batch revisions store full snapshots including retained units. Command receipts support idempotent retry.
- Existing product, batch, measurement, storage and move handlers were reused; the main thread's stacking files were not edited by this side task.

## Validation

- Full suite: 60 test files, 538 tests passed (`full-tests.log`).
- Added 18 backend integration cases and 12 UI cases covering partial edits, 4→2, physical holds despite stale status, released support, duplicate/foreign/retired IDs, concurrency, immutable history, retry, invalid quantities/dimensions, stale editor state, protected units, viewer permissions, draft preservation and Thai/English accessibility.
- TypeScript and scoped ESLint checks recorded in `typecheck.log` and `lint.log`.
- Live browser: Thai stored-unit 3D/2D viewer, location/action links, partial-edit review for QA-BOX, English labels and editor.
- Mobile 390×844: document width 390, dialog width 358 and scroll width 356; no horizontal overflow in editor or storage view. Temporary viewport restored.
- Browser error log was empty at inspection.
- Existing live QA quantities were left unchanged. Live editing was exercised through review; confirmed writes and replay were exercised in isolated Convex integration tests.
- Production build was not rerun in this side task, to avoid changing build/configuration state while the main thread was working in this worktree.

## Files

- `convex/finishedGoods/batchManagement.ts`: additive read and partial-repack API.
- `src/lib/convex/batchManagementApi.ts`: typed client references.
- `src/features/finishedGoods/BatchManager.tsx`: storage viewer and available-unit editor.
- `src/features/finishedGoods/ProductBatches.tsx`: minimal batch rows, map/pencil/eye actions.
- `tests/integration/finished-goods-batch-management.integration.test.ts`.
- `src/features/finishedGoods/BatchManager.test.tsx`.
- Convex dev generated the API declaration entry automatically.

## Visual evidence

`minimal-design-concept.png` is an imagegen-generated design concept, not a screenshot of the implemented app. Built-in imagegen was used; the complete prompt is saved in `imagegen-prompt.txt`. The generated original is `/Users/macbook/.codex/generated_images/01a07777-073c-7c41-b91b-a0b536425e35/exec-d53215c9-98f9-4d01-a96f-8a2f54838f99.png`.

Actual browser captures: `storage-preview-desktop-th.png`, `storage-preview-mobile-th.png`, `partial-edit-review-desktop-th.png`, `partial-edit-mobile-th.png`, `partial-edit-desktop-en.png`.
