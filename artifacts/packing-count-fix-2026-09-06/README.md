# Pallet-count confusion and packing flow correction

Worktree: `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`.

## Observed report

User expected total 100 pieces / 50 per pallet = 2 pallets but TEST001 card showed 4. Browser inspection found four saved TEST001 pallet records (P-000007 through P-000010), each quantity 100. The product's saved default was 100. The original card combined the product default with a count of saved records, making the default appear to be total stock. Existing product form submission also created a new pallet and routed to measurement; repeated use added records instead of merely saving product edits. No claim is made about which exact clicks the user performed.

## Changes

- Product cards and tables show the sum of saved pallet quantities separately from the default per storage unit. Counts remain actual record counts, never total/default arithmetic.
- New product primary action saves the product then opens packing; it creates no pallet prematurely.
- Existing product primary action saves edits only. Adding physical pallets requires the explicit Pack new batch action. Returning from measurement preserves the original pallet.
- Packing immediately previews the selected split. Editing capacity/count marks it unapplied and prevents submitting the old pallet rows until the operator applies it. Pending split survives refresh. Measured rows still require replacement confirmation and fresh measurement acknowledgement.
- Equal splitting and manual changes keep the preview count aligned with the current rows. Equal split count field is labelled as a splitting instruction, not the actual number already saved.

## Verification

- New catalogue regression failed before the fix; saved logs show the red test.
- Packing preview regression failed before the fix.
- Final `pnpm check`: TypeScript and lint passed; 423 tests across 54 files passed.
- Production build passed. `git diff --check` passed.
- Live Thai browser: created dedicated `PACK-SPLIT-QA-0906`; total100, split25 gave4, changing50 previewed2 and blocked premature submission. Applying replacement gave2 rows of50. Measured both and saved exactly two pallets, P-000012/P-000013. Fresh catalogue navigation in a separate browser showed total100, count2, default50 in cards and table. Final console had no errors.
- Existing TEST001 data was not merged, deleted, or rewritten. Its four existing records remain; changing a product default must not discard recorded goods.

Screenshots: `01-two-pallet-preview.png`, `02-catalogue-two-pallets.png` (each pallet50), `03-product-total.png` (total100/count2/default50). These screenshots are QA evidence, not a repair of TEST001's saved records.
