# Packing implementation and verification — 2026-09-06

Current worktree: `codex/storage-planner`, `/Users/macbook/Development/industrial-sas-storage-planner`.

## Implemented
- Shared packing domain adapted from the donor: exact integer-thousandths calculations, whole-piece precision, per-pallet capacity splitting, equal-count splitting, 1–50 pallets, positive dimensions up to 100 m, optional weight and explicit measurement checking.
- Atomic idempotent `createPacking` creates all measured pallets together. Stable group identity and ordered IDs survive retries.
- Product form now offers **Pack pallets**. It saves FG edits/activates a valid product before opening packing, without creating a spare single pallet.
- Dedicated packing screen supports select/add/remove/edit, totals, copying measurements with individual confirmation, both split modes, replacement confirmation, persisted draft/pending payload/completion and exact storage links.
- Existing **Save changes** edits FG metadata/defaults without creating pallets. Existing physical unit/format and saved batch quantities are protected from reinterpretation. Pending pallet measurements remain editable.
- Shared exact placement, auth, tenant/warehouse boundaries and user-requested shell styling retained.
- Two generated design options are proposals for user selection; neither has replaced the working interface.

## Checks
- `pnpm check`: TypeScript passed, ESLint passed, **377 tests across 49 files passed**.
- `pnpm build`: production build passed, including the new packing route.
- Live Chrome desktop and 390 × 844 mobile verification:
  - Created dedicated FG-PACK-QA-0906 draft; edited its name and entered packing.
  - Split 1,001 pieces equally into 501 and 500.
  - Entered 1.2 × 1 × 1.4 m; copied dimensions; second pallet required explicit confirmation.
  - Over-allocation by one blocked creation and showed Remaining -1.
  - Refresh preserved selected pallet, quantities, measurements and checks.
  - Saved exactly two pallets and refreshed to the same completion links.
  - First new pallet entered exact storage recommendations at X 1.2 m, Y 0, Z 0 with existing occupied geometry considered.
  - Mobile document width = viewport width = 390 px; no page horizontal overflow.
  - Measurement screen shows allocated quantity 501 disabled with explanation while dimensions remain editable.
  - Saved a pending pallet height edit to 1.5 m; detail page confirmed the new height and preserved quantity 501.
  - Captured browser error log was empty during packing-to-storage verification.
- Review fixes: exact decimal Remaining arithmetic; corrupt pending-payload recovery; stable order across pallet sequence 999999 → 1000000.
- A concurrent catalogue table-view change appeared during this work; it was preserved. Invalid Testing Library `exact` options in its tests were corrected so the combined suite passes.

## Evidence
- [Desktop packing](desktop.png)
- [Mobile packing](mobile.png)
- [Created pallets](created.png)
- [Storage recommendations](storage.png)
- [Saved measurement edit](edited-pallet.png)
- [Check log](check.log)
- [Build log](build.log)
- [Option A — split panel](designs/option-a.png)
- [Option B — canvas first](designs/option-b.png)
- [Exact generation prompts](designs/prompts.md)

## Limits and next choice
- Batch quantity allocation is edited before creation; after creation, individual quantities are locked to preserve the total. Repacking a saved batch is a separate future operation.
- If browser storage is blocked, draft edits work in memory but batch creation is blocked with a recovery explanation to preserve refresh-safe submission.
- Whole-unit aliases PCS/PC/EA/EACH/PIECE/PIECES/ชิ้น use integers; other units allow up to three decimal places.
- Image-generation designs include proposed visual refinements (camera tools, compact cards, floating inspector) which are not claims of implemented controls. Future icon-only buttons retain accessible names/tooltips and keyboard focus.
- No paid services purchased. Existing user P-000004 draft was not changed.

