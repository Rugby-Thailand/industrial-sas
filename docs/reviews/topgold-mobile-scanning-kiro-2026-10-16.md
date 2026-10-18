# TopGold mobile camera replay — Kiro experiments, parent assessment

2026-10-16. Kiro CLI (`claude-opus-5.5`, high effort) built and ran the isolated experiments. The parent reviewed the raw evidence, bounded duplicate runs and wrote this final report. No production scanner/dependency/navigation was changed. Decoder execution was local; no OCR/AI extraction API was called. Kiro inspected sample images separately for subset selection.

## Decision

Use a persistent worker and target-aware decoding, retain the useful legacy location reader as a worker fallback, and optionally use native detection where device tests confirm it. **Neither tested ROI scheduler is a replacement that improves every task.** Native is best on this Mac, but the parent WebKit check lacks that API. WASM must remain a shared path for Android/iPhone.

Do not infer phone performance from these numbers. No phone, camera autofocus or warehouse network was tested. The combined native/WASM/legacy production design is a recommendation, not a measured shipping implementation.

## Dataset and boundaries

- 163 present files, 153 SHA-256 unique; 59 location and 94 package photos. Missing manifest files 83/86/104 are excluded.
- JOB denominator 92 excludes the two product-only labels. Location denominator 58 excludes image17 with an unknown final segment.
- This report's **location hit** means at least one expected location is present. Image2 can be a partial hit. The parent final assessment additionally reports **exact sets**, requiring every expected label and no extra identity. Do not mix those metrics.
- JOB/location are provisional manifest labels, some previously decoder-derived. Product results are **decode yield**, not accuracy; the separate static experiment has only14 legible printed-product comparisons. QR yield counts a QR-format result, not all QR ground truth.
- Machine: M1 Max /10 cores /32GB /macOS26.5.2. Headless Chromium151.0.7922.34, Playwright1.62.1, Node24.19.0. ZXing JS0.23.0 /browser0.2.1 and zxing-wasm3.1.5.
- Source JPEG decode and resizing happen before the frame timer. Frames preserve aspect ratio and are never upscaled. They are copies of photographs, not real camera observations.
- JS timing includes canvas capture and decoding. WASM timing includes frame bitmap acquisition, transfer, worker rasterization/decoding and reply after setup. Native timing is the platform's async `detect(ImageBitmap)` through the window API. Cold setup is recorded separately.
- p50/p95 include no-reads and failures. The main scored passes have153 images per method/size and no errors/timeouts. Repeats are timing repetitions, not additional independent accuracy samples.

## Methods

- `jsDefault`: the current live hook's unhinted `BrowserMultiFormatReader`; one symbol per call.
- `jsHinted`: same with Code128/QR hints.
- `liveFallback`: actual production `decodeBarcodeCanvas`,1200ms soft budget, run on the main thread. It returns several codes, but the live hook **delivers only a singleton**. Decoder recall below is not the hook's full delivered success rate.
- `wasmFast` / `wasmHard`: one warm worker, Code128/QR, `tryHarder` false/true, default two scanlines, checksum-valid results, up to8 symbols.
- `wasmRoiFast`: same fast decoder, only the current overlay rectangle (x10%, y37.5%, width80%, height25%).
- `native`: actual supported `BarcodeDetector` with Code128/QR on this Mac; no polyfill.
- `wasmRegions`: **post hoc** addition after the first pass. Existing pixel-edge region detector in both orientations, quiet-zone margins, Code128 at0/±5 degrees, two scanlines,300ms soft decoding budget plus detection cost, all inside the worker. No fixture coordinates or expected payloads.

Decoder inputs are pixels, opaque ids and targets; file names and expected labels stay out of acquisition.

## Frame results — max side1920

| Method       | Location hit | /n  | JOB hit | /n  | QR yield | Product yield | Pair yield | p50 ms | p95 ms |
| ------------ | ------------ | --- | ------- | --- | -------- | ------------- | ---------- | ------ | ------ |
| jsDefault    | 0            | 58  | 40      | 92  | 30       | 1             | 0          | 52     | 106.9  |
| jsHinted     | 0            | 58  | 40      | 92  | 30       | 1             | 0          | 25.5   | 81.2   |
| liveFallback | 23           | 58  | 81      | 92  | 20       | 48            | 46         | 651.8  | 1230.7 |
| native       | 33           | 58  | 90      | 92  | 80       | 66            | 66         | 23.9   | 32.3   |
| wasmRoiFast  | 0            | 58  | 0       | 92  | 0        | 1             | 0          | 6.5    | 16.9   |
| wasmRegions  | 14           | 58  | 58      | 92  | 0        | 50            | 43         | 71.6   | 120.5  |
| wasmFast     | 2            | 58  | 70      | 92  | 68       | 8             | 8          | 21.3   | 73.4   |
| wasmHard     | 12           | 58  | 82      | 92  | 72       | 36            | 33         | 37.1   | 89.7   |

All counts are out of the same photos. Native's33 location hits are32 exact sets; fallback's23 hits are22 exact sets. The JS primary has only one product result because a JOB/QR often wins its single-result search. A multi-symbol decoder lets the caller select the requested field instead of repeatedly seeing the same QR.

## Frame results — max side1080

| Method       | Location hit | /n  | JOB hit | /n  | QR yield | Product yield | Pair yield | p50 ms | p95 ms |
| ------------ | ------------ | --- | ------- | --- | -------- | ------------- | ---------- | ------ | ------ |
| jsDefault    | 0            | 58  | 32      | 92  | 25       | 0             | 0          | 28.2   | 45.5   |
| jsHinted     | 0            | 58  | 32      | 92  | 25       | 0             | 0          | 10.8   | 26.5   |
| liveFallback | 6            | 58  | 79      | 92  | 17       | 14            | 14         | 552.3  | 1072.8 |
| native       | 23           | 58  | 89      | 92  | 78       | 44            | 44         | 19.4   | 26.6   |
| wasmRoiFast  | 0            | 58  | 0       | 92  | 0        | 0             | 0          | 2.3    | 5.4    |
| wasmRegions  | 2            | 58  | 58      | 92  | 0        | 6             | 5          | 28.6   | 64.5   |
| wasmFast     | 0            | 58  | 57      | 92  | 56       | 0             | 0          | 7.7    | 23.6   |
| wasmHard     | 1            | 58  | 73      | 92  | 61       | 6             | 4          | 15.6   | 30.4   |

Downscaling is a speed/recall trade. WASM hard drops from12 to1 location hits and82 to73 JOB hits; native from33 to23 locations. A crop from an already downsampled live frame cannot restore detail lost before capture.

## Accuracy findings

1. **Fixed center ROI fails on these framings.** At1920, compared with full-frame fast it loses79 decoded identities across72 images and adds none. JOB/QR are usually near the top, products lower down, and floor labels at image edges. This does not prove ROI is bad when a person deliberately aims a barcode into the box; that framing was not measured. It does rule out choosing center-only based on its6.5ms median.
2. **WASM hard is worth testing as the shared initial pass.** At1920, fast→hard adds12 JOBs and25 pairs, for about16ms median cost. Hints alone halve the JS median but do not improve its JOB recall.
3. **Native leads here:**90/92 JOB,80/92 QR yield,66/92 pair yield,33/58 location hits. This is the Mac implementation; Android/iOS availability and performance must be measured independently.
4. **Checksum/format hints are insufficient identity validation.** Diagnostic instrumentation of `MultiFormatReader.decodeWithState` traced wrong production fallback values to primary **CODE_128** itself: id15 `FP-L27-1q`,22 `22-L28U1/`,25 `22-LF8-'8` at1920, plus ids4/10/24 at1080. Therefore removing all-format fallback alone does not eliminate false reads. Several repeated deliveries in the live replay were the same false value.
5. **FOM routing is separate:** the12 FOM-prefixed JOB photos conflict with production's FO-digits-only classifier. Five FOM results appear in each35-image scheduler subset and remain routed incorrectly by the unchanged production classifier. Decoder speed cannot correct that business rule.
6. All decoded ticket QR payloads matched the provisional JOB value; no non-JOB QR payload was observed. This is a consistency check and yield, not independent full-dataset QR accuracy.
7. Blank/noise controls produced no symbols. The two product-only labels produced no false JOB. These few controls cannot bound the real-world false-accept rate.

## Repeated timing

A35-image subset was declared from manifest metadata and visual inspection before this harness decoded it:17 location /16 JOB /2 product-only; rotations, small/off-center codes, glare/creases, multiple labels, unreadable suffix and large source sizes. It ran5 repetitions per method/size. The post-hoc region pass was also repeated5 times with full-frame fast as a comparator. Raw setup and repeated timings are in `summary.json` (`repeat`, `repeatRegions`, `stability`, `stabilityRegions`). Repeated warm results support the broad latency ranking; they do not create a held-out accuracy estimate.

## Continuous scheduling replay

Each photo was presented through `canvas.captureStream(30)` for about4seconds; the pixels remain unchanged. This tests scheduling/first-result/UI gaps and stopping, not camera focus, motion or power use.

- `current`: actual JS stream decoder,100ms delay, actual main-thread fallback,1500ms fallback interval, singleton-only acceptance,1second dedup.
- `proposed`: one warm WASM worker,3 overlay-fast grabs per full-frame grab; full hard only after two empty full passes.
- `proposedV2`: post-hoc improvement; when the requested task is unresolved, a bounded generic-region pass is added and a later full hard pass can run. Completion checks FO/FOM plus product for tickets instead of accepting any QR as the whole ticket.

| Scheduler  | Location hit | JOB hit | Product candidate | Hit p50 ms | Hit p95 ms | RAF max-gap p95 ms | Stop max ms | Dropped after Stop |
| ---------- | ------------ | ------- | ----------------- | ---------- | ---------- | ------------------ | ----------- | ------------------ |
| current    | 5/16         | 10/16   | 0/16              | 189        | 1829       | 166.6              | 2.1         | 0                  |
| proposed   | 1/16         | 13/16   | 1/16              | 47         | 679        | 66.7               | 69.5        | 6                  |
| proposedV2 | 3/16         | 13/16   | 10/16             | 64         | 410        | 92.2               | 57.5        | 6                  |

The hard conclusions are:

- Both prototypes improve JOB coverage and UI responsiveness but **lose location coverage** relative to current. They should not replace the shared hook unchanged. V2 produces product candidates in10/16 ticket scenes vs0/16 current, but these are candidates, not verified product accuracy.
- Time-to-hit quantiles include successful scenes only and coverage differs. They cannot be advertised as an unconditional speedup. Compare shared successful scenes and misses separately on real devices.
- v1 grabs a median247 times in4seconds; it can decode the same video frame more than once. Add new-frame gating and an intentional cadence rather than an unbounded warm-worker loop.
- The6 results completing after Stop in each prototype were **dropped**, not delivered to a form. This test waits for a pending call; production must retain terminate-on-cancel and generation/job ownership.
- The current replay delivered an incorrect Code128 location on image25. This is an acquisition candidate; the benchmark does not prove an incorrect record was saved in the app.

## Recommended implementation plan

1. Correct and test the FO/FOM domain rule, retain partial JOB results in photo decoding, and prepare a bounded bitmap instead of refusing the20 slightly-over16MP originals. These are distinct from camera CPU optimization.
2. Introduce one warm worker per scanner session for WASM **and the existing legacy location fallback**. Transfer the latest new frame only; no JPEG encoding per frame, no backlog. Keep stop/cancel termination and stale-result protection.
3. Pass the requested field/scan target into live decoding. Return per-symbol text, format, position and review/provenance; select a JOB/product/location result appropriate to that target and preserve ambiguity. Keep known working location rescues until a replacement passes coverage checks.
4. Use native as an optional measured accelerator where both required formats are supported; preserve the WASM/shared path. Full-frame hard and bounded region rescue are measured components, but the complete native/WASM/legacy production combination remains unmeasured.
5. Preserve the existing server canonical warehouse/entity resolution and authorization. `LocationPicker` already resolves in the selected warehouse, protects late lookup results and offers explicit review/create for missing codes; it does not automatically save a wrong candidate. Add target-aware acquisition/risk checks before treating a scan as successful; unknown/new values keep that review/create workflow. Do not repair characters to force a match. One-scanline/curved rescue stays review-only; repeated agreement on the same damaged pixels is not independent proof.
6. Device acceptance: real Android/Chrome and iPhone/Safari, time from tap→first correct accepted result, target-specific recall/false candidates, UI gaps, focus/torch, Stop/Back/remount, pending/stale callbacks, CPU/thermal/battery and lookup/network cost. Use newly captured held-out scenes and separately score JOB, QR, product and location.

## WebKit compatibility evidence

The parent ran functional smoke tests on desktop WebKit26.5, separate from the initial pass/repeat/live data and before correctedV2. Latest check:2 images × JS/WASM-hard/region worker =6 completed calls; no page/decoder errors; both JS and WASM hard read image50's JOB. `BarcodeDetector` was absent in window and worker. See `../webkit-smoke.json` and `raw/webkit-smoke.jsonl`. This is not an iPhone test or speed evidence.

## Data provenance and exclusions

- `pass.jsonl`, `repeat.jsonl`, `live.jsonl`: original clean7-method pass,5-repeat timing and current/v1 replay.
- `pass-regions.jsonl`, `repeat-regions.jsonl`: complete clean post-hoc reruns used for region results. Earlier copies were conservatively quarantined with `-contended`; the parent notes WebKit calls were brief, not continuous between a file's birth/mtime.
- `live2.jsonl`: **35 actual proposedV2 cases**, checked for scheduler name and nonzero region calls.
- A first attempt to runV2 accidentally selectedv1 because the harness ignored `schedulerList`. It was retained as `live-rerun-contended.jsonl`, not counted asV2. The dispatch bug is fixed.
- Further duplicatev1 reruns were ended by the parent and retained as `live-rerun-aborted*.jsonl`; they are excluded from analysis. No incomplete run is used as a full-method comparison.
- `diagnose.jsonl`: symbology trace, not an independent accuracy sample.
- `calls.csv`: scored pass/repeat calls; `summary.json`: aggregates and per-scene live results. Original source photos remain outside the repo.

## Reproduction

See `scripts/topgold-scan-benchmark/mobile/`. Start `server.mjs` on3193 and ensure no other timing is active. The driver requires `/tmp/topgold-static-timing-complete` as coordination. Use new names because JSONL appends:

```sh
node scripts/topgold-scan-benchmark/mobile/server.mjs
# In a separate terminal, after verifying no competing benchmark:
touch /tmp/topgold-static-timing-complete
node scripts/topgold-scan-benchmark/mobile/drive.mjs pass replay-check
MOBILE_REPS=5 node scripts/topgold-scan-benchmark/mobile/drive.mjs repeat repeat-check
MOBILE_VARIANTS=wasmRegions node scripts/topgold-scan-benchmark/mobile/drive.mjs pass replay-check-regions
MOBILE_REPS=5 MOBILE_VARIANTS=wasmRegions,wasmFast node scripts/topgold-scan-benchmark/mobile/drive.mjs repeat repeat-check-regions
node scripts/topgold-scan-benchmark/mobile/drive.mjs live live-check
node scripts/topgold-scan-benchmark/mobile/drive.mjs live2 live-check2
node scripts/topgold-scan-benchmark/mobile/analyze.mjs replay-check repeat-check live-check
```

The timing comparisons above use actual decoder output, no mocks or expected-code lookup. The target-aware mixed production implementation still needs its own regression/device test before enabling. Source options/primary documentation are recorded in `docs/research/scanning-decoder-options-2026-10-16.md`.
