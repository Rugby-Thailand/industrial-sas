# Stored-pallet movement: occupancy verification

Implemented 2026-09-06 in `codex/storage-planner`.

- Both the original STORED placement and the destination RESERVED placement stay in planner geometry and archive/edit guards until the movement transaction resolves.
- A source with an IN_TRANSIT move is labelled **Last confirmed position · moving**, with an amber dashed footprint. The target is labelled **Move destination reserved**. Both desktop and mobile use the same responsive SVG layer.
- Location and impact counts deduplicate physical pallet IDs without removing either held footprint. The two positions remain individually visible.
- Occupied/reserved area is the union of XY footprints, including supported elevations; overlapping holds and vertically aligned storage are not added twice. This is a floor footprint measure, not occupied volume or remaining rack capacity.
- Both location catalogues expose move state/role and union area. Active-move reads use tenant/warehouse/status indexes; building queries reuse the active-move map across floors.

Validation: **47 tests passed across 6 suites**: storage occupancy integration, occupancy union, placement geometry, 2D/3D visualizer, location catalogue, and existing planner screens. The integration suite was repeated after final query batching changes: **10 passed**. Scoped ESLint passed with zero warnings.

New cases include overlapping same-pallet holds (one pallet, 1.8 m² union), source/target metadata, archive blocking during a move, return releasing only the target, localized last-confirmed SVG labels in both views, 200 randomized comparisons to an independent occupied-cell oracle, and 10,000 rectangles. Full project typecheck initially reported only unfinished concurrently implemented finished-goods contracts; no errors in occupancy files.

Backend integrity review: source identity/status/revision and owner/tenant guards are checked by `moveContext`; start/verify/complete check target revision, and completion checks current-operator verification. Collision checks exclude only this move's exact source and target placement IDs. Cancellation before pickup and verified physical return preserve the original placement. No serious integrity blocker found in these commands. Historical move projection/read size was flagged to the backend owner for bounding.
