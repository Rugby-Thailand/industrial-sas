# Package scanning implementation

Implemented 2026-09-19 on `codex/package-scanning-plan` in `/Users/macbook/.codex/worktrees/package-scanning-plan/industrial-sas`.

The [feature plan](package-scanning-feature.md) contains the requirements, ownership breakdown and acceptance criteria. Three Astra Low subagents handled independent camera, workflow UI and backend work, followed by compatibility review and integration.

## Delivered behavior

- Finished goods now provides **Scan Packages**, within the existing navigation and English/Thai design patterns.
- Continuous barcode and QR scanning appends packages in detection order. Camera acquisition remains active between packages; asynchronous validation cannot reverse their order. Repeated frames and different labels for the same package are deduplicated.
- The list labels **#1 as Top** and **the last package as Bottom**. Workers can drag (or use arrow keys on the drag handle), remove packages with a compact trash icon and review the count. Saved details preserve that order.
- Workers answer whether packages/pallets are a similar size and select visually estimated fullness: 100%, 75%, 50%, 25%, or a custom integer percentage. Common values and individual exceptions are supported. Fullness never changes inventory quantity.
- New package preparation defaults to these simple questions. Length, width, height and measured space are not mandatory. Existing measured preparation remains available through the optional advanced path.
- **Scan Location** changes scan mode, shows the package count, accepts a warehouse barcode/QR, then requires **Confirm Location**. Rescan/back preserves the package list. Manual/handheld verification remains available and is recorded as manual evidence.
- Permission denial, unavailable camera, decoder errors, invalid identities, duplicate scans, stale records and save/retry failures use existing feedback patterns. Unsaved exit warns before discarding the group.

## Integration and compatibility

Existing package identities and tenant services are reused. `convex/finishedGoods/scanning.ts` exposes package/location resolution, atomic confirmation and saved-assignment readback. A confirmation validates every unit and destination before inventory writes, preserves quantities and provides actor-bound idempotent retry.

The necessary additive schema change is an ordered assignment receipt plus a `LOCATION_ONLY` placement variant. Simple placement stores real location identity and sequence without fabricated dimensions or coordinates. Existing geometric placements keep their original shape. All affected placement readers, occupancy counts, package details and storage screens handle both variants.

A location containing unmeasured assignments displays unknown/partial measured utilization. Existing geometric reservation/fit paths reject destinations whose free space cannot be calculated. Active geometric reservations block a new simple assignment. Geometric moving/stacking and measurement edits are unavailable for location-only assignments; the UI explains this limitation instead of displaying invented geometry.

## Baseline and scope

The original checkout was preserved. Commit `19dcb5a` separately checkpointed inherited application changes during development. For integration, the feature was rebased onto main `983fb5a`; review the merged feature against that main commit. During development, missing catalogue and batch endpoints were completed to exercise the inherited UI. Integration retains main’s newer signed pagination, summary generation and test adapters, together with scanning compatibility. Overlapping changes were reconciled and obsolete development-only mocks removed.

No new application, navigation replacement, production deployment or live warehouse data change was performed. Browser checks used a separate local database and designated local test account.

## Verification

- After integration with main, the full automated suite passed: **83 files, 813 tests**.
- TypeScript checking and the production build passed.
- Whole-project ESLint and changed-file formatting passed. The earlier baseline lint error in `native-select.tsx` was removed by the newer main branch during integration.
- Browser check with the actual application and isolated backend successfully entered two package codes, reordered them, scanned a location through the manual/handheld form and confirmed assignment. Its original final assertion expected “Location confirmed” while the implemented success heading is “Packages assigned”; inspection verified the successful save, and the assertion was corrected.
- Real ZXing decoding in Chromium passed with a synthetic camera stream: two QR codes were read continuously from one camera acquisition, with no browser errors. Location mode acquired a new stream, detected the location and ended both streams; rescanning acquired a third stream and ended it after detection. No assignment was submitted by this camera check.
- A separate browser readback check passed: the saved assignment showed `DEMO-R26-PLACE-01` at the top and `DEMO-R26-MEASURE-01` at the bottom, with the saved location and fullness.

Physical-device verification remains necessary for rear-camera focus, printed 1D/QR labels under warehouse lighting, flashlight hardware and gloved touch dragging. Simulated camera checks cannot establish those hardware properties.

## Main implementation files

- `src/features/finishedGoods/PackageScanningScreen.tsx`: workflow, confirmation, fallback and retry.
- `src/features/finishedGoods/scanSession.ts`: ordered session and race-safe resolution.
- `src/features/finishedGoods/useBarcodeCamera.ts`: camera ownership, decoding and cleanup.
- `src/features/finishedGoods/PackageScanCamera.tsx`: preview and accessible scan feedback.
- `src/features/finishedGoods/ScannedPackageList.tsx`: order, drag, remove and fullness exceptions.
- `src/features/finishedGoods/ScanGroupDetails.tsx`: simple group questions.
- `src/features/finishedGoods/PackingScreen.tsx`: simplified preparation.
- `convex/finishedGoods/scanning.ts`: assignment APIs.
- `convex/model/finishedGoods/scanning.ts`: scanning domain validation.
- `tests/integration/finished-goods-scanning.integration.test.ts`: assignment and compatibility coverage.
