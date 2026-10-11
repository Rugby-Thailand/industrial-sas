# Barcode HTML preview

Date: 2026-10-10. Scope: isolated interactive HTML preview for the existing location and Job scan pages.

Preserve the current warehouse shell, Thai/English controls, light/dark themes, location-first sequence, ticket identity fields, field scan dialogs, and sticky save action. Add independent image and camera acquisition. Barcode decoding fills identities only; quantity, dates, and handwriting remain manual.

1. Build two linked pages in `src/features/finishedGoods/jobScan/_prototype/barcode/`, using the existing app typography and colors. Keep preview controls separate from product controls.
2. Provide location lookup, unknown-location feedback, product image reading, separate JOB/product results, curved-label review, unreadable-image recovery, camera-denial recovery, field-type validation, replacement confirmation, cancellation, and an in-memory save receipt.
3. Run actual local ZXing WASM decoding on selected product photos, reusing the benchmark's bounded crop/angle/curve algorithm. Mark weaker curve reads for explicit confirmation. Use labeled sample states for location mappings and simulated failures; no backend writes or AI calls.
4. Serve the HTML locally and inspect both pages on desktop and mobile. Exercise photo decoding, review, field replacement, cancellation, save, theme/language controls, and overflow. Run the impeccable detector and changed-file formatting checks.

Exit: reviewable HTML with screenshots and links. Production integration and physical-phone camera validation are outside this preview.
