# Location barcode and image scanning fix plan

Date: 2026-10-10. Status: implemented and locally verified.

Make the location scanner at `/en/finished-goods/scan` accept a photo from the device and reliably read the attached warehouse labels. Add image selection independently of camera permission, improve barcode acquisition, and send every decoded value through the existing warehouse location resolver.

## Delivery evidence

- The shared scanner now accepts JPEG, PNG, and WebP files locally, with cancellable reading, preview, retry, adjustable crop, and explicit choice between distinct decoded values. Choosing an image stops camera acquisition without closing the location session. Warehouse changes, manual edits, disabled state, and unmount discard late results.
- The production decoder reads all three original full-photo fixtures automatically with exact payloads: `F2-L28-1`, `F2-L28-18`, and `F2-L28-18`. Generic edge regions and bounded angle attempts use no fixture coordinates. The core ZXing luminance path retains `TRY_HARDER` while avoiding the browser adapter's broken optional rotation path.
- Native browser checks passed for an existing QR payload (`F1-L3`), a composite of both original WebP photos that requires a choice before applying either code, Thai layout at 320 px with no horizontal overflow, and the real camera pipeline fed the upside-down photo as video frames. The owned video track ended after success.
- After integrating the latest main, the full Vitest suite passed **2,205 tests across 193 files**. TypeScript, ESLint, and the production build passed. Browser regressions are included in the existing desktop/mobile workspace CI suite and cover camera denial, both languages, all three original files, QR, ambiguity, camera cleanup, and accessibility.
- A read-only call to the deployed authenticated resolver returned `LOCATION_UNAVAILABLE` for **both physical codes in TG-OPT and TG-DEMO, the two accessible warehouses**. Decoding therefore succeeds independently of whether those locations are available in the selected warehouse. Existing explicit unknown-location behavior is retained; no master records or inferred aliases were created. Verify the physical labels' intended warehouse and active layout before treating either as a mapped location.
- Actual phone camera focus, glare, and iOS/Android hardware behavior remain unverified. The camera browser check uses real decoder code and a synthetic media stream, and location integration tests use controlled resolver responses.

## Findings

The annotated input belongs to `jobScan/LocationPicker.tsx`. Its scan action opens `BarcodeCameraBox`, which offers a live camera but no file input. The deployed location step also has no image-file input. Job ticket photos use a separate `PhotoCapture` flow after a location is selected; that flow does not provide location barcode acquisition.

`useBarcodeCamera.ts` uses `BrowserMultiFormatReader` with default decoding hints and rear-camera preference, without requesting a preferred resolution or applying a barcode crop. This reader already supports linear barcodes; the QR wording in the location UI is misleading, rather than evidence that decoding is restricted to QR.

The supplied labels are readable Code 128 barcodes. A local T3 browser fixture check used the installed `@zxing/browser` 0.2.1 UMD build, actual image/canvas decoding, and the same default reader configuration as the camera hook. It produced these results:

| Photo       | Dimensions  | Expected value | Full image with defaults | Isolated barcode area                 |
| ----------- | ----------- | -------------- | ------------------------ | ------------------------------------- |
| First WebP  | 1536 × 2048 | `F2-L28-1`     | `NotFoundException`      | Decodes with a crop and −2° rotation  |
| Second WebP | 1536 × 2048 | `F2-L28-18`    | `NotFoundException`      | Decodes with a crop and +2° rotation  |
| PNG         | 3000 × 4000 | `F2-L28-18`    | `NotFoundException`      | Decodes with a crop, without rotation |

Enabling `TRY_HARDER` on the full images did not decode any of the photos. Rotating those full images by the successful crop angles also failed. Cropping alone worked for the PNG; the WebP crops still needed slight angle correction. This supports adding both crop handling and skew correction. The diagnostic crops were selected manually; automatic region selection remains an implementation requirement. Static decoding does not establish live camera behavior or authenticated location resolution.

The resolver in `convex/finishedGoods/scanning.ts` already accepts plain zone/position codes and canonical QR values, with warehouse and active-hierarchy checks. In the deployed preview’s currently selected warehouse, searching either `F2-L28-1` or `F2-L28-18` returned **No matching location**. Search in `jobScans.ts` currently lists only active zones, while the resolver also accepts positions, so a negative search does not prove a missing mapping. Check both codes through the resolver, then verify their warehouse and active hierarchy. Include position search if either supplied label identifies a position that workers need to find manually.

The focused baseline command passed 19 tests across two files:

```sh
pnpm exec vitest run --project unit src/features/finishedGoods/useBarcodeCamera.test.tsx src/features/finishedGoods/jobScan/LocationPicker.test.tsx
```

Those tests mock barcode decoding, so they cannot catch these real-photo failures. The installed Next.js client-component and lazy-loading guides were read for this plan.

## Implementation order

### 1 Preserve the reported failures as regression cases

Add the original three attachments as named browser fixtures with exact expected payloads. Exercise the actual installed module dependency graph, not a decoder mock, in the implementation tests. Keep full-frame failures as the baseline; test the new image pipeline on the original photos without fixture-specific crop coordinates or angles.

Add a UI regression showing that opening the location scanner exposes an image picker even when camera access is denied or unavailable. This must exercise the real shared scanner UI, rather than the current `LocationPicker` camera mock.

### 2 Add image selection to the shared scanner

Extend `BarcodeCameraBox` with a visible **Choose image** action and a separate **Use camera** action. Opening the scanner must expose file selection immediately. Accept one JPEG, PNG, or WebP at a time, with a 25 MiB limit consistent with the existing photo picker. Report unsupported, corrupt, and oversized files explicitly. Selecting an image pauses live acquisition so the sources cannot race.

Decode location photos locally; remote storage and AI ticket extraction are unnecessary for reading a location barcode. Show a preview, reading status, retry, and an adjustable crop when automatic decoding fails. Retain keyboard and handheld entry. A photo with several distinct codes requires a choice before location lookup.

Keep acquisition state separate from the owning workflow. Closing a camera stream during a switch to an image must not invoke the owner’s scanner cancellation callback. A closed scanner, new image, changed warehouse, or manual edit invalidates pending image results.

### 3 Share a bounded decoding pipeline

Add a small feature-local decoding module used by photo acquisition and the camera fallback. Load the existing ZXing library only when scanning starts. Keep Code 128 and QR support and preserve other formats required by existing job/product scanning.

Start with a fast full-image attempt, then search generic overlapping regions that isolate barcode pixels while preserving the white margins around the bars. On failed regions, try orientation changes and a bounded small-angle sweep that includes ±2°. Preserve useful source resolution; the AI photo resizing helper is not the default barcode preprocessing path. Handle image orientation, cap canvas allocation, and release image bitmaps and object URLs.

Set a finite attempt/time budget and yield between attempts so Cancel remains responsive. If measurements on target phones show blocking, run the expensive fallback in a worker. Offer manual crop and retake guidance at the budget limit. Do not infer a successful barcode value from the printed text.

### 4 Improve live scanning without changing session behavior

Request an ideal rear-camera resolution, starting with 1920 × 1080, while allowing device fallback. Align the visible scan frame with the decoded region, including the effects of `object-cover`. Add a wide guide suitable for linear labels and hints to move closer, include both barcode ends, and reduce glare.

Keep normal scanning fast. Apply the crop/angle fallback at a throttled cadence rather than on every 100 ms frame; use the existing generation guards, duplicate suppression, and owned-track cleanup. Preserve continuous package intake and single-result location/verification workflows. Stop all acquisition after an accepted single result.

### 5 Connect results to location validation and update copy

Route camera and image results through the same `resolveLocationCode` call. Refactor `LocationPicker`’s camera-specific acceptance latch to represent an acquisition session, so a photo result can be accepted even when no live stream is running.

Check the two decoded codes with the authenticated resolver in the correct warehouse. Reconcile missing or mismatched master records with the physical floor and position labels through the existing layout/master-data workflow. Avoid fabricated locations or alias rules that infer an identity from the printed code. Include this mapping check before accepting the complete scan flow.

Retain version guards and the existing rules for denied, ambiguous, wrong-kind, unavailable, and unmapped identities. Show distinct feedback for **no barcode found**, **barcode read but location unknown**, and **location lookup failed**. Selecting a decoded image updates the location draft; saving records remains the existing workflow action.

Update English and Thai wording to **Scan location barcode or QR** and add image selection, decoding, crop, and failure strings. Keep the existing JobScan translation namespace and client-message delivery conventions.

## Files to change

| Area                          | Files                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Shared acquisition and camera | `src/features/finishedGoods/BarcodeCameraBox.tsx`, `useBarcodeCamera.ts`, new decoding/image acquisition helper                   |
| Location session              | `src/features/finishedGoods/jobScan/LocationPicker.tsx`; inspect `convex/finishedGoods/scanning.ts` and actual location records   |
| Translations                  | `messages/en.json`, `messages/th.json`                                                                                            |
| Regression coverage           | Camera and location tests, a real-decoder browser fixture test, job scan screen/records tests, and destination verification tests |

Review all callers of the shared scanner, including `TicketFieldScanner` and `DestinationScanner`, for cancellation and replacement semantics. Change the backend only if exact-code resolution reveals a resolver defect; missing master data is a separate mapping issue.

## Acceptance and verification

- Selecting each original attachment in the location scanner decodes the exact value above, without manually entering it. Automatic decoding must pass all three full-photo fixtures; manual cropping is a recovery path.
- Camera denial leaves image selection and typing usable. Cancel, Escape, rescan, warehouse change, and manual editing cannot apply a late decode or lookup. Selecting the same file again works.
- A mapped code selects the correct zone/position in the current warehouse exactly once. Unknown codes follow the existing explicit unmapped flow; denied, foreign, ambiguous, and invalid identities never become mapped locations.
- Live scanning reads a Code 128 label and an existing QR label through the same validation path. Continuous ticket intake, field replacement confirmation, and destination verification still work. Tracks are released after success, cancellation, and unmount.
- Unsupported files, unreadable photos, multiple-code images, and network failures show actionable English/Thai feedback. Image processing has a finite budget and Cancel stays responsive.
- Verify mobile widths of 320 and 390 px and desktop in both languages. Check keyboard access, labels, focus restoration, and overflow. Test printed labels, focus, glare, and rear-camera behavior on actual iOS Safari and Android Chrome devices.
- Run focused workflow tests, the real-image browser suite, related Convex integration tests, TypeScript, ESLint, changed-file formatting, and a production build. Repeat the original photo and camera flows after integration.

## Supporting references

[ZXing browser documentation](https://github.com/zxing-js/browser#using-the-api) documents image, canvas, and stream decoding. [The installed library version’s OneDReader source](https://github.com/zxing-js/library/blob/v0.23.0/src/core/oned/OneDReader.ts) shows scanline sampling, reverse-row handling, and the additional rotation attempt enabled by `TRY_HARDER`; it does not supply the small-angle correction required by these fixture checks.

The [existing inline scanning audit](../reviews/inline-code-scanning-2026-10-09.md) describes session guards and shared callers that this change must preserve.
