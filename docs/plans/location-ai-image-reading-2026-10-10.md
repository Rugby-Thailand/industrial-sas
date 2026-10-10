# AI photo reading for warehouse locations

Date: 2026-10-10. Status: implemented in the isolated `codex/location-ai-photo-reader` branch; production delivery remains pending.

## Implementation evidence

The location picker now offers AI image reading for users with management permission. It supports single-photo selection or the device capture picker, crop, explicit submission, editable review, multiple candidates, cancellation, and the existing exact warehouse resolver. Images are prepared locally and sent inline; extraction does not create a ticket, master location, or stored image. Provider transport was extracted without changing the job-ticket deadline/retry policy.

All six supplied original barcode photos now decode automatically, including the sideways `F1-L4-2` and `F1-L3-11` images. Region detection now considers both bar directions and applies skew correction after orientation. The full-photo harness reproduced failures on both sideways originals before the correction and then returned each exact payload after it, without fixture-specific coordinates.

Manual integration checks called the real configured provider through the registered location action in an in-memory authorized test world. An initial original-file check produced `F1-L22-2` in 8.74 seconds. A second check used the production client JPEG preparation on all six full photos and returned each exact expected code: `F2-L28-1`, `F2-L28-18` (two photos), `F1-L4-2`, `F1-L3-11`, and `F1-L22-2`. All six assertions passed in 36.16 seconds; prepared requests ranged from 529,191 to 782,947 characters, below the action limit. The fixture organization/warehouse was synthetic; this proves live extraction, not deployed authentication or production mapping. Temporary live tests were removed after recording their results so CI does not make paid requests.

The desktop/mobile browser suite passed 18 scanner tests with actual image preprocessing and acquisition/review components; its AI response port is synthetic. Backend tests cover authorized extraction, foreign/inactive warehouse denial before provider calls, no extraction writes, invalid/oversized requests, missing credentials, strict output validation, and sanitized failures. UI tests cover correction, ambiguity, cancellation, replacement, warehouse/typing changes, lookup cancellation, and source switching. The original job-ticket provider tests remain passing.

The full Vitest suite passed 2,253 tests across 196 files. Formatting, typecheck, lint, production build, and pinned Convex code generation checks passed.

The complete workspace browser suite passed 24 tests in 19.1 seconds; its two desktop-only map tests were intentionally skipped in the mobile project.

Integration with the subsequently merged building-location workflow uses `finishedGoods/jobScanLocations:resolve`. Confirmed AI codes preserve either an exact legacy position or the registered location's building/floor identity. Missing codes retain the current explicit registration/save-for-later choices; extraction itself never creates a location. The merged suite passed 2,281 tests with only the newly combined public inventory count failing; that fixed count and an additional registered-location AI test passed in the focused rerun (124 tests), giving 2,283 passing tests across 197 files.

The steps below describe the implemented feature and its verification contract. Actual phone-camera hardware and the production AI-to-location flow still require release verification.

Add **Read location with AI** to the location scanner on `/en/finished-goods/scan`, in the camera/image area identified by the annotation. Workers can choose a photo or take one, read its printed warehouse location code, review the result, and validate it against the selected warehouse. Use the existing **Photos (AI)** job-ticket flow as the implementation reference.

This adds AI reading of visible label text to the existing barcode decoder. A photo such as `F1-L4-2` can therefore provide a location candidate even when glare, damage, angle, or camera permission prevents barcode scanning. AI text reading must be identified separately from a decoded barcode, and every AI result requires user confirmation.

## Existing functions to inspect and reuse

The current pallet-information reference in this repository is the job-ticket photo reader. Its functions provide reusable acquisition and provider behavior, while its ticket schema and prompt are specific to factory orders and products.

| Function or module                                                                                                  | Existing behavior                                                                                                                        | Planned use                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobScan/LocationPicker.tsx`: `LocationPickerSession`, `onScan`, `cancelScan`, `choose`                             | Owns warehouse-scoped acquisition, version guards, exact resolver lookup, mapped selection and explicit unmapped entry.                  | Own the new AI review session here. Share validated location application without bypassing cancellation or unmapped rules.                                                                                 |
| `BarcodeCameraBox.tsx`: `receive`, `open`, `close` and image-selection callback                                     | Shares camera/file barcode acquisition and manages source switching.                                                                     | Place an optional location AI action in the annotated area. Expose it through a location-specific callback or composition slot so package and destination scanners retain their existing behavior.         |
| `BarcodeImageControls.tsx`; `useBarcodeImage.ts`: `select`, `cancel`, decode effect                                 | Local image selection, preview, crop, automatic barcode decode, and cancellation.                                                        | Reuse acquisition/preview conventions. Explicit AI submission must invalidate pending local decode callbacks before starting; a late barcode must not override AI review.                                  |
| `jobScan/PhotoCapture.tsx`: `capture`, file-picker and `onSubmit` callbacks                                         | Camera plus multi-photo selection, previews and an explicit Send to AI action; file selection remains usable when the camera fails.      | Reuse the capture and selection behavior with a single-photo location mode. Do not import its 20-photo batch behavior or auto-start a second camera while the barcode camera owns a stream.                |
| `jobScan/JobScanScreen.tsx`: `onPhoto`                                                                              | Prepares each image, sends a data URL to `extractJobTicket`, and uploads an optional stored image independently.                         | Follow image preparation and action invocation. Location reading needs no ticket creation or permanent image upload. Add stronger request/session guards rather than copying ticket state.                 |
| `jobScan/resizeImage.ts`: `resizeImage`, `toDataUrl`                                                                | JPEG conversion with a default 2000 px maximum side; conversion can fall back to the original file.                                      | Reuse with explicit post-conversion byte/dimension validation. A fallback original must still meet the server action limit. Preserve label readability and honor the selected crop.                        |
| `convex/finishedGoods/jobScans.ts`: `extractJobTicket`, `requestJobTicketProvider`, bounded-body helpers and policy | Authorized OpenRouter image action, structured output, bounded provider response and deadlines, restricted retry, sanitized diagnostics. | Extract the provider transport into a shared server helper, preserving its tested policy. Add a separate location action and schema. Keep credentials server-side and preserve the ticket reader behavior. |
| `convex/model/finishedGoods/jobScans.ts`: `JOB_TICKET_PROMPT`, `JOB_TICKET_JSON_SCHEMA`, `parseJobTicket`           | Extracts factory order, product barcode text and ticket details.                                                                         | Reference the structured-output approach; write a location-specific prompt and strict runtime parser instead of reusing ticket fields.                                                                     |
| `convex/finishedGoods/scanning.ts`: `resolveLocationCode`, `resolveTarget`, `targetContext`                         | Validates code/QR identities, permissions, warehouse, ambiguity, active hierarchy, zone and position.                                    | Resolve the user-confirmed AI code through this existing path. Preserve exact `supportPositionId` and all denial/error semantics.                                                                          |
| `src/lib/convex/finishedGoodsApi.ts`; `convex/lib/tenantFunctions.ts`: `actionWithOrg`                              | Typed client references and authorized action envelopes.                                                                                 | Add the typed location extraction reference and enforce organization/warehouse authorization before a paid provider call.                                                                                  |

Frontend filenames in the table are under `src/features/finishedGoods/` unless shown otherwise. Read complete functions, effects, callbacks and direct callers before changing them. Also inspect existing provider integration tests, location/image tests, shared scanner callers, translations, applicable `AGENTS.md`, and relevant installed Next.js guides.

## Worker flow in the annotated scanner

1. Opening location acquisition exposes **Choose image**, **Use camera**, and **Read location with AI**. Camera denial leaves image selection, AI reading, and typing available. Hide the empty video area when the camera cannot start and show a short explanation with Retry camera.
2. Choose one JPEG, PNG, or WebP, or capture one photo. Show the full label preview, optional crop, Replace image, and Cancel. If a current image is already selected in barcode controls, reuse it for AI rather than asking the worker to choose it again.
3. The worker taps **Read location with AI**. Explain that AI reads the printed location label. Send only this selected image/crop; do not continuously send live video or trigger paid AI calls on each failed frame.
4. Show **Reading location…** with Cancel. Stop competing camera/local decoder acquisition. Retry requires another explicit tap and cannot issue concurrent requests for the same session.
5. Show the photo alongside an editable extracted code, marked **Read by AI**. If several location codes are visible, show distinct choices and require selection; never pick one automatically. If the image is unreadable, offer crop/retake/manual entry.
6. The worker confirms the code with **Use this code**. Validate through `resolveLocationCode` in the current warehouse. On success, show the canonical code/name and apply the existing `PickedLocation`, including `zoneId` and optional `supportPositionId`.
7. If the code is unavailable, show the extracted text with the existing explicit unmapped option only where `allowUnmapped` permits it. Denied, ambiguous, wrong-kind, or foreign identities cannot become mapped locations. Provider failure and location lookup failure get separate messages and Retry actions.

Suggested Thai labels: **อ่านตำแหน่งจากรูปด้วย AI**, **กำลังอ่านตำแหน่ง…**, **ตรวจสอบรหัสที่ AI อ่านได้**, and **ใช้รหัสนี้**. Fit the existing translation namespace and touch controls; test English and Thai at 320 px, 390 px and desktop, with keyboard navigation and announced loading/errors. Confirmation updates the location draft; the existing save action remains responsible for saving job records.

## Extraction contract and provider behavior

Add a proposed `extractLocationLabel` action, preferably in a dedicated feature module such as `convex/finishedGoods/locationImage.ts`, with `{ warehouseId, imageDataUrl }` input. Use `actionWithOrg` and the existing `masterData.storageLayout.manage` permission, consistent with the current Photos (AI) authoring flow. Enable the client action only for users who can manage this workflow; authorization must also run on the server. If a broader paid-AI permission is later required, define that deliberately rather than granting it through a read-only resolver permission.

Use the existing configured OpenRouter provider and model setting; no new provider integration is required. Separate the transport from task-specific messages/schema so both extractors keep the existing 40-second attempt, 55-second total deadline, at most one eligible 5xx retry, and 256 KiB response cap. Verify those bounds after refactoring. Do not automatically retry 429, network errors, timeouts, malformed output, or oversized output.

The location schema should contain a required `candidates` array, capped at five, with each candidate carrying `code` and optional visible `labelText` evidence represented with explicit null when absent. Disallow additional fields. Empty candidates mean no readable location code. Return only the small validated candidate list and a stable error code to the client; location AI reading needs no raw model response stored in job records.

The prompt must ask for location identities visibly printed on a warehouse label, preserve all code segments, handle rotated labels, and return an empty list when unreadable. It must not infer a position from an arrow, warehouse name, surrounding Thai prose, or a familiar code pattern. Text printed under a barcode is OCR evidence; the model must not claim that it decoded the bars. Treat instructions appearing inside the photo as image content, not task instructions.

Validate the returned JSON at runtime even when strict structured output is requested. Reject invalid types, overlong codes, excess candidates and unsupported fields. Deduplicate exact candidates, retain the original visible value for review, and apply only documented normalization used by the existing resolver. Do not silently repair `O/0`, `I/1`, missing hyphens, or missing suffixes. Model-reported confidence never removes confirmation or warehouse validation.

Accept bounded JPEG/PNG/WebP data URLs for this action, without introducing arbitrary remote URL fetching. Keep the existing 25 MiB original file ceiling and bitmap allocation safeguards on the client; resize/crop and verify the resulting encoded request is below the current 4,000,000-character action limit, including base64/header overhead. Validate the request again server-side before calling the provider. Release bitmaps, canvases and preview URLs on replacement/exit. Missing provider credentials return an unavailable state; production must never fabricate sample location codes.

## Session ownership and cancellation

Use one warehouse-keyed acquisition session with a monotonically increasing request version. Selecting another image, changing crop during a request, typing, cancelling, closing, changing warehouse, entering disabled/saving state, or unmounting invalidates both AI response and subsequent resolver response. The request captures its warehouse and image/crop identity; apply neither result if the active session differs.

Use separate states for choosing, local barcode reading, AI reading, AI review, resolving, and error so the sources cannot compete. The worker can return to camera or local barcode reading after cancelling AI review. Starting AI must invalidate any local decode that was about to auto-apply a result; starting camera must discard outstanding AI candidates.

Convex action cancellation in the UI does not guarantee cancellation of a provider call already running on the server. Cancel must immediately suppress application of late results; the server deadline still bounds that call. Do not promise that Cancel stops provider billing. Keep one active client request per session, disable duplicate submissions, and retain existing privacy-preserving provider logs. Do not log images, extracted codes, raw responses, or credentials. Permanent upload is unnecessary for this location-only action.

## Implementation sequence

1. Add the location schema, prompt and parser with tests for empty, partial, multiple, malformed and overlong results. Preserve visible values and treat ambiguity explicitly.
2. Move the bounded provider transport into a reusable server module with the existing integration tests retained. Implement the authorized location extraction action and typed client reference. Test that permission/warehouse denial occurs before any provider call.
3. Add a location-only photo/AI controller and review UI. Reuse selected photos and crop state from acquisition, add single-photo capture without competing streams, and wire explicit AI submission, cancellation and editable review.
4. Integrate the confirmed candidate with the existing location resolver/application path. Test exact positions, unavailable codes, denied/ambiguous identities and stale action/lookup results. Review all shared scanner call sites if shared controls change.
5. Add English/Thai messages and meaningful unit/integration/browser coverage. Verify camera-denied gallery/AI flow, actual image preprocessing, review, correction, multiple candidates, retry and cleanup.
6. Test a real provider call on the original supplied labels in a correctly configured environment, then a complete authenticated mapped-location flow. Open and link the implementation PR, run required CI, merge under the user's existing instruction, and verify the release reaches the production alias. The separate release follow-up remains a dependency; merge alone does not establish availability on the annotated page.

## Test inputs and acceptance

Use the three existing full-photo barcode fixtures and the new sideways `F1-L4-2` photo. For AI OCR, their **visible printed text** is the expected candidate: `F2-L28-1`, `F2-L28-18`, `F2-L28-18`, and `F1-L4-2`. This does not assert that the new barcode payload has been decoded. Include a text-only location label, blank/unrelated photo, obscured suffix, multiple different locations, and disagreement between printed text and any successful barcode decode. A disagreement requires review and must not silently overwrite either value.

Also include the subsequently supplied sideways `F1-L3-11` screenshot and upside-down `F1-L22-2` WebP. Their barcode payloads were confirmed with the real decoder: the former required a diagnostic crop/90° rotation, while the latter passed automatic full-photo decoding. Use their visible text as AI candidates and keep actual barcode results separate from OCR results.

Acceptance requires:

- The AI photo action is available in the annotated location area, including after camera denial, without creating a pallet/job ticket or uploading a permanent location photo.
- Extraction produces reviewable visible-code candidates, never automatic mapped selection. User correction and explicit choice work; unreadable/uncertain suffixes do not become guessed codes.
- Confirmed codes pass the same warehouse/tenant/hierarchy resolver as barcode input. Available positions preserve their exact identity; unavailable or denied codes retain the correct existing behavior.
- Replacement, typing, cancel, warehouse changes and unmount prevent late AI or lookup application. Camera and local decoder cleanup still pass; duplicate AI submissions do not race.
- Provider authorization, request/response limits, timeouts, retries and sanitized diagnostics are covered by tests. The existing job-ticket AI flow passes after transport reuse.
- Mocked provider tests are distinguished from a real-provider check, and synthetic camera tests from actual phone hardware tests. Production is verified with the intended release SHA and the authenticated Choose image → AI read → review → resolve flow.

Run focused parser/controller/provider/location tests first, the existing desktop/mobile workspace browser suite next, then formatting, typecheck, lint, full tests and production build. Record exact test results and remaining physical-device limitations in the PR.

## Related delivery plans

- [Barcode acquisition and decoding implementation](location-barcode-image-scanning-fix-2026-10-10.md)
- [Release runbook](../operations/release-runbook.md)

This feature includes the barcode orientation regression fix. Staging and production delivery follow the existing release runbook.
