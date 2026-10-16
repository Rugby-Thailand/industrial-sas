# Job ticket photo compression verification

Date: 2026-10-17. Baseline: `2ee94968`. Scope: new Job Scan photo uploads.

The browser sends the existing 2000-pixel, quality-0.85 JPEG to AI before optional storage encoding starts. Storage uses quality-0.90 WebP only when it is at least 15% smaller than that JPEG. Otherwise it stores the same JPEG. This size rule is not a general guarantee of visual or barcode equivalence.

## Measured storage results

Tested 94 distinct document photos from the local Topgold dataset. Files were read locally; no private source photos, decoded business values, or temporary benchmark scripts are included in this PR. The first 65 images were used during calibration and error investigation; the final 29 were reserved for validating the final policy.

| Set                   | Images | Stored as WebP | JPEG baseline bytes | Selected upload bytes | Total bytes saved |
| --------------------- | -----: | -------------: | ------------------: | --------------------: | ----------------: |
| All document photos   |     94 |             40 |          42,592,690 |            39,379,418 |             7.54% |
| Final holdout         |     29 |              8 |          13,248,532 |            12,583,870 |             5.02% |
| Converted images only |     40 |             40 |          15,557,974 |            12,344,702 |            20.65% |

The median reduction among converted images was 19.66%. Across all 94 images the median was 0%, because 54 retained JPEG. **The original target of a 20% median reduction across the whole dataset was not met.** The implementation favors preserving the JPEG when savings are marginal, while still reducing total stored/uploaded bytes without changing the AI input or adding an encoder dependency.

An earlier quality-0.88 experiment saved substantially more bytes but lost two baseline-readable barcodes in one photo. Quality 0.90 still lost those codes on that photo, with only a 10.02% size reduction. The final 15% minimum saving retains its original JPEG. Higher quality alone was not monotonic in decoder success; the threshold is a conservative size policy, not a runtime barcode check. Final readability results below apply to the actual selected files and must not be substituted with the discarded 0.88 results.

## AI input and ordering

- Compared JPEG bytes from the pre-change successful rendering path and the new path on all 94 real document photos during the experiments: all were identical. A test-only baseline fixture retains that successful rendering algorithm; it does not retain the old error-handling/resource-lifetime behavior in production.
- A workflow regression holds WebP preparation unresolved and proves AI dispatch has already happened. It then resolves WebP while keeping the AI response pending and proves upload proceeds independently.
- Real-browser tests intercept the native encoder boundary and prove AI receives JPEG before WebP encoding starts. They also compare the complete JPEG byte arrays.
- No real model latency or OCR accuracy claim is made: live provider calls were not part of these measurements. Byte-identical JPEG inputs and dispatch ordering establish that no WebP dependency was inserted before AI.
- The ticket still waits for both AI and storage before showing its final state. WebP adds work in the storage branch; network/provider load and device CPU can affect wall-clock completion.

Three local batch runs used the same 20 source photos, real JPEG/WebP encoders and FileReader data URLs, alternating baseline/new order. The dispatch marker represents when the AI request could be made; it does not call the model. No test suite or decoder benchmark was running during these measurements.

| Run | Baseline AI dispatch p50 / p95 | New AI dispatch p50 / p95 | Baseline / new all-image preparation |
| --- | ------------------------------ | ------------------------- | ------------------------------------ |
| 1   | 1,479 / 1,689 ms               | 1,564 / 1,710 ms          | 1,690 / 3,853 ms                     |
| 2   | 1,509 / 1,649 ms               | 1,478 / 1,662 ms          | 1,650 / 3,813 ms                     |
| 3   | 1,500 / 1,678 ms               | 1,525 / 1,731 ms          | 1,678 / 3,871 ms                     |

The median of run-level p95 dispatch times was 1,678 ms before and 1,710 ms after (+32 ms). Optional storage preparation took about 2.2 seconds extra for the entire 20-photo batch, after AI dispatch had started. These are desktop Chromium measurements, not a guarantee for phones or networks; AI processing time and upload transfer time are excluded. The native-browser viewport was 1280 × 800 on macOS, Chromium 152 (T3 Code preview).

## Verification boundaries

| Boundary                               | Evidence                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG normalization / storage selection | Native browser encoding, JPEG byte comparisons, size measurements, actual MIME/dimensions                                                            |
| AI dispatch / upload arguments         | Workflow tests with independent deferred compression, AI, and upload promises                                                                        |
| Error handling                         | Missing context, failed draw/decode/JPEG, unsupported WebP MIME, null/throwing encoder, marginal/larger candidate, separate AI/upload size limits    |
| Lifecycle                              | Queued/active cancellation, batch of 20, remove/unmount during preparation or upload, cleanup, retained drafts and caller Back tests                 |
| Compatibility                          | Actual browser EXIF rotation and transparent PNG tests; 48MP regression; unchanged Location FileReader implementation                                |
| Stored URL → saved ticket              | Existing workflow tests assert the provider URL in the saved mutation payload and preview; real UploadThing/Convex persistence not exercised locally |

Local checks: complete Vitest suite **373 files / 4,956 tests passed**; native-encoder Playwright tests **6 passed** across desktop Chromium and a mobile Chromium viewport; Bun and TypeScript 6 type checks, ESLint, formatting, navigation contract and test discovery checked separately. GitHub PR checks provide the final committed-tree gate.

Final selected-output comparison covered 59 photos: the previous 30-photo decoder set plus a fresh 29-photo holdout. Nineteen selected files were WebP and were decoded with the production `readBarcodeImage(..., "TICKET", ...)` pipeline; 40 retained the identical JPEG and therefore had no additional compression. Across these checks there were **zero lost baseline-readable codes**. Twenty-three entries had baseline-readable codes (including the already-measured retained JPEG entries); unreadable baselines are not counted as successful barcode checks. This proves preservation only for the tested set, not arbitrary future photos.

## Cleanup and release limits

- Removed the unused runtime `resizeImage` implementation and obsolete test mock. The remaining FileReader helper is named `imageDataUrl.ts` and is used by Job Scan and Location.
- No new runtime package, schema field, route, foreground state, thumbnail file, or historical-image migration.
- Temporary benchmark files/logs stay in ignored `.cache/`; no original photos or generated business-image copies are committed.
- Reviews found no remaining blocking standards/spec implementation defects after the 48MP compatibility fix. Static navigation checks supplement the caller tests; the change does not alter Back ownership or presentation targets.
- Actual Android/iPhone hardware, Safari, authenticated staging UploadThing → live AI → persisted record → refresh, and real provider timings were not tested locally. The Chromium mobile viewport does not establish those results. The ordinary release workflow must still run; no release gate is bypassed.
- Rollback stops producing WebP for new uploads by reverting the feature. Already-saved WebP URLs remain readable by the existing image UI and need no schema rollback.
