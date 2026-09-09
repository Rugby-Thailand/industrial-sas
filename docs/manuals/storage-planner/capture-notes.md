# Screenshot manual — capture and verification notes

Date: 2026-09-07. Worktree: `codex/storage-planner` at `/Users/macbook/Development/industrial-sas-storage-planner`.

## Deliverables

- `index.html`: primary, self-contained Thai manual; 12 chapters, 71 inline screenshots with red numbered rectangles and descriptive legends. Approximately 8.8 MB. No image opening/lightbox clicks required.
- `manifest.json`: editable text, screenshot references, source URLs and rectangle coordinates.
- `captures.json`: original capture metadata (before editorial corrections).
- `coverage.csv`: per-step capture inventory.
- `screenshots/original`: unchanged browser screenshot bytes. JPEG is the actual format returned by the capture tool.
- `previews`: screenshots of the rendered HTML, including its red CSS overlays.
- `browser-checks.json`: desktop/mobile image and layout checks.
- `assemble-manifest.py` and `generate-manual.py`: reproducible local generation.

App stays on port 3100. Manual preview is served locally on port 3103. Opening index.html directly also works without the servers because its images and styles are embedded.

## Scope and capture evidence

Captured navigation, warehouse/language choices, catalogue card/table and column filters, empty search, FG create/edit, packing by capacity/equal/custom allocation, measurement and copy, creation review, single-unit corrections, dirty-close choices, 4 → 2 repacking and history, building creation/settings/activation, floor/blocked-area/location editing, recommendation and precise placement, QR text verification and wrong-code rejection, reservation, completed storage, move, problem/return dialogs, pallet stacking, support lock and release, stale-result recovery, protected repacking state, and mobile navigation/filter/location actions.

The end-to-end UI demonstration created product MANUAL-QA-0907 and MANUAL-BLDG with location โซน FG คู่มือ. These are simulated QA records, not a claim that physical goods were moved.

- Created 100 pieces as four 25-piece pallets (P-000024–P-000027).
- Repacked to exactly two active 50-piece pallets (P-000028, P-000029); original codes retired into history.
- Stored P-000028 and moved it from X0.5/Y0.5 to X1.5/Y0.5.
- Enabled two levels including the base; stacked P-000029 on P-000028 at Z0.5.
- Observed supporting pallet locked.
- Moved P-000029 to X0.2/Y2/Z0 and completed placement. Supporting pallet became movable again.
- Final product display: 100 pieces, two active pallets, both stored. No demonstration move remains in progress.
- Equal/custom examples were left unsaved and did not create another batch.

Problem and return dialogs were opened and captured without submitting them. Camera/physical QR scanner operation, sign-in/setup, and separate read-only permission accounts were not exercised for this manual. The manual starts from an authenticated warehouse context. Existing weight/load rules remain deferred; this guide does not claim weight validation.

## Verification

- Generated HTML successfully with strict unique ID, image dimension, and annotation-bounds checks.
- Reviewed all 71 screenshots in six contact sheets; inspected critical placement, movement and stacking screens at larger size.
- Corrected annotation legends to match actual controls, removed an offscreen filter annotation, and clipped the half-pixel hamburger edge.
- All 71 images loaded on both desktop (1728px) and mobile (390px); zero hidden images.
- All 12 chapter links resolve, with zero broken anchors.
- Document width equals viewport width on desktop and mobile; no horizontal overflow.
- Only the three mobile-source screenshots use the 430px portrait cap. Tall desktop screenshots retain full content width.
- Preview browser console log list returned empty.
- Renderer independently reviewed by the manual_html agent, including self-contained resources and print/portrait alignment.
- Changes are documentation/artifacts only. No app source was changed, and the app unit/build suite was not rerun for this documentation-only task.

One transient dev-bundle syntax/load error occurred during a direct app navigation. Reload resolved it; the capture session continued. It was not reproduced or diagnosed as an application regression.

## Regenerate

```sh
python3 docs/manuals/storage-planner/assemble-manifest.py
python3 docs/manuals/storage-planner/generate-manual.py
```

`captures.json` remains the raw capture record; assembler applies the editorial fixes to `manifest.json`. Edit the assembler if a change must survive regeneration from raw captures.
