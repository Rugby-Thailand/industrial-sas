# Interactions, storage scenes and scanning — performance audit (Kiro 2)

Date: 2026-10-10. Working tree at HEAD `b232565` plus pending user changes (in
this scope only `src/features/storageLayouts/useWorkspaceNavigationGuard.tsx` is
modified, and no finding depends on it). Line numbers describe this working tree.

Scope: storage-layout workspace 2D/3D scenes and drags, catalogue/table rendering,
finished-goods placement/move workflows, camera scanning, ticket photo intake and
QR/label output. Read: `AGENTS.md`, the installed Next 16.3.8 guides
`01-app/02-guides/lazy-loading.md` and `interactive-apps.md`, and the installed
`next/dist/client/components/app-router.js` history patch.

**No runtime performance numbers were measured for this report.** Every finding
is inferred from source unless it says otherwise. The only numbers below come
from these existing artifacts, and none is a current interaction-latency baseline:

- `output/performance-audit/bundles.json` (5 Oct, Next 16.3.6, older revision):
  initial-JS bytes per route.
- `docs/reviews/codebase-optimization-2026-10-08.md`: synthetic Node timings for
  location search and an analyzer result for the product-catalogue split.
- `docs/reviews/product-barcode-non-ai-2026-10-10.md` and
  `docs/plans/location-barcode-image-scanning-fix-2026-10-10.md`: static-photo
  decoder experiments (not live camera, not the integrated app).
- `output/ai-image-scan-cost-2026-10-10.json`: three direct AI calls on synthetic
  1500×2000 tickets, taking 5.83, 6.47 and 7.08 s.

## Production code vs prototypes

| Code                                                                                                                       | Status                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FloorMap`, `FloorMapDrawing`, `FloorLocationTable`, `StorageZonesPanel` (compact), `StorageZoneDraftPreview`/`Visualizer` | Production: building workspace `/master-data/storage-layouts/[buildingId]`                                                     |
| `PalletScene`, `PlacementEditor`, `DestinationPicker`, `MoveScreen`, `PalletScreens`, `StackScreen`, `BatchManager`        | Production: finished-goods routes                                                                                              |
| `useBarcodeCamera`, `BarcodeCameraBox`, `LocationPicker`, `DestinationScanner`, `TicketFieldScanner`, `PhotoCapture`       | Production scanning                                                                                                            |
| `FloorMapDemo` + `storageFloorDemoData`                                                                                    | Shipped demo route `/storage-layouts/demo` with sample data; not a measurement target                                          |
| `Fg1ReferencePreview`, `F1F2ReferencePreview`, `Fg1SourcePlan`; `StorageFloorEditor` (non-compact `StorageZonesPanel`)     | Unreferenced by any route (tests only). Not optimized here                                                                     |
| `src/components/storageLayouts/_prototype/`, `src/features/finishedGoods/jobScan/_prototype/{barcode,add-location}/`       | Standalone HTML/JS prototypes, untracked or throwaway; the barcode prototype's worker decoder is design input only (finding 9) |

## Existing mitigations (do not redo)

- The map pan writes the SVG transform through a ref, once per animation frame, and
  commits React state only on pointer-up (`useFloorMapPan.ts:38–58,77–94`).
  `tests/e2e/workspace/workspace.spec.ts:251–341` asserts one React update for a
  50-move drag. That is the pattern the other drags should follow.
- `FloorMapDrawing` and `FloorLocationTable` are `memo`ized. Placement boxes and PD
  groups are memoized (`FloorMapDrawing.tsx:108–134`). The location list pages at
  25/50/100 rows, and catalogues use cursor pages of 20/50/100.
- A blank location search returns early (`locationSelectors.ts:12–14`; Oct 8 review).
- Catalogue queries are debounced 250 ms (`useScanContinuation.ts:22–29`). Location
  rows load their details only when expanded (`StorageLocationCatalogue.tsx:541–548`).
  Location QR codes open on demand in a dialog.
- `@zxing/browser` is dynamically imported (`useBarcodeCamera.ts:82`). Scanner
  sessions have generation guards, duplicate suppression and track cleanup
  (`docs/reviews/inline-code-scanning-2026-10-09.md`).
- Ticket upload and AI extraction already run in parallel (`JobScanScreen.tsx:225–233`).
- The harness at `scripts/storage-workspace-preview/main.tsx:157–177` exposes React
  Profiler data (`window.__storageWorkspaceProfile`). Use it for scene measurements.

## Findings

### 1. Pallet placement drag: two parent updates and two sessionStorage writes per pointer event

- **Where:**
  - `src/features/finishedGoods/PalletScene.tsx:730–746`: every `pointermove` calls `updatePlacement`.
  - `PalletScene.tsx:414–436`: constrains and snaps to 100 mm, then always calls `onPlacementChange`.
  - `src/features/finishedGoods/PlacementEditor.tsx:188–196`: `updatePlacement` calls `onActivate()` and then `setDraft`.
  - `PlacementEditor.tsx:235–280`: each render recomputes `resolvePalletSupport`, two `sceneProps` copies and `palletPlacementIssue`.
  - `src/features/finishedGoods/usePreviewState.ts:42–50`: `sessionPreferences.write` (a `JSON.stringify` plus `sessionStorage.setItem`) runs inside the state updater. Nothing skips an unchanged value.
  - The parents pass `onActivate={() => setSelected(keyOf(current))}` at `PalletScreens.tsx:781` and `MoveScreen.tsx:248`. `setSelected` builds a new object each time (`PalletScreens.tsx:581–582`, `MoveScreen.tsx:166`).
- **Journey:** storing or moving a pallet, then dragging it in the preview. Each pointer event
  (60–240 Hz) makes two synchronous storage writes. It re-renders the whole
  `Recommendations`/`MoveScreen` subtree, including `DestinationPicker`, which rebuilds
  the search string for every candidate (`DestinationPicker.tsx:19–38`). It also
  re-renders `PlacementEditor` and the full `PalletScene` SVG. Because of the 100 mm
  snap, most events produce a placement equal to the current one. The current
  selection never changes during a drag. Inferred.
- **Fix:**
  1. In `usePreviewState`, compute the next value outside the updater and
     return early when it is shallow-equal (all values are primitives). Move the write
     out of the updater, which also stops a StrictMode double write. Add an opt-in
     deferred write that is flushed on pointer-up, `pagehide`/`visibilitychange`
     and unmount.
  2. In `PalletScene`, keep the latest pointer position in the drag ref and apply it
     once per `requestAnimationFrame`. Skip `onPlacementChange` when the constrained
     result equals `placement` (x, y, z, rotation). Flush synchronously on
     `pointerup`/`pointercancel`/`lostpointercapture`. Keyboard arrows stay immediate.
  3. Call `onActivate` only when the editor's candidate is not already selected.
     Change 1 also makes the current call a no-op.
- **Priority / effort:** P1, S (about one day with tests).
- **Risks and safeguards:** The final drop must match today's result for the same
  pointer path. Flush the pending frame before releasing capture. Draft restore
  after reload must still work, so flush the write on pointer-up and page hide.
  `aria-live` position text will update less often, which is quieter for screen
  readers. The text after the drop is unchanged.
- **Measure:** Use a production build and the local seed (a pallet awaiting
  placement), with 4× CPU throttle and Pixel 7 emulation. Script 120
  `page.mouse.move` steps over 2 s. Wrap `Storage.prototype.setItem` with
  `addInitScript` to count calls, and record `event` and `long-animation-frame`
  PerformanceObserver entries.
  - Before: about 2 writes per event.
  - After: at most one write per distinct 100 mm cell visited, plus one.
  - The final X/Y text must be identical in both runs.
- **Regression tests:** Extend `PalletScene.test.tsx` and `MoveScreen.test.tsx`:
  - The same pointer path gives the same final placement.
  - `onPlacementChange` is called once per distinct snapped cell.
  - Arrow keys still move 100 mm per press.
  - Cancel and lost capture flush the pending position.
  - After pointer-up, a remount restores the dragged X/Y.
  - Selection is persisted once per drag.

### 2. Zone and floor-offset drags re-render the whole context scene

- **Where:**
  - The zone dialog drags at `StorageZoneDraftPreview.tsx:292–306` and `StorageZoneVisualizer.tsx:564–590` call `onPositionChange` on every event.
  - `StorageZonesPanel.tsx:474–477` sets the X/Y strings.
  - `otherZones` is a new filtered array on every render (`StorageZonesPanel.tsx:253–256`).
  - Every render recomputes the corners and placement boxes of all context zones (`StorageZoneDraftPreview.tsx:195–216,369`; `StorageZoneVisualizer.tsx:441–464,651`).
  - The floor-offset drag (`StorageLayoutScreens.tsx:2103–2122`, wired at `:1597` to `setPlacement`) snaps to 1 m but passes a new object on every event, so all of `FloorForm` re-renders.
- **Journey:** adding or editing a location by dragging it, and dragging the floor
  offset. Primitive string setters already bail out when unchanged. Each 100 mm step
  still re-renders every other zone's `SceneBox` (about 17 SVG nodes each) and its
  pallets. Every floor-offset event re-renders the floor form. Inferred.
- **Fix:** Reuse the frame-coalescing, change-only drag hook from finding 1 in all
  three drags. Memoize `otherZones` and render the static context (other zones,
  reserved blocks, placements) as a `memo` layer that receives stable geometry
  props, so only the dragged selection re-renders. In `FloorVolume`, compare
  x/y before calling `onPlacementChange`.
- **Priority / effort:** P2, S–M.
- **Risks:** `fitsFloor` and the overlap validity must follow the final position. The
  keyboard path (`StorageZoneVisualizer.tsx:539–551`) stays immediate.
- **Measure:** Profile the zone dialog in the workspace harness with a 198-position
  floor and a 300-zone synthetic fixture (add `fixture=dense`). Compare commits and
  their summed `actualDuration` per 50-move drag.
- **Tests:** `StorageZoneDraftPreview.test.tsx` and `StorageZoneVisualizer.test.tsx`
  check the final position and validity after a drag. Arrow-key steps stay
  unchanged.

### 3. Floor-map callout placement is O(zones × 342 × obstacles) and runs on every render

- **Where:** `src/components/storageLayouts/FloorMapDrawing.tsx`:
  - `:220–253`: the pallet and aisle bounds are computed on every render, and `labelCollides` allocates `[...palletBounds, ...aisleBounds]` on every call.
  - `:254–303`: for each colliding zone, all 18×19 = 342 candidates are tested and the survivors are sorted with two `Math.hypot` calls per comparison.
  - None of this depends on `zoom`, `focus`, `matchIds` or `searching`, yet it reruns on zoom clicks, pan commits and every search keystroke.
- **Journey:** the floor map with "location labels" on (a persisted preference),
  in 3D or in a non-PD plan. Once the 920-px frame is full of callouts (about 40 at
  220×58 px), every remaining zone still runs the full 342-candidate search against
  all labels, pallets and aisles. A 300-location, 1,000-pallet floor needs roughly
  10⁸ rectangle tests and 10⁵ array allocations per render. Selecting a location on
  desktop also opens the inspector column, which resizes the SVG and triggers a
  second full pass. Inferred.
- **Fix:** Use an exact-equivalent incremental algorithm:
  1. Compute the static obstacle list once.
  2. Precompute the set of candidates that are free of obstacles.
  3. After each placed label, drop the candidates that collide with that label only.
  4. Pick the minimum distance with a strict `<` scan in the original candidate order. This equals the stable `sort()[0]`.
  5. If no candidate is free, test only the first-choice position.

  Wrap the result in `useMemo`, keyed on `zones`, `blocks`, `boxes`, view,
  rotation, `reference`, the label preference, `selectedId`, frame size,
  `footerHeight` and `mobile`.

- **Priority / effort:** P1 for label users on dense floors, P3 otherwise. M.
- **Risks:** The label positions must be identical. Keep the floating-point
  expressions and the iteration order unchanged.
- **Measure:** Use the harness Profiler with labels on, in 3D, on `fixture=dense`.
  Measure commit `actualDuration` for select, zoom in and one search keystroke.
  Also run a Vitest bench of the extracted pure placement function on 15, 198 and
  300 zones.
- **Tests:** Add a fast-check property in the `property` project: for random
  zones, pallets and blocks, the old and new functions return deep-equal callouts.
  The existing `FloorMap.labels.test.tsx` callout cases (lines 496–524) must still
  pass.

### 4. Per-zone derived data is recomputed many times per render and per keystroke

- **Where:**
  - `locationInventory` builds six to eight `Set`s per call (`locationSelectors.ts:34–53`, `storageKit.ts:49–88`). It is called through `floorZoneUnitCount` up to six times per zone per plan render (`FloorMapDrawing.tsx:665–761`), again in the `FloorMap` filter (`FloorMap.tsx:191–203`) and again in `FloorLocationTable` (`:98–99`).
  - Search text is NFKC-normalized for every zone on every pass. One keystroke runs three passes: `FloorMap.tsx:191`, `FloorMap.tsx:720–727` (onSearch re-matches every zone) and `FloorLocationTable.tsx:98`, which re-matches the already filtered `matches`.
  - `matchIds.includes` is O(n) per zone, three times (`FloorMapDrawing.tsx:632,931,1082`).
  - `floorPositions` and `positionAisles` are recomputed several times per zone.
- **Journey:** typing in the workspace search box and selecting locations. The Oct 8
  review measured 3.65–3.73 ms per non-empty search call on a synthetic
  300-location fixture in Node. One keystroke runs three such passes before any
  rendering. Browser time is not measured.
- **Fix:**
  1. Add module-level `WeakMap` caches keyed by the zone object for inventory, normalized search text, `floorPositions` and `positionAisles`. Convex results are immutable, and changed rows arrive as new objects, so the caches invalidate themselves.
  2. Use a `Set` for `matchIds`.
  3. Let `FloorLocationTable` skip matching when it receives pre-filtered workspace rows.
  4. Reuse `matches` in `onSearch`.
  5. Pass `useDeferredValue(matchIds)` and `searching` to the drawing only. The input, count and list stay urgent. The map dims a frame later at most.
- **Priority / effort:** P2, S–M.
- **Risks:** The cache must never outlive a mutated object. The code base treats rows
  as readonly; add a dev-only `Object.isFrozen` assertion in tests. With deferred
  dimming, the map may briefly show the previous match set. This is acceptable
  because the list and count are exact.
- **Measure:** Count `storageLocationSummary` calls per keystroke with a test spy
  (expected: three passes before, at most one after on cache misses). Record
  keystroke `event` duration in the harness on `fixture=dense`.
- **Tests:** Extend `locationSelectors` unit tests: the cache result equals the
  uncached result, and a new zone object gives fresh data. `FloorMap.labels.test.tsx`
  search and selection cases must still pass.

### 5. Selecting, zooming or searching re-renders every scene node

- **Where:** `FloorMapDrawing.tsx`:
  - `:313–316`: `orderedZones` is sorted on every render.
  - `:454–556`: the area loop.
  - `:558–896`: the zone loop.
  - `:897–945`: the package loop, which sorts with `rawPoint` inside the comparator.
  - All loops are inline JSX that depends on `selectedId`, `zoom`, `matchIds` and `selectedUnit`. The memo boundary is the whole drawing (`:1174`). Each 3D `SceneBox` emits five faces and twelve edges (`SceneBox.tsx`).
- **Journey:** clicking or arrowing between locations, zoom buttons and search.
  Changing the selection touches two zones, yet every area, zone, pallet box and
  label is re-rendered and reconciled. Inferred.
- **Fix:** Memoize the projection (a `point`/`rect` object keyed on view, rotation,
  scale and centre). Extract `ZoneShape`, `PackageShape` and `AreaShape` `memo`
  components that take primitive props: `active`, `dimmed`, `tabbable`,
  `labelZoomBucket` and `showLabels`. Pass zoom only to the components whose label
  sizes use it. Hoist the package sort into a memo independent of
  `selectedUnit`, and move the selected package to the end separately.
- **Priority / effort:** P2, M–L. Do findings 3 and 4 first.
- **Risks:**
  - Roving `tabIndex` (`:594–598`) and arrow-key focus by `data-map-zone-id` (`:618–628`) must remain correct.
  - Paint order (selected last) must not change.
  - Do not replace the SVG (see the rejected list).
- **Measure:** Use the harness Profiler on `fixture=dense` in plan and 3D.
  Measure commit `actualDuration` for a selection change, zoom in and fit. Use a
  production-mode harness build (`vite build`), not dev React.
- **Tests:** The existing keyboard, selection, label and viewport tests
  (`FloorMap.labels`, `FloorMap.workspace`, `FloorMapDrawing.viewport`). Add a check
  that a selection change renders at most three zone components
  (Profiler/`React.memo` spy).

### 6. Finished-goods catalogue search writes URL, localStorage and router state on every keystroke

- **Where:**
  - `FinishedGoodsCatalogue.tsx:254` calls `updateState({ search })` on every input change.
  - `useCatalogueState.ts:62–75` serializes the state, writes `localStorage` and calls `updateBrowserQuery` (`history.ts:2–22`, `replaceState`).
  - Next's patched `replaceState` dispatches `ACTION_RESTORE` in a transition for each external call (`node_modules/next/dist/client/components/app-router.js:235–279`).
- **Journey:** typing, holding Backspace, pasting or using a keyboard-wedge scanner
  in "Search SKU, name or storage unit". Each character causes synchronous storage
  plus a router reducer pass and re-render. Browser history writes can also
  fail; whether sustained input triggers that here needs a real Safari/iOS check.
  No browser-specific numeric rate limit or input freeze was verified by this
  audit. The performance finding is the removable per-keystroke persistence and
  router work.
- **Fix:** Hold the input value in local state (`draftSearch`) for an immediate echo.
  Commit `search` to the URL and storage when the existing 250 ms debounce settles,
  and immediately on Enter, clear and blur. Tabs, filters and layout keep their
  immediate URL writes. The query already waits for `settledSearch`
  (`FinishedGoodsCatalogue.tsx:93–104`), so results do not arrive later. Optionally,
  catch `SecurityError` in `updateBrowserQuery` so the UI never freezes.
- **Priority / effort:** P1 (correctness and per-keystroke cost), S.
- **Risks:** Back/forward and reload must restore the committed search. Typing then
  immediately switching tab must commit the draft first. The local draft must
  re-sync on `popstate`.
- **Measure:** Count `history.replaceState` and `setItem` calls in Playwright while
  typing 150 characters at 20 ms intervals. Before: 150 each. After: at most the
  number of settles plus one. On Safari or iOS, test sustained typing and
  keyboard-wedge input and assert no persistence error interrupts input.
- **Tests:** Extend `ProductScreens.test.tsx` and `catalogueFilters.test.ts`
  (catalogue): the URL `fg` parameter updates after the debounce or Enter, back
  restores the previous search, a `popstate` re-sync updates the input, and the
  persisted preference equals the committed search.

### 7. Both catalogues replace results with a loading message while typing, paging and scanning

- **Where:**
  - `FinishedGoodsCatalogue.tsx:92–105`: the query is skipped while `search !== settledSearch`.
  - `:141–142,304–305`: `loading` is true whenever there is no outcome or the outcome is `scanning`, and it renders `<Loading />` in place of the table or cards.
  - `StorageLocationCatalogue.tsx:163–177,327–331` has the same pattern ("Loading locations…").
  - Convex `useQuery` returns `undefined` whenever its arguments change.
- **Journey:** every keystroke, page change, page-size change and bounded scan
  continuation. The README notes that sparse searches can need several scan
  requests. Each time, the list disappears, the layout collapses and the rows
  return later. Users lose their place and see a spinner during waits that a
  retained list would hide. Inferred.
- **Fix:** Keep the last `ready` rows for the same mounted catalogue (it is already
  keyed by warehouse and view, `FinishedGoodsCatalogue.tsx:52–57`) and the same tab
  or view while a newer request is pending or scanning.
  - Mark the region `aria-busy="true"` and dim it (no layout change).
  - Show a polite "Updating results…" status in place of the "Showing N records" line.
  - Keep the pagination controls disabled while loading (already `loading={…}`).
  - Show `<Loading />` only on first load. Errors, `not_ready` and `reset` replace retained rows as they do today.
  - Never retain rows across a tab switch.
- **Priority / effort:** P1 (perceived speed, layout stability), S–M. Ship with finding 6.
- **Risks:** Retained rows may not match the new filter for a moment. The busy
  indicator and status text must make that explicit. Row links stay usable because
  they point to valid records. Summary totals are not retained; their unavailable
  state stays as documented.
- **Measure:** Playwright with the local pagination profile (121 products, 363
  locations, `NEEDLE` lot): type a sparse query. Record the frames where the table is
  absent (MutationObserver), `layout-shift` entries, and the time from keystroke to
  final rows. Expected: zero absent frames and CLS ≈ 0 after the first load. Final
  result time unchanged or better.
- **Tests:** First load still shows `Loading`. While a new query is pending, the
  previous rows stay with `aria-busy`. An error replaces them. A tab switch clears
  them. `catalogue-pagination.integration.test.ts` ordering is unchanged.

### 8. Camera start downloads the decoder before requesting the camera

- **Where:**
  - `useBarcodeCamera.ts:82–87`: `await import("@zxing/browser")` completes before `getUserMedia` starts, and the preview appears only when `decodeFromStream` attaches the stream (`:97`).
  - No prefetch: `DestinationScanner.tsx:109` (`startOnMount={false}`) and the `LocationPicker` scan button open a cold start on tap.
- **Journey:** tapping Scan in location selection, destination/pallet verification,
  ticket field scan or package intake. The time from tap to preview is chunk
  download plus parse plus camera startup, run in series. On a warehouse phone with
  a weak network, the first scan of a session waits for the chunk before the camera
  even starts. Inferred.
- **Fix:** Start the module import and `getUserMedia` concurrently, keeping the
  existing guards. If either fails, release whichever succeeded. Attach the stream to
  `<video>` immediately so the preview shows while the decoder loads; ZXing
  re-attaches the same stream. Prefetch the module on scanner mount when idle
  (`requestIdleCallback`/timeout) and on `pointerenter`/`focus` of the scan action.
  Never call `getUserMedia` without the user's tap.
- **Priority / effort:** P1, S.
- **Risks:** Do not change the permission prompt timing. Keep "Starting camera…"
  until the decoder is ready, so a visible preview is not mistaken for active
  scanning. An import failure must still map to `DECODER` and stop the tracks.
  Prefetching costs bandwidth only on screens that offer scanning.
- **Measure:** Use Chromium with a fake camera
  (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<label>.y4m`)
  and Fast 3G with a cold cache. Measure the time from tap to the video `playing`
  event and to the first decode callback. Run five paired runs and compare medians.
- **Tests:** `useBarcodeCamera.test.tsx`:
  - The import resolves after the stream and both are still released on unmount.
  - The import rejects and the tracks stop.
  - Stop during concurrent start releases everything.
  - Prefetch never calls `getUserMedia`.
  - `DestinationScanner.test.tsx` single-shot behavior is unchanged.

### 9. Live decoding runs on the main thread over whole frames

- **Where:** `useBarcodeCamera.ts:84–97`. Video constraints set only `facingMode`
  (no resolution). `BrowserMultiFormatReader` has default hints (all formats) and
  decodes every 100 ms on the main thread. The visible guide frame
  (`BarcodeCameraBox.tsx:83–86`) is not the decode region.
- **Journey:** continuous package intake (`JobScanScreen.tsx:453–459`) while the user
  also edits tickets, plus single-shot verification. Each attempt draws and
  binarizes a whole frame on the UI thread, so typing and scrolling compete with
  decoding while the camera is open. Existing static-photo artifacts show
  full-frame ZXing JS failing where crops succeed: location labels failed full-frame
  and decoded when cropped, and product barcodes read 0/10 with full-image JS
  versus 8/10 with WASM crop and rotation. Live-camera speed and success rates are
  not measured.
- **Fix:** Follow the existing location-scanning plan (steps 3–4) and add a
  performance gate. Move live decoding into a dedicated worker: transfer
  `ImageBitmap`/`VideoFrame`, use ZXing-C++ WASM as in the benchmark, and cancel
  through the generation guard. Decode a crop that matches the guide, with a periodic
  full-frame attempt. Keep all formats currently accepted. The
  `jobScan/_prototype/barcode/reader-worker.js` worker is a reference, not
  production code.
- **Priority / effort:** P2, L. Implement only with fixture parity.
- **Risks:** Scan success must not fall below the baseline on any fixture or label
  type (Code 128, QR). Guide alignment must account for `object-cover`. Keep the
  worker fallback: if the worker or WASM is unavailable, use the current reader.
- **Measure:** With the fake camera driven by recorded label videos, record
  `long-animation-frame` total blocking while the camera is active, decode
  attempts per second, time to first accepted code, and success per fixture. Repeat
  on physical iOS Safari and Android Chrome (the existing plan's acceptance list).
- **Tests:** Real-decoder browser fixtures (plan step 1), the existing
  `useBarcodeCamera` lifecycle tests, and worker termination on close or unmount.

### 10. Job-ticket photos: unbounded concurrent full-resolution decoding; full-size thumbnails

- **Where:**
  - `JobScanScreen.tsx:449` calls `files.forEach((file) => void onPhoto(file))` for up to 20 photos (`PhotoCapture.tsx:11`, 25 MiB each, `:45`). Every call starts `createImageBitmap` on the full file at once (`resizeImage.ts:4`), followed by canvas `toBlob`, a base64 data URL, upload and an AI call.
  - Previews use the original file's object URL (`JobScanScreen.tsx:205`) inside `<img>` with no `decoding`/`loading` hints (`JobScanPhotoPreview.tsx:36`).
  - The saved-records list renders each uploaded 2000-px image eagerly as a 44×64 px thumbnail, up to 100 per page (`JobScanRecordRow.tsx:51`, `JobScanRecords.tsx:334`).
- **Journey:**
  - Choosing many gallery photos on a phone. Twenty decoded 12 MP bitmaps
    (about 48 MB each) can exceed iOS Safari's memory budget and reload the tab,
    losing unsaved tickets. `useUnsavedWarning` cannot prevent this. Before that
    point, the main thread is saturated, and the image dialog and controls lag.
  - Opening scan records downloads and decodes every full photo on the page.
  - All inferred. The AI artifact (about 6–7 s per ticket) shows that AI time,
    not client resizing, dominates total completion. Limiting only the resize stage
    therefore barely affects throughput.
- **Fix:**
  1. Add a small promise queue for the resize stage only (concurrency 2). Create the
     "reading" placeholders immediately as now. Uploads and AI calls stay
     concurrent.
  2. After resizing, swap the preview to the resized blob and revoke the original
     URL.
  3. Add `decoding="async"` and explicit `width`/`height` to thumbnails, plus
     `loading="lazy"` in the records list.
  4. Later, as a separate change, upload a small thumbnail alongside the photo. The
     dialog keeps the original.
- **Priority / effort:** P1 for the queue and lazy thumbnails (S). P3 for
  separate thumbnails (M, needs storage changes).
- **Risks:** Ticket order and per-ticket failure notices
  (`photoProcessingFailed`) must stay the same. Cancel or unmount must drop queued
  work. Lazy images inside scroll containers must still load when scrolled. The
  original resolution stays available in the dialog. Coordinate with any action
  quota added for `extractJobTicket` (`convex/lib/actionQuota.ts`, other scope).
- **Measure:** On a physical iPhone and a mid-range Android phone, select 20 photos
  of 12 MP. Record peak JS heap and memory (Safari Web Inspector Timeline / Chrome
  `performance.memory`), tab survival, the time until all placeholders render, and
  the time until the last ticket is ready. On the records page at 100 rows, record
  transferred image bytes and `largest-contentful-paint` before and after.
- **Tests:** `JobScanScreen.test.tsx`: with 20 files, at most two `createImageBitmap`
  calls are in flight. All placeholders appear synchronously. Order is preserved.
  The original object URLs are revoked. `JobScanRecords.test.tsx`: thumbnails have
  `loading="lazy"`.

### 11. Storage-layout catalogue and new-building routes import the whole building workspace

- **Where:** The catalogue, new-building and review pages import from
  `StorageLayoutScreens.tsx`, a 3,024-line client module. It statically imports
  `FloorMap`, `StorageZonesPanel` (`qrcode.react`), `StorageZoneDraftPreview`,
  `StorageZoneVisualizer`, `AreaColorPicker` and the navigation guard
  (`StorageLayoutScreens.tsx:14–37,73–76`; the route pages
  `master-data/storage-layouts/page.tsx:6`, `new/page.tsx`, `[buildingId]/review/page.tsx`).
- **Evidence:** In `output/performance-audit/bundles.json` (5 Oct, older build), the
  storage-layouts catalogue, `[buildingId]` and `/new` had identical initial JS:
  1,847,140 B raw / 534,966 B gzip in 23 chunks, against 1,354,893 B raw for the
  finished-goods catalogue. On Oct 8 the same split pattern for `ProductScreens`
  measured 82.79 KiB fewer route JS bytes (analyzer). The current storage bytes are
  not re-measured.
- **Fix:** Move `StorageBuildingCatalogue`, `NewStorageBuildingForm` and
  `StorageBuildingReview` into their own modules, keeping the existing re-exports
  for tests. Do not lazy-load the map inside the building route (see the rejected
  list).
- **Priority / effort:** P2, M. The loading/shell audit (01) may own this. Merge
  the two rather than duplicating.
- **Risks:** The first navigation from catalogue to building now loads the
  workspace chunks. Measure the time from click to a usable map.
- **Measure:** Run `next experimental-analyze` before and after (as on Oct 8), plus
  paired cold and warm catalogue loads and catalogue-to-building navigations.
- **Tests:** The existing `StorageLayoutScreens.test.tsx` imports must pass unchanged.

## Ranked top 3

1. **Finding 1:** pallet placement drag. This is the most frequent high-rate
   interaction. It produces a measurable count of removable writes and re-renders,
   the change is small, and drag precision is preserved by flushing on release.
2. **Finding 7, shipped with finding 6:** keep catalogue rows visible while
   updating, and commit search to the URL only once it settles. This is the largest
   perceived-speed gain in daily use, and removes unnecessary persistence work during input.
3. **Finding 8:** run decoder import and camera start in parallel and prefetch the
   decoder. Every scan journey gets a faster time to preview, with no change to
   scanning logic or success rate.

Next in order: 3 (label placement), 10 (photo queue and lazy thumbnails), 4, 2, 5,
11 and 9.

## Dependencies

- Findings 1 and 2 share one drag hook and the `usePreviewState` change. The latter
  also affects `DestinationPicker`, `PalletScene` view state and the selection state
  in `MoveScreen` and `PalletScreens`. Run their tests together.
- Finding 4's caches come before findings 3 and 5. Finding 5 relies on stable
  per-zone props and the memoized projection from finding 3.
- Findings 6 and 7 touch the same catalogue files. Do 6 first so the retained rows
  key on the committed search.
- Finding 9 depends on the location-scanning plan's shared decoding module (step 3)
  and guide alignment (step 4), and on its real-image fixtures (step 1). Finding 8 is
  independent and should land first.
- Finding 10's queue must respect any future server quota for `extractJobTicket`.
- Finding 11 overlaps report 01. Every measurement follows the baseline and gates in
  `05-measurement-and-ux.md`. Scene work needs a `fixture=dense` addition to
  `scripts/storage-workspace-preview` (for example 300 locations, 1,000 pallets,
  labels on).

## Rejected: these trade away UX

- **Restricting ZXing formats** (for example Code 128 only) or lowering the camera
  resolution or attempt rate to save CPU. In the Oct 10 benchmark, Code 128-only
  full-image JS read fewer JOB codes than the default (4 vs 5 of 10), and QR location
  labels must keep working. Scan success outranks decode cost.
- **Throttling drags** to fixed intervals, or updating only on pointer-up. The
  pallet would visibly lag the pointer. Coalesce per animation frame and flush on
  release instead.
- **Virtualizing catalogue or location tables.** Pages are already capped at 25–100
  rows. Virtualization breaks find-in-page, screen-reader row counts, printing and
  focus restore.
- **Replacing the SVG scenes with canvas/WebGL.** This would lose per-location
  keyboard focus, roving `tabIndex`, accessible names, titles and the DOM-based
  tests. No measurement justifies it.
- **Capping the number of callouts** or removing collision avoidance. This changes
  label placement and readability. Finding 3 keeps identical output.
- **Removing session or draft persistence** of placements, selections or search.
  Coalesce the writes; don't drop restore-after-refresh or back/forward state.
- **Showing stale catalogue rows without a busy indicator,** or retaining them
  across tabs or warehouses.
- **More aggressive photo downscaling** (for example 1,000 px) before AI or upload to
  cut bytes. Extraction accuracy is validated only on 1500×2000 fixtures.
- **Lazy-loading `FloorMap` with a spinner inside the building route,** or
  freezing the viewport fit while the inspector opens. Both add visible loading or
  mis-fitting where the map is the primary content.
- **Limiting AI/upload concurrency for intake** instead of only the resize stage.
  It would multiply total completion time (about 6–7 s per AI call) with no UX
  benefit.
