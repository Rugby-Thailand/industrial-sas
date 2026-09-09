# FG pack recommendation MVP — implementation and evidence

Implemented first in `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`, followed by the UX checklist. Work began 6 September 2026 and final checks continued after midnight on 7 September (Bangkok). App: http://localhost:3100.

## Delivered

- Existing pack details show FG, unit identity, quantity and saved outer length × width × height with units. The action is **Recommend storage / แนะนำพื้นที่**.
- Existing measurement validation and recommendation engine are reused. Missing measurements must be recorded; no estimated dimensions or new mandatory business fields were added.
- Default recommendations show fitting floor/rack positions. Existing PALLET stacking can be explicitly included. BOX/OTHER do not receive pallet stacking controls.
- The selected building → floor → location → exact subposition appears beside the 2D/3D view, including X/Y, calculated Z and rotation.
- Existing occupied objects use neutral blue-grey; the proposed pack is a bright green highlighted volume, with a label. Reserved occupancy remains amber/dashed. Invalid positions have an error reason and disabled confirmation.
- Fit reasons explain dimensions, height clearance and recorded occupancy. The copy states that preview does not reserve space or confirm physical storage.
- Alternatives update the scene. Invalid inspection surfaces are opt-in and explicitly labelled as inspection only; they are not presented as valid recommendations.
- Missing measurements, no active locations, no fit and failed recommendation loading have distinct recovery paths. The failure view includes Retry and the standard top-left back link.
- No weight/load enforcement, customer ranking, order workflow, new packing engine or quantity change was introduced.

## Validation gates

1. Captured selected source files in `before.tar.gz`; baseline: **538 tests / 60 files** (`baseline.log`).
2. MVP focused tests: **64 tests / 3 files**, including screens, accessibility and workflow integration (`tests.log`).
3. Implemented the UX checklist after that gate. Combined final results: **573 tests / 62 files**, typecheck, lint and production build passed. See [combined results](../ux-ui-2026-09-06/results.md). The shared worktree acquired additional move-related tests during final verification; final count includes them.

## Browser checks actually performed

Used existing dedicated QA product **BATCH-QA-0906**, pack **P-000021** (BOX, 50 pieces, 0.4 × 0.3 × 0.2 m). No new product or stock was created for the demo.

- Open saved pack → Recommend storage → inspect initial location with existing occupancy → choose FG-1 on building BLDG-A, floor 4 → scene/path/coordinates update.
- Saved dimensions and orientation are visible. 2D/3D, camera rotate/reset, coordinate edits and fit reasons work.
- Empty X and out-of-bounds X block confirmation; resetting restores a valid position.
- Reserved the QA box at POS-000016, refreshed successfully, rejected a wrong destination code, accepted the correct manually entered location QR payload, and observed physical confirmation enabled as a separate action. Cancelled and released the reservation; P-000021 ends awaiting placement with unchanged quantity/dimensions.
- Thai/English, desktop, 390 × 844 portrait and 844 × 390 landscape checked. Document width matched viewport width. Mobile review dialog remained within the viewport and scrollable.
- Complete creation → measurement → recommendation → reserve → verify → physical confirmation is covered by integration tests. This turn's live box flow ended by cancellation; it did not simulate a real physical warehouse placement.

## Evidence

- `01-pack-details-th.png`, `02-recommendation-th.png`, `03-alternative-th.png`: initial MVP walkthrough.
- [Final desktop preview](../ux-ui-2026-09-06/02-exact-position-th.png)
- [Mobile review](../ux-ui-2026-09-06/04-mobile-review-th.png)
- [Actual browser video](../ux-ui-2026-09-06/recommendation-flow.mp4): 17.28 seconds, saved pack → recommendation → alternative → 2D/3D → invalid coordinate → reset → review. 38 real captured frames with timestamps, encoded to H.264 at 10 fps; no audio or generated mockup frames.
- `implementation.patch` compares the selected baseline files with the implementation. It is not a complete patch of the already-dirty worktree.

## Limits

Physical touchscreen gestures, virtual keyboard behaviour and camera QR decoding were not tested on hardware. Manual QR validation and automated QR/identity rules were tested. Rendering is an isometric placement diagram; highlighted proposed volumes remain visible over projected existing objects, so use 2D/rotation and the exact coordinates to inspect depth relationships. No claim of globally optimal storage or real-world measurements beyond recorded data.

A structural Graphify query supported code navigation only (`graphify-out/`); CLI/skill versions differed and the query reported older node IDs/truncation. Correctness conclusions come from source review and tests, not that graph.
