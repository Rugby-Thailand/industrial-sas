# Preparation batches — implementation and QA

Date: 2026-09-06. Worktree: `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`.

The requested plan is saved in `docs/plans/preparation-batches-2026-09-06/user-plan.md`.

## Delivered behavior

- FG stores product metadata. Quantity, format, lot, splitting, and actual outer dimensions belong to a preparation batch.
- Server drafts accept incomplete measurements and create no storage units. Each batch has optimistic revisions and durable, idempotent write receipts.
- An unreserved batch can be repacked in place while preserving its total. Replaced units are retired and remain in revision history. Reserved, stored, moving, and physically held units prevent repacking.
- One SKU supports independent batches. Explicit new-batch URLs keep new work separate from recovery of an earlier operation.
- Every unit must have a positive allocated quantity, valid outside dimensions, and a measurement acknowledgement before commit. Changed quantity invalidates that acknowledgement. Copied measurements require acknowledgement per target unit.
- Metres/centimetres preserve canonical millimetres. The same saved dimensions are used in the scene, recommendation, reservation, put-away, and move workflow.
- Product cards, tables, and batch details show actual active totals and format-aware unit names. Legacy units are individually identified; cancellation requires a reason and an exact before/after review.
- Thai/English UI, desktop tables, mobile cards, empty results, permissions, invalid input, draft recovery, revision conflicts, and uncertain retry paths are covered.

## Live browser QA

QA product: `BATCH-QA-0906`, ID `n9737y1h59jza7k88bqvswmsv18dxq76`.

1. Created product with metadata only, then opened blank packing form.
2. Saved 100-piece/25-per-pallet draft without dimensions. Product detail showed **0 created units**. Reloading its saved route retained the draft.
3. Measured and acknowledged four 25-piece pallets. Reviewed and committed all four.
4. Reopened the **same batch**, changed capacity to 50, reviewed replacement, measured and acknowledged two units. Final result: **100 pieces, 2 pallets**, with the original four retained in history; not six active units.
5. Started another batch for the same product. New form had an empty total. Prepared 110 pieces as **three boxes: 50 + 50 + 10**. Measured 0.4 × 0.3 × 0.2 m, switched to 40 × 30 × 20 cm without changing actual dimensions.
6. Used 390 × 844 mobile viewport to inspect cards and complete review/creation. Restored normal viewport afterward.
7. Reserved exact position for QA box P-000020. Reopening its batch showed editing disabled and an explanation.
8. Entered a wrong destination code; confirmation was rejected. Verified the correct position code and completed simulated QA put-away.
9. Product/card/table agree: **210 pieces, 3 boxes + 2 pallets**, one stored and four awaiting storage. First batch remains independently editable.
10. Checked English labels, empty search, zero quantity rejection, and pristine Box format automatic splitting.
11. Opened TEST001 legacy cancellation review: 400/4 before, 300/3 after cancelling a single 100-piece unit. Dismissed it. **No TEST001 records were changed.**

### QA records retained

- Pallet batch `p97ayzd1azvn7h5qb03km79c0s8dxzw8`: 100 pieces; active P-000018 and P-000019, 50 each. Retired P-000014 through P-000017 remain in history.
- Box batch `p97b93fg6n0b7ksdsp9ycv514s8dxz63`: 110 pieces; P-000020/P-000021/P-000022, 50/50/10.
- P-000020: `n17fcq2s5sqvjy0tyrrbab8ya98dwby2`; stored at DEMO-BLDG → floor 1 → สินค้าสำเร็จรูป A → POS-000008, X=0 m, Y=0 m, Z=0 m, rotation=90°.

These are local QA records, not claims of physical warehouse movement. Existing user units were not moved or repacked.

## Evidence

Screenshots are actual running UI captures, not generated mockups:

- `01-draft-zero-units.png`: server draft excluded from created totals.
- `02-repack-review-four-to-two.png`: explicit same-batch before/after review.
- `03-same-batch-two-units-history.png`: two active units and retained history.
- `04-mobile-boxes.png`, `05-mobile-review.png`: mobile packing and review.
- `06-reserved-batch-locked.png`: reservation protection.
- `07-box-stored-exact-position.png`: completed QA put-away.
- `08-two-independent-batches.png`: independent totals and per-unit status.
- `09-english-table-totals.png`: matching English table totals.
- `10-legacy-review-no-mutation.png`: legacy review dismissed without changes.
- `11-final-batch-section.png`: both final batches visible together.

## Checks and limits

Full typecheck and lint passed; **461 tests passed across 56 files**, including backend integration and accessibility checks. Production build passed. Final logs are saved alongside this file. Browser error log was empty during the finished box flow.

Independent final review found an obsolete completion-receipt display after another session repacked a batch. Fixed both the canonical batch and original product-packing routes: they now compare against the latest server revision, hide retired-unit links/counts, and offer Load latest. Regression tests cover both routes. Backend immutable retry receipts remain unchanged.

Camera scanning and physical warehouse operations were not performed; the manual QR fallback was exercised. Continuous screen recording is not provided: the available browser automation exposes screenshots, not a video recording API. No screenshot slideshow is represented as a screen recording.

Stored-unit repacking remains a separate future physical workflow. This implementation deliberately blocks it and retains the existing move workflow. No existing legacy units were automatically grouped or corrected.
