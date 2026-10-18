# Frontend architecture and component-reuse audit — industrial-sas

Date: 2026-10-13 (Asia/Bangkok). Auditor: Kiro (independent; research only).
Repository: `/Users/macbook/Development/industrial-sas`, branch head `733c6aca`, plus the dirty working tree as found.

## 0. Method, scope and limits

- I read source directly: every `src/app` route/layout/error/loading/not-found file, `src/components/{ui,system,table,providers,shell,storageLayouts,storageScene,examples,auth}`, `src/features/{finishedGoods (incl. jobScan),hr,storageLayouts,storageKit}`, `src/hooks`, `src/i18n`, `messages/en.json` (structure and keys), `src/app/globals.css`, the storage CSS modules, `src/lib/{resolveWriteError,convex/mutationOutcome,storageLayouts/areaColors,browser/storage,format/measure}` and `eslint.config.mjs`. I traced usages with `grep`. I did not modify application code, tests, configuration, documentation or git state.
- I did not run the build, tests, Playwright or a browser. Every behavioural statement below comes from reading source; none of it has been checked at runtime. Where a conclusion depends on server behaviour I did not read, I say so.
- To keep the review independent I did not read `docs/reviews/**`, `docs/design-sheet/kiro-audit.md`, `docs/plans/**` or any other audit or review in the repository. `eslint.config.mjs` refers to `docs/plans/component-reuse-and-ux-consistency-2026-10-10.md`. I did not open it, so some recommendations below may repeat it.
- **Other changes happened during the audit.** Files changed after I started at 09:03: `src/hooks/useWorkflowStep.ts` (new, 09:13), `src/lib/navigationGuard.ts`, `src/components/system/useNavigationGuard.tsx`, `src/components/ui/PageBackButton.tsx`, `src/features/finishedGoods/jobScan/{JobScanScreen,JobScanRecords,LocationPicker}.tsx` and their tests. They add a "workflow step" history model to JOB scan. More files changed at 09:15–09:26, including `ui/PageHeader.tsx` (new `backFallbackHref`), `finishedGoods/shared.tsx`, `providers/draftGuard.ts`, `DraftGuardProvider.tsx`, `hr/RequestsScreen.tsx` and `HrNavigation.test.tsx`. I re-checked the line numbers I cite from those files at about 09:27, but they may have moved again. Treat jobScan line numbers as approximate and check them against the tree before acting on them.
- AGENTS.md says to read `node_modules/next/dist/docs/` before writing Next.js code. This audit writes no code. Any change to route layouts (migration group G6) must read those docs first.

---

## 1. Coverage inventory and existing strengths

### 1.1 Inventory (production vs tests vs prototypes)

| Area | Prod files | Prod lines | Co-located tests | Prototype/reference files |
|---|---:|---:|---:|---|
| `src/app` (57 route/layout/error/api files + `globals.css`) | 57 | 1,853 | 3 | — |
| `components/ui` | 47 | 3,921 | 16 | — |
| `components/system` | 14 | 1,211 | 10 | — |
| `components/table` | 1 | 176 | 1 | — |
| `components/providers` | 10 | 737 | 4 | — |
| `components/shell` (+`search/`) | 14 | 2,200 | 7 | `_prototype/minimal-app/` (HTML/CSS/JS, 9 entries; lint-ignored) |
| `components/examples` | 1 | 499 | 1 | `c-sidebar-2.tsx` **is the production shell** (see F18) |
| `components/storageLayouts` | 26 | 7,749 | 14 | `Fg1ReferencePreview.tsx`, `F1F2ReferencePreview.tsx`, `Fg1SourcePlan.tsx`: about 983 lines with **no production importer** (tests only) |
| `components/storageScene` | 3 | 247 | 1 | — |
| `features/finishedGoods` (top level) | 39 | 13,515 | 29 | `paginationTestAdapter.ts` (test-only, in a production folder) |
| `features/finishedGoods/jobScan` | 15 | 3,395 | 10 | `_prototype/barcode/` (HTML/JS/worker/server.mjs; lint-ignored) |
| `features/hr` | 24 | 7,637 | 21 | — |
| `features/storageLayouts` | 15 | 6,098 | 8 | — |
| `features/storageKit` | 3 | 120 | 0 | — |
| `src/hooks` | 13 | 979 | 5 | — |
| `src/i18n` | 8 | 265 | 3 | — |
| `tests/` | — | — | 72 integration, 23 e2e, 8 isolation, 2 property files | — |

Untracked production source in the tree: `features/hr/{HolidaysScreen,HrActionCard,HrShortcuts,RequestsScreen,ShortcutCustomizeScreen,selfService}.tsx/ts`, `app/[locale]/(desktop)/hr/{customize,holidays,requests}/**`, `app/api/ai/**`, `src/lib/ai/**`, and `src/hooks/useWorkflowStep.ts` (new during the audit). I included all of them.

Very large modules, which are maintenance hot spots: `features/storageLayouts/StorageLayoutScreens.tsx` (3,064 lines, more than 20 components including catalogue, new-building form, settings dialog, isometric model, floor editor, plan drawing, reserved blocks and review), `features/finishedGoods/PalletScreens.tsx` (1,560), `PackingScreen.tsx` (1,537), `StorageZonesPanel.tsx` (1,227), `components/storageLayouts/FloorMap.tsx` and `FloorMapDrawing.tsx` (1,196 each, different content), `PalletScene.tsx` (1,190), `hr/PeriodDetailScreen.tsx` (934).

### 1.2 Existing strengths to keep and build on

1. **The shared control layer is real and enforced.** `Button` (`ui/ButtonControl.tsx:27-134`) owns pending/`aria-busy` and `asChild`-safe disabling. `IconButton` (`ui/IconButton.tsx:21-58`) owns the accessible name. One density rule (`globals.css:16`, `dense` variant plus `min-h-touch/min-h-control`) is used in `buttonVariants.ts`, `select.tsx` and `input`. `eslint.config.mjs:5-81` blocks native `<select>`, raw `ui/select`/radix Select, raw `ui/empty`, local control heights, copied surface classes, browser-locale number formatting, feature `<h2>` (SectionHeader is required), and feature imports from `components/{ui,system,table,providers}`.
2. **Selects are consolidated.** No native `<select>` exists. Every dropdown goes through `SelectControl`/`FormSelect`. The one exception, `LocaleSwitcher.tsx:6`, is documented and lint-annotated.
3. **Status and messages share one tone vocabulary.** `StatusBadge` (`ui/StatusBadge.tsx:15-92`) pairs each tone with a shape, and `Notice`/`ErrorNotice` (`ui/Notice.tsx`) reuse the same tones. Domain tone maps (`finishedGoods/shared.tsx:35-44`, `hr/HrShared.tsx:170-209`, `storageKit/PlacementStatusBadge.tsx`) all render through `StatusBadge`.
4. **Cursor pagination is one stack.** `useCursorPagination` + `useScanContinuation` + `useCatalogueSync` + `CursorPagination`/`PaginationFooter` serve the FG catalogue, product batches, the JOB location picker and records, the storage building/location/named catalogues and the floor location table. The only exception is HR requests (F12).
5. **One draft/navigation guard.** `DraftGuardProvider` + `useDraftGuard`/`usePendingGuard` (`components/providers/draftGuard.ts`) are used by HR forms and FG (`PalletScreens.tsx:316`, `BatchManager.tsx:105`, `ProductScreen.tsx:260`, `JobScanScreen.tsx:159`). `useNavigationGuard` adds Back/Forward and `beforeunload` handling.
6. **Domain write models are explicit and documented.** FG and storage use `useAsyncOperation` (request identity, no auto-retry). HR uses `useHrWrite` (SAVED/REFUSED/DENIED/UNCERTAIN, session-pinned request IDs, verbatim retry) with `WriteFeedback`, consistently across HR forms.
7. **Barcode acquisition is already shared.** `BarcodeCameraBox` + `useBarcodeCamera` + `BarcodeImagePicker` + `ScanCodeInput` + `ScanIcon` serve JOB barcode intake, the ticket-field scanner, destination/source/support verification and the location picker.
8. **Physical colours are treated as data.** `lib/storageLayouts/areaColors.ts` keeps persisted hex presets, normalisation and contrast. `storageScene/sceneColors.ts` resolves status colours through CSS variables so open SVG scenes follow the theme. `globals.css` defines `--scene-*` per theme.
9. **Locale scoping.** `i18n/clientMessages.ts` sends only the route's namespaces, and `i18n/messages.test.ts`, `sharedCopyCoverage.test.tsx` and `intlRender.test.tsx` guard the catalogue.
10. **Disclosure is a deliberate pair.** Native `<details>` with `summaryClassName` (`ui/disclosure.ts`) is for stateless or query-on-open disclosure, and `CollapsibleSection` for state and mounting rules. Every native `<summary>` in `src` uses `summaryClassName`.

---

## 2. Prioritised findings

Priority: **P1** = cross-domain inconsistency with user-visible or correctness impact. **P2** = clear duplication with moderate impact. **P3** = hygiene or low-risk tidy-up. Effort: S (under 1 day), M (1–3 days), L (more than 3 days).

### P1

#### F1. Camera capture: three stream lifecycles and three layouts for the same physical task (barcode vs AI location photo vs AI ticket photos)

**Evidence**
- Barcode stream: `features/finishedGoods/useBarcodeCamera.ts:55-216`. Generation token, serialised startup (`startup.current = startup.current.then(run)`, line 211), release of late grants, error classification `PERMISSION | UNAVAILABLE | DECODER | TORCH`, torch, and `getUserMedia({ width 1920, height 1080 })` at lines 87-94.
- AI location still photo: `features/finishedGoods/jobScan/LocationPhotoCamera.tsx:36-83`. Its own generation token, `useImperativeHandle` stop and retry `attempt`, with `getUserMedia({ … height: 1440 })` at lines 55-62. **Every failure shows `cameraPermission`** ("Camera access was denied…", line 152), even when the camera is simply missing or busy.
- AI ticket photos: `features/finishedGoods/jobScan/PhotoCapture.tsx:52-79`. A third inline `useEffect([])` with a `cancelled` flag, no generation token, **no retry path**, and a single `ERROR` state rendered as a plain `<p>` overlay with no `role` (line 137-139). The video has no `aria-label` (line 127).
- Layout:
  - `BarcodeCameraBox.tsx:121-150` and `LocationPhotoCamera.tsx:135-149` share the same frame by copy-paste: `relative mx-auto w-full overflow-hidden rounded-(xl|lg) bg-black`, measured `videoAspect`, `maxWidth: 320 * videoAspect`, `object-contain`, and the same `measureVideo` handler duplicated (`BarcodeCameraBox.tsx:87-91`, `LocationPhotoCamera.tsx:127-131`).
  - `PhotoCapture.tsx:126-149` uses a fixed `aspect-[3/4] … sm:aspect-[4/3] object-cover` frame with a round overlay shutter. `capture()` (lines 83-100) draws the **full** video frame, so from source the user can capture image area that the cropped preview did not show (not runtime-verified).
  - Controls differ: barcode uses full-width outline Start/Stop/Retry (`BarcodeCameraBox.tsx:174-193`). Location photo uses a full-width primary "Take location photo" (`LocationPhotoCamera.tsx:171-180`). Ticket photos use an overlay shutter plus "Choose photos" and a ghost "Cancel" (`PhotoCapture.tsx:140-165`).
- Frame capture to JPEG is implemented twice with different safety. `LocationPhotoCamera.tsx:85-125` has a 40 MP guard, a `delivering` re-entry guard, canvas release, a shutter sound and synchronous stop. `PhotoCapture.tsx:83-100` has none of these.
- Tests: `useBarcodeCamera.test.tsx`, `BarcodeCameraBox.test.tsx`, `LocationPhotoCamera.test.tsx` and `DestinationScanner.test.tsx` cover lifecycles. **`PhotoCapture` has no direct test.** `JobScanScreen.test.tsx:78` mocks it out.

**Proposal (prefer adoption over new abstraction)**
1. Extract `features/finishedGoods/camera/useStillCamera.ts` from `LocationPhotoCamera` (generation token, release, retry, error classes `PERMISSION | UNAVAILABLE`) and adopt it in `PhotoCapture`. Both are still-photo flows with the same constraints. This replaces the weakest lifecycle with the strongest existing one.
2. Extract `features/finishedGoods/camera/CameraViewport.tsx`, a presentational component holding the measured-aspect black frame, video element, `aria-label`, an optional overlay slot (scan guide, torch, shutter) and a status/notice row that maps `PERMISSION | UNAVAILABLE | DECODER | TORCH` to the existing `JobScan` keys. Use it in all three components. `BarcodeCameraBox` keeps its scan guide and torch through the overlay slot.
3. Extract `captureVideoFrame(video, { maxPixels, type, quality }): Promise<File>` from `LocationPhotoCamera.capture()` and use it in `PhotoCapture`.
4. **Do not merge `useBarcodeCamera` into the still-camera hook in the first pass.** Its serialised ZXing startup, decoder-error classification, the 1 s dedupe (`useBarcodeCamera.ts:106-115`) and the single-code fallback rule (lines 141-142) are domain-critical. A later, optional step could let it consume a shared stream owner. Keep the consumer guards unchanged: `stopAfterScan`, `acquisitionOpen` and `lookupVersion` in `LocationPicker.tsx`, `accepting` in `TicketFieldScanner.tsx:38-45`, and `acquisitionBlocked` in `JobScanScreen.tsx`.
5. Choose one capture-control layout per intent and document it. Single still: full-width primary capture button under the viewport (the current location-photo pattern). Multi-photo burst: keep the overlay shutter but make the preview `object-contain`, or crop the captured frame to the preview, so the preview matches the capture.

**Benefit:** one camera failure taxonomy and copy, retry everywhere, consistent screen-reader announcements, and fewer stream-leak paths in the least-tested component.
**Risk/effort:** M. The risk is concentrated in late-grant and unmount behaviour.
**Verification:** keep `LocationPhotoCamera.test.tsx` ("stops a camera permission grant that arrives after unmount", "releases the stream synchronously before a native camera handoff") green. Add `PhotoCapture.test.tsx` covering late grant after unmount, retry after denial, no double capture, and file count limit. Re-run `BarcodeCameraBox.test.tsx`, `useBarcodeCamera.test.tsx`, `DestinationScanner.test.tsx`, `LocationPicker*.test.tsx` and `JobScanScreen.test.tsx`, plus `tests/e2e/workspace/{barcode-scanning,barcode,location-image-ai}.spec.ts`. A physical-device camera check is still required (README).

#### F2. Image intake rules are duplicated with diverging limits and allowlists

**Evidence**
- Two validators with the same 25 MB limit and type allowlist but different error shapes: `barcodeImage.ts:19-25` `validateBarcodeFile` (throws `ImageScanError("TYPE"|"SIZE")`) and `barcodeDecoder.ts:11-19` `barcodeImageProblem` (returns `"imageType"|"imageSize"`).
- Pixel limits are scattered: 40 MP in `barcodeDecoder.ts:240`, `prepareLocationImage.ts:28` and `LocationPhotoCamera.tsx:93`, and 16 MP in `barcodeImage.worker.ts:37`.
- `accept="image/jpeg,image/png,image/webp"` is repeated in `BarcodeImagePicker.tsx:142` and `LocationImageReader.tsx:179,191`. `PhotoCapture.tsx:46` accepts `image/*`, and `resizeImage.ts:21-23` silently returns the **original** file when decoding fails, so an unsupported format (for example HEIC on a browser that cannot decode it) would be sent unresized to `extractJobTicket`. I did not read what the server does with it.
- Canvas → JPEG encoding is implemented four times: `resizeImage.ts:4-20`, `prepareLocationImage.ts:23-52`, `LocationPhotoCamera.tsx:96-116` and `PhotoCapture.tsx:86-99`.

**Proposal:** a FG-local `features/finishedGoods/imageIntake.ts` exporting `ACCEPTED_IMAGE_TYPES`, `IMAGE_ACCEPT_ATTRIBUTE`, `MAX_IMAGE_BYTES`, `MAX_DECODE_PIXELS`, `MAX_WORKER_PIXELS`, one `imageProblem(file)` (keeping both message-key mappings through a small adapter), and `encodeJpeg(canvas, quality)`. Use the shared accept list in `PhotoCapture` too, or document deliberately why burst photos accept more.
**Benefit:** one place to change limits, and the same rejection copy for barcode-image and AI-image paths. **Risk/effort:** S. Keep the worker limit separate: it protects the WASM decoder.
**Verification:** `barcodeImage.test.ts`, `barcodeImage.worker.test.ts`, `barcodeImagePipeline.test.ts`, `barcodeDecoder.test.ts`, `BarcodeLocationImage.test.tsx`, `LocationPicker.image.test.tsx`, `BarcodeImagePicker.test.tsx`, and `tests/e2e/smoke/barcode-worker.spec.ts`.

#### F3. AI actions have inconsistent icon, naming and data-use disclosure

**Evidence**
- Icons:
  - `Sparkles` marks AI in global search (`shell/search/SearchTriggers.tsx:67`, `SearchDialog.tsx:253`, `SearchDialogLoader.tsx:270`), the location AI toggle (`jobScan/LocationPicker.tsx:223`) and the "Read N photos with AI" submit (`PhotoCapture.tsx:217`).
  - The JOB "Photos (AI)" mode button uses `Camera` (`JobScanScreen.tsx:465`).
  - `BarcodeImagePicker`'s "Read location with AI" has **no icon** (`BarcodeImagePicker.tsx:340-352`), and neither do the AI reader's "Open camera", "Use device camera" or "Use this code" buttons (`LocationImageReader.tsx:200-231, 307-315`).
- Disclosure:
  - Global search shows `Search.aiPrivacy` next to the send action (`SearchDialog.tsx:259-266`).
  - The local barcode picker states "No AI or image upload" (`BarcodeImagePicker.tsx:162`, `JobScan.barcodeImagePrivacy`).
  - The AI ticket photo flow uploads to UploadThing **and** sends the image to the AI (`JobScanScreen.tsx` `onPhoto`: `startUpload` plus `extract`), but its hint `JobScan.photoHint` only says "Each photo becomes one ticket".
  - The AI location reader hint says "AI reads the location label automatically" with no statement about what is sent.
- Provenance markers differ:
  - Text-only warning "AI filled" in `TicketCard.tsx:96-103`.
  - Plain semibold "Read by AI — review before using" in `LocationImageReader.tsx:279`.
  - An `Info` icon advisory in `JobScanScreen.tsx` (`reviewAdvisory`).

**Proposal:** follow the existing `ScanIcon` pattern (`ui/ScanIcon.ts`, a single re-export) and add `ui/AiIcon.ts` exporting `Sparkles as AiIcon`. Standard: every control that sends user content to an AI provider (1) shows `AiIcon`, (2) has "AI" in its visible or accessible name, and (3) has a one-line disclosure adjacent to the send action, using the `Search.aiPrivacy` placement as the model. Add a `JobScan.aiPhotoPrivacy` key stating that photos are stored and sent to the AI provider, and a location equivalent. Use one provenance treatment (for example `StatusBadge tone="warning" icon={<AiIcon/>} label=…` or the TicketCard text with the icon) for AI-filled values.
**Benefit:** users can always tell when content leaves the device, AI affordances read the same everywhere, and future AI features get one checklist. **Risk/effort:** S–M (copy review in TH/EN). The privacy wording needs product/legal review. I am not giving legal advice.
**Verification:** `LocationPicker.ai.test.tsx` (accessible names "Read location with AI camera"), `JobScanScreen.test.tsx` (button "Photos (AI)"), `TicketCard.test.tsx`, `GlobalSearch.test.tsx` (`global-search-ai-disclosure`), `i18n/messages.test.ts` (TH/EN parity), and `i18n/sharedCopyCoverage.test.tsx`.

#### F4. Read-state ladders (loading / denied / not found / failed) differ by domain, and FG and storage hide denials

**Evidence**
- The shared contract: `components/system/DataGate.tsx:18-22`, "The refusal keeps its request ID so a denied read is never replaced by a misleading empty or missing state." HR follows it everywhere through `OutcomeGate` (17 call sites across HR screens).
- FG collapses transport denial into "Missing": `MoveScreen.tsx:88` `if (!outcome.ok || !outcome.value) return <Missing />`, `PalletScreens.tsx:114`, `PackingScreen.tsx:339,360`, `StackScreen.tsx:180` and `BatchManager.tsx:205`. `Missing` (`finishedGoods/shared.tsx:138-151`) says the record "may belong to a different warehouse or you may not have access", with no request ID. FG never imports `DataGate`/`OutcomeGate`.
- Storage collapses denial into a generic warning: `StorageLayoutScreens.tsx:149-152` `QueryFailure` and `517-519` (`!outcome.ok → <QueryFailure/>`). `StorageLocationCatalogue.tsx:282-284` renders raw `<p role="status">` / `<p role="alert">` with no panel, tone or icon.
- JOB location picker: raw `<p role="alert" className="text-sm text-danger">` (`LocationPicker.tsx:360`) and coloured `role="status"` paragraphs (lines 264-289, 355).
- Three local loading aliases: FG `Loading()` (`finishedGoods/shared.tsx:134-137`, "Compatibility alias"), storage `LoadingCard()` (`StorageLayoutScreens.tsx:145-147`), and direct `LedgerPanelStatus` in 9 files.

**Proposal:** adopt `OutcomeGate`/`DataGate` for the transport layer (loading + denied with request ID) in FG detail screens and storage building/catalogue screens. Keep the domain "value is null" state (`Missing`, `t("notFound")`) inside the gate's success branch. Replace the raw catalogue paragraphs with `LedgerPanelStatus`/`Notice`. Remove the two aliases once callers use the gates.
**Benefit:** consistent, supportable denials (request IDs), the same visual hierarchy for failures across domains, and fewer ad-hoc branches. **Risk/effort:** M. **Product decision needed:** confirm whether FG intentionally hides denial behind "Missing" (its copy mentions access). If it is intentional, document the exception in `DataGate.tsx`. If not, migrate.
**Verification:**
- `PalletScreens.test.tsx`, `MoveScreen.test.tsx`, `PackingScreen.test.tsx`, `StackScreen.test.tsx` and `BatchManager.test.tsx` (expect `panel-DENIED` instead of the Missing copy for `ok:false`).
- `StorageLayoutScreens.test.tsx`, `StorageLocationCatalogue.test.tsx`, `useStorageBuilding.test.tsx`, `DataGate.test.tsx` and `LedgerPanelStatus.test.tsx`.
- `tests/integration/storage-location-catalogue.integration.test.ts`.

#### F5. Storage writes bypass the existing outcome and error helpers and show raw error codes

**Evidence**
- FG has a complete path: `useOperation` (`finishedGoods/shared.tsx:304-310`) → `useAsyncOperation` with `describeError = resolveWriteError(code, t, "finishedGoods")`, and `written(outcome)` (`lib/convex/mutationOutcome.ts`) turns `{ok:false}` / `{written:false}` into coded errors.
- Storage repeats the outcome triage inline seven times: `StorageLayoutScreens.tsx:394-396, 666-667, 696-697, 1461-1464, 2945-2946`, `StorageZonesPanel.tsx:362-372, 403-410` and `BuildingStatusToggle.tsx:100-107`.
- Storage passes `describeError: (code) => code || "NETWORK_ERROR"` (or `"UNKNOWN"`), which turns the user-facing error into the code itself: `StorageLayoutScreens.tsx:375, 627, 1194, 2902`, `StorageZonesPanel.tsx:145`, `BuildingStatusToggle.tsx:65`.
- `storageErrorMessage` (`storageLayoutShared.tsx:30-38`) maps three codes and otherwise renders `StorageLayouts.writeError` = "The change could not be saved: {code}" (messages/en.json line 534).
- `resolveWriteError` already supports a `"storage"` domain (`lib/resolveWriteError.ts:1, 13-19`), and `WriteError` already contains un-prefixed storage codes (`LOCATION_OCCUPIED`, `LOCATION_NOT_EMPTY`, `LOCATION_HAS_HISTORY`, `LOCATION_LAYOUT_MANAGED`, `CAPACITY_DATA_LIMIT`, …). **No caller uses the storage domain.**
- `BuildingSettings` keeps a second, parallel `pending`/`error` state next to `useAsyncOperation`'s own `busy`/`error` (`StorageLayoutScreens.tsx:625-631, 647-700`).
- `NewBuildingContent` shows its error in a `Notice` with the default `role="status"` (`StorageLayoutScreens.tsx:451`). FG's `ErrorNotice` uses `role="alert"`.

**Proposal:** add `useStorageOperation(scope)` in `features/storageLayouts/storageLayoutShared.tsx`, mirroring FG's `useOperation`: `describeError = (code) => storageSpecific(code) ?? resolveWriteError(code, writeErrorT, "storage")`. Keep the three storage-specific overrides, including `VERSION_CONFLICT` → "layoutChangedRetry" and the area-colour message. Use `written()` inside `operation.run`. Delete the parallel `pending`/`error` in `BuildingSettings`. Show errors with `ErrorNotice`. The "storage" message namespace list already includes `WriteError` (`i18n/clientMessages.ts`, master-data scope).
**Preserve:** `confirmOccupiedChange` / `confirmingImpact` flows, `expectedVersion`, `operation.request(JSON.stringify(payload))` request identity and `clearRequests()` placement.
**Benefit:** readable, translated storage errors and about 80 fewer lines of branching. **Risk/effort:** S–M.
**Verification:**
- `StorageLayoutScreens.test.tsx`, `BuildingStatusToggle.test.tsx` and `BuildingAreaDetails.test.tsx`. Update the assertions that currently expect raw codes in text.
- `lib/resolveWriteError.test.ts` (add the storage domain case) and `hooks/useAsyncOperation.test.tsx`.
- `tests/integration/storage-layouts.integration.test.ts` (server codes unchanged).

#### F6. Dialog behaviour: hand-built confirmations, inconsistent pending dismissal, width overrides, and unconfirmed destructive actions

**Evidence**
- `ConfirmDialog` (`ui/ConfirmDialog.tsx:12-110`) already encodes the rules: no dismissal while pending, pending label, error kept in the dialog, optional review children. It is used in 4 places (`PalletScreens.tsx:1385`, `ProductScreen.tsx:493`, `ProductBatches.tsx:513`, `JobScanRecords.tsx` delete).
- Hand-built equivalents:
  - `MoveScreen.tsx:713-870` (cancel/return/issue). Its close X stays visible and clickable but does nothing while `op.busy`, because `onOpenChange` ignores it and `showCloseButton` is not tied to busy.
  - `PackingScreen.tsx:1451-1536` (review → commit; hides X while busy).
  - `BatchManager.tsx:233-256`: a discard confirmation with an ad-hoc button row instead of `DialogFooter`, at `sm:max-w-md`.
  - `StorageZonesPanel.tsx:420-460, 599-640`: the editor's Cancel (`DialogClose`) is not disabled while `pendingAction` is set, and `onOpenChange` does not check it, so from source the dialog can be dismissed mid-save.
- Width overrides bypass `DialogContent size` (`ui/dialog.tsx:59,90-95`: sm/md/lg/wide): `max-w-4xl` (`BuildingAreaDetails.tsx:68`), `max-w-5xl` (`StorageZonesPanel.tsx:450`, `StorageLayoutScreens.tsx:2684`, `BatchManager.tsx:152`), `max-w-3xl` (`StorageLayoutScreens.tsx:595`), `max-w-lg` (`ui/PageHeader.tsx:97`) and `sm:max-w-md` (`BatchManager.tsx:234`).
- Destructive actions without confirmation:
  - Storage "Archive zone" fires immediately (`StorageZonesPanel.tsx:801-812, 822-833`). Its `aria-label` is only `t("archiveZone")`; the zone label appears only in `title`, so the many row buttons share one accessible name.
  - HR holiday delete fires immediately (`hr/SettingsScreen.tsx:259-301`).
  - By contrast, FG deletion/release uses `ConfirmDialog`, and HR period close uses an inline two-step (`PeriodDetailScreen.tsx:610-640`).
  - I did not verify whether archive or delete is reversible.

**Proposal**
1. Adopt `ConfirmDialog` (with `children` for review content) in `MoveScreen`, the `PackingScreen` review and the `BatchManager` discard. The navigation-guard prompt (`useNavigationGuard.tsx:337-410`) keeps its custom three-action dialog.
2. Add `size="xl"` (`max-w-5xl`) to `DialogContent` and replace the className widths.
3. Standard: any action that removes or archives data needs a confirmation step. Use `ConfirmDialog tone="destructive"` in FG and storage. HR may keep the inline two-step pattern with `WriteFeedback`, because it keeps feedback in context.
4. Accessible names for row actions must include the record (`archiveZoneNamed`).

**Benefit:** one dismissal and pending contract and fewer accidental archives. **Risk/effort:** M.
**Verification:**
- `ui/dialog.test.tsx` and `ui/sharedControls.test.tsx` (ConfirmDialog).
- `MoveScreen.test.tsx`, `PackingScreen.test.tsx`, `BatchManager.test.tsx`, `StorageLayoutScreens.test.tsx` and `StoragePositions.a11y.test.tsx`.
- `HrScreens.test.tsx` and `SettingsHoliday.guard.test.tsx`.
- a11y project: `pnpm test:a11y`.

#### F7. Four responsive mechanisms decide "table vs cards"

**Evidence**
- JS viewport hook at 1024 px, borrowed from the sidebar: `hooks/use-mobile.ts:3` (also used by `ui/sidebar.tsx:64`) drives `FinishedGoodsTable.tsx:64-80` and `FinishedGoodsCatalogue.tsx:79, 364`.
- A second JS viewport hook at 580 px: `components/storageLayouts/useStorageLayoutMobile.ts:5`, used in `FloorLocationTable.tsx:90,370`, `StorageZonesPanel.tsx:132`, `FloorMap.tsx:140` and `FloorMapDrawing.tsx:89`.
- Viewport CSS: `hr/HistoryScreen.tsx:293` `hidden md:block` and `PackingScreen.tsx:1350` `hidden sm:block`.
- Container queries: `hr/EmployeesScreen.tsx:182-190` (`@min-[62rem]`) and `hr/ReviewScreen.tsx` (`@3xl`). `TableScroller` is already `@container/table`.
- Workspace ResizeObserver with three more media queries: `useFloorWorkspaceView.ts:53-55` (1099/850/1399 px).
- The JS hooks return `false` on the server (`useSyncExternalStore` server snapshot), so the desktop table renders first and then switches on phones. The FG table switch is also coupled to the **sidebar's** breakpoint.

**Proposal:** the standard for collection layout is CSS container queries, which follow the pane rather than the window: render both the card list and the `TableScroller` table and toggle them with `@container` classes (the HR Employees pattern), or keep one JS hook (`useIsMobile`) only where a JS-only branch is unavoidable. Keep `useFloorWorkspaceView`/`useStorageLayoutMobile` for the canvas workspace, where measured width drives the drawing, but define the 580/850/1100 px values once (for example `components/storageLayouts/breakpoints.ts`) and use them in both the TS and the CSS module (`FloorMap.module.css:226,383`). Decouple the FG table from the sidebar breakpoint.
**Benefit:** no first-paint layout swap, correct behaviour inside split panes and dialogs, one rule to explain. **Risk/effort:** M. Rendering both views doubles DOM for 20–100 rows, which is acceptable at the current page sizes.
**Verification:** `FinishedGoodsMobileList.test.tsx`, `ProductScreens.test.tsx`, `FloorLocationTable.test.tsx`, `FloorMap.workspace.test.tsx`, `useFloorWorkspaceView.test.tsx`, `HrScreens.test.tsx`, and `ui/sidebar.test.tsx` (unchanged). Visual checks need a browser, which I did not run.

### P2

#### F8. The storage-location editor and reserved-area editor dialogs are near-duplicates

**Evidence:** `StorageZonesPanel.tsx:420-640` and `StorageLayoutScreens.tsx:2672-2800` share the same structure:
- `Dialog` + `DialogContent className="max-w-5xl"`
- add/edit title and description
- the grid `md:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]` containing `StorageZoneDraftPreview`
- a `FieldGroup columns={2}` with a label field and the same mapped `x / y / zoneWidth / zoneDepth` numeric `FormField`s (min/max/step `0.1`, `metres(max)`)
- hard-coded ids (`new-storage-zone-*`, `reserved-zone-dialog-*`)
- Cancel + save footer

**Proposal:** domain-local `features/storageLayouts/ZoneEditorDialog.tsx`, a shell with preview and fields slots, plus `ZoneGeometryFields`, which uses `useId` and takes value and onChange for x/y/width/depth. **Keep separate** the domain parts: storage condition and stack height with server save and occupied-impact confirmation (zones), and `AreaColorPicker` with a local floor-draft save (reserved areas, persisted hex colour).
**Benefit:** one geometry UX and validation hint set. **Risk/effort:** S–M. **Verification:** `StorageZoneDraftPreview.test.tsx`, `StorageLayoutScreens.test.tsx`, `StoragePositions.a11y.test.tsx`, `AreaColorPicker.test.tsx` and `tests/integration/storage-layouts.integration.test.ts`.

#### F9. Hand-rolled toggle groups use three different "selected" looks

**Evidence:** `SegmentedControl` (`ui/SegmentedControl.tsx:25-95`; `variant="active"`/`ghost`, `aria-pressed`, `iconOnly`, counts) is used in 6 files. Hand-rolled equivalents:
- `PalletScreens.tsx:477-495`: m/cm, `default`/`outline`.
- `PackingScreen.tsx:905-925`: simple vs exact, `default`/`outline`.
- `BatchManager.tsx:170-200`: view/edit, `secondary`/`ghost`.
- `StorageZoneVisualizer.tsx:283-327`: `StorageViewModeToggle` with its own class string.
- `JobScanScreen.tsx:459-488`: Photo is `active`/**outline** but Barcode is `active`/**ghost**, so the two inactive siblings look different.

**Proposal:** adopt `SegmentedControl` for single-choice groups (add a `fill`/grid layout option if full-width halves are needed, plus an optional `shortLabel` so `StorageViewModeToggle` can show "2D/3D" with full accessible names). The JOB panel buttons are open/close toggles (they can deselect), so keep them as buttons but use one inactive variant.
**Benefit:** one selected-state visual and keyboard model. **Risk/effort:** S. **Verification:** `sharedControls.test.tsx`, `PalletScreens.test.tsx`, `PackingScreen.test.tsx`, `BatchManager.test.tsx`, `PalletScene.test.tsx`, `FloorMap.workspace.test.tsx` and `JobScanScreen.test.tsx`.

#### F10. There is no popover or menu primitive; nine Radix overlays copy three surface styles

**Evidence:** raw `Popover.Content`/`DropdownMenu.Content` styling appears in:
- `CatalogueFilterControls.tsx:402` (bg-popover, p-4, shadow-xl)
- `AreaColorPicker.tsx:97` (`z-[60]`, bg-popover, shadow-xl)
- `ui/StatusReason.tsx:87` (bg-overlay, shadow-lg)
- `FloorWorkspaceLocationList.tsx:137`, `FloorWorkspaceToolbar.tsx:120,223`, `FloorMapCameraControls.tsx:106` and `storageScene/SceneToolbar.tsx:52` (bg-surface, p-2, shadow-lg)
- `FloorMap.tsx:584` (CSS module)
- `JobScanRecordRow.tsx:5` (raw DropdownMenu)

**Proposal:** add `components/ui/popover.tsx` (`PopoverContent` with `variant: "menu" | "panel"`, a shared z-index above dialogs, and collision padding) and a thin `dropdown-menu.tsx`. Migrate the call sites without changing behaviour. Floor-map overlays keep `styles.theme` through `className`.
**Benefit:** consistent overlay layering (the ad-hoc `z-[60]` today), one place for focus and collision rules. **Risk/effort:** S. **Verification:** `StatusReason.test.tsx`, `CatalogueFilterControls.test.tsx`, `AreaColorPicker.test.tsx`, `FloorMap.workspace.test.tsx`, `JobScanRecords.test.tsx` and `pnpm test:a11y`.

#### F11. Icon-only actions bypass `IconButton`, with accessible-name gaps

**Evidence:** 29 `Button size="icon"` uses with hand-written `aria-label`/`title` across 14 feature files, for example:
- `PalletScene.tsx:616-705` (zoom, rotate, reset)
- `StorageZonesPanel.tsx:784, 804, 963, 979, 1048`
- `StorageLocationCatalogue.tsx:392, 408`
- `ProductBatches.tsx:275, 292, 403, 413`
- `StorageLayoutScreens.tsx:584, 1566`
- `hr/SettingsScreen.tsx:288`

`IconButton` already supports `asChild`, `pending`, `variant` and `tooltip`. In several places the `title` and `aria-label` differ (`StorageZonesPanel.tsx:810-811`).
**Proposal:** codemod to `IconButton` and require record-specific labels in repeated rows.
**Risk/effort:** S. **Verification:** `PalletScene.a11y.test.tsx`, `StoragePositions.a11y.test.tsx`, `ProductScreens.a11y.test.tsx`, `PageHeader.a11y.test.tsx` and `pnpm test:a11y`.

#### F12. HR requests list hand-rolls cursor pagination

**Evidence:** `hr/RequestsScreen.tsx:54-63, 100-111, 169-189`: a `cursors` stack in component state, fixed `limit: 20`, and text Previous/Next buttons. Compare `useCursorPagination` (`hooks/useCursorPagination.ts:58-122`; bounded history, popstate restore, history metadata) and `CursorPagination`/`PaginationFooter`.
**Proposal:** use `useCursorPagination({ scope: "hr-requests:<identity>", criteria: { status } })`. Render `PaginationFooter` with `pageSizeControl={null}`, or `CursorPagination` limited to sizes up to the server's `MAX_REQUEST_PAGE_SIZE = 50` (`convex/hr/self.ts:62`; `CURSOR_PAGE_SIZES` includes 100, which the server would reject). **Gotcha:** the HR route message scope lacks `Pagination` (`i18n/clientMessages.ts`, `"(desktop)/hr"`), so add it there.
**Benefit:** Back/Forward restores the page, and pagination looks the same everywhere. **Risk/effort:** S. **Verification:** `SelfService.test.tsx`, `HrNavigation.test.tsx`, `useCursorPagination.test.tsx`, `i18n/messages.test.ts` and `tests/integration/hr-employee-reads.integration.test.ts`.

#### F13. Page width and rhythm ownership is split between route layouts and screens

**Evidence**
- `app/[locale]/(desktop)/hr/layout.tsx:9` wraps every HR page in `PageContainer size="wide"`.
- `finished-goods/layout.tsx:9` wraps in `PageContainer` (full), and FG screens then nest a second `PageContainer` (`MoveScreen.tsx:456`, `JobScanScreen.tsx` 3×, `JobScanRecords.tsx:175`).
- `master-data/layout.tsx` has no container.
- Forms use ad-hoc widths instead of `PageContainer size="form"`: `ProductScreen.tsx:337`, `StorageLayoutScreens.tsx:404` and `hr/ProfileScreen.tsx:52` (`max-w-3xl`). `ProductBatches.tsx:330` uses `mt-8 max-w-7xl`.
- `PageHeader` adds its own `mb-4` (`ui/PageHeader.tsx:45`) inside `space-y-group` containers, so the header gap differs from the 24 px task rhythm.
- FG uses a `Heading` shim over `PageHeader` (`finishedGoods/shared.tsx:79-106`).

**Proposal:** route layouts own only the outer rhythm (`PageContainer size="full"`). Screens choose a width with `PageContainer size="form|wide"` and never with raw `max-w-*`. Remove `mb-4` from `PageHeader` once every page sits in a `space-y-group` container. Retire `Heading` in favour of `PageHeader`.
**Risk/effort:** M (visual). Read the Next.js layout docs in `node_modules/next/dist/docs/` before changing layouts. **Verification:** `PageHeader.test.tsx`, `PageHeader.a11y.test.tsx`, `StickyActionBar.test.tsx` (action inset relies on `data-action-scope` on the nearest `PageContainer`), `JobScanScreen.test.tsx` and `MoveScreen.test.tsx`, plus a visual review.

#### F14. Permission-gated display is inconsistent in storage

**Evidence**
- Three places re-implement `useCan`: `BuildingStatusToggle.tsx:54-56`, `StorageLocationCatalogue.tsx:92-95` and `StorageLayoutScreens.tsx:2895` (`navigationPermissions.includes("masterData.storageLayout.manage")`). `hooks/useCan.ts`/`useCanManage.ts` exist.
- The storage catalogue page renders "New building" unconditionally (`app/[locale]/(desktop)/master-data/storage-layouts/page.tsx:20-27`), and `NewBuildingContent` does not check permission (`StorageLayoutScreens.tsx:369-460`). FG gates its equivalent actions on `canManage` (`FinishedGoodsCatalogue.tsx:183-211`) and shows `ViewOnlyNotice`.
- Server authorisation still applies, as noted in `useCan.ts`.

**Proposal:** use `useCanManage()` in those three places. Gate the "New building" CTA (make it a small client component) and show a view-only notice on `/new` for non-managers.
**Risk/effort:** S. **Verification:** `StorageLayoutScreens.test.tsx`, `BuildingStatusToggle.test.tsx`, `StorageLocationCatalogue.test.tsx` and `WorkspaceAccessBoundary.test.tsx`.

#### F15. Copy that bypasses the message catalogue (TH/EN maintenance)

**Evidence**
- `useFGText().tr(en, th)` (`finishedGoods/shared.tsx:45-56`, "Compatibility shim") is used for **116** inline bilingual strings in `PalletScreens.tsx`, including static labels such as `tr("Lot", "ล็อต")` (line 197) and `tr("Metres", "เมตร")` (line 491). It also appears in `MoveScreen.tsx` (3, lines 576-580, 824), `FinishedGoodsCatalogue.tsx`, `FinishedGoodsTable.tsx`, `FinishedGoodsMobileList.tsx`, `ProductBatches.tsx`, `CatalogueFilterControls.tsx` and `PackingScreen.tsx`.
- `PalletScene.tsx:76-152` embeds an `en`/`th` dictionary, and `PalletScene.tsx:597, 704-707, 810, 1128, 1154` contain `locale === "th" ? … : …` strings.
- `FloorMapDemo.tsx` is inline bilingual.
- English default values appear in the Thai UI: `StorageLayoutScreens.tsx:406, 410` (`"BLDG-A"`, `"Main storage"`).
- Generic labels are duplicated across namespaces: "Cancel" ×8, "Saving…" ×6, "Clear search" ×4 (including `FinishedGoods.copy.clear-search` and `clear-search-414314`), and "Close" ×3. `App` is loaded on every route and could own the generic labels.

**Proposal:** move static `tr()` strings and the `PalletScene` dictionary into `FinishedGoods` keys, keeping `tr` only where text is truly runtime-composed, and parameterise those with ICU later. Use `App.*` for generic actions in shared components. Localise or blank the storage defaults.
**Risk/effort:** M (copy volume) but mechanical. **Verification:** `i18n/messages.test.ts`, `i18n/sharedCopyCoverage.test.tsx`, `i18n/intlRender.test.tsx`, `PalletScreens.test.tsx`, `PalletScene.test.tsx` and `PalletScene.a11y.test.tsx`.

#### F16. Design tokens: unused parallel semantics, one undefined class, and a literal map palette

**Evidence**
- `globals.css` defines a second semantic set next to the `--token-*` system: `--success/--warning/--info/--invert` (lines 203-210, 411-418) exposed as `--color-success-foreground`, `--color-warning-foreground`, `--color-info`, `--color-invert` (lines 104-110), plus `--chart-1…5`, `--color-qc-hold` (50, 178, 394) and `--color-band-*` (59-62, 198-201).
- `grep` finds **no use** of any of them in `src` (TSX, TS or CSS), `convex` or `tests`. If they were used, `text-success-foreground` would resolve to emerald-900, while the product's success is `#166534` and badges use `--token-badge-success`. That is a drift trap.
- `BarcodeImagePicker.tsx:188` uses `border-focus`, but there is no `--color-focus` token, so the crop outline falls back to the default border colour. The equivalent overlay in `LocationImageReader.tsx:245` uses `border-white`.
- `FloorMap.module.css:4-56` defines `--plan-*` literals for light mode that copy the global light values (`--plan-text #17212f` = `--foreground`, `--plan-link #1d4ed8` = `--primary`, `--plan-muted #475569` = `--muted-foreground`, `--plan-occupied #e3f3ea` = `--token-success-surface`, `--plan-occupied-border #166534` = `--token-success`). It then re-maps the app tokens inside `.theme`.

**Proposal:** remove the unused token families, or alias them to `--token-*`, and protect the choice with `theme-contrast.test.ts`. Fix `border-focus` to `border-ring`, or share one crop-overlay class between the two pickers. In `FloorMap.module.css`, make the **light** chrome entries reference global tokens (`--plan-text: var(--foreground)`, …). Keep the map-specific entries (floor, wall, grid, dot, empty, occupied) and the deliberately different dark map palette.
**Do not touch:** persisted area colour presets (`lib/storageLayouts/areaColors.ts`), `sceneColors.unavailable` (`#46566a`, persisted default), and `app/global-error.tsx` (self-contained colours, required because global error renders outside the app CSS).
**Risk/effort:** S. **Verification:** `ui/theme-contrast.test.ts`, `FloorMap.labels.test.tsx`, `FloorMap.workspace.test.tsx`, `AreaColorPicker.test.tsx` and `BarcodeImagePicker.test.tsx`.

#### F17. Layering: two component folders import feature code, and the lint guard does not cover them

**Evidence:**
- `components/storageLayouts/FloorMap.tsx:51,65` imports `@/features/storageKit/{PlacementStatusBadge,QrCode}`.
- `components/shell/search/SearchDialog.tsx:23` and `results.tsx:17` import `@/features/hr/format`.
- The `FEATURE_IMPORTS` rule covers only `src/components/{ui,system,table,providers}` (`eslint.config.mjs:185`).

**Proposal:** move `features/storageKit/*` (QrCode, QrDialog, PlacementStatusBadge: domain-neutral and shared by FG and storage) to `components/storageKit/`. Move `formatBusinessDate`, `formatDateTime` and `formatTime` (with the cached `Intl` factory) to `lib/format/datetime.ts` and re-export them from `features/hr/format.ts`. Then extend the lint rule to `components/{shell,storageLayouts,storageScene}`.
**Risk/effort:** S. **Verification:** `pnpm lint`, `pnpm typecheck`, `format.test.ts`, `GlobalSearch.test.tsx` and `FloorMap.*.test.tsx`.

### P3

#### F18. Dead, test-only or misplaced code on production paths
- Unused UI primitives (no importers): `ui/avatar.tsx`, `ui/progress.tsx`, `ui/separator.tsx`. `HrInitials` (`hr/HrUi.tsx:117-151`) re-implements an avatar fallback, which is fine for HR, but then `avatar.tsx` should go.
- Test-only reference previews in `components/storageLayouts`: `Fg1ReferencePreview.tsx` (613 lines), `F1F2ReferencePreview.tsx` (93) and `Fg1SourcePlan.tsx` (277). They are also lint-exempt (`eslint.config.mjs` SectionHeader rule). Move them under `_reference/` or the test fixtures.
- `features/finishedGoods/paginationTestAdapter.ts` (207 lines) and the `ProductScreens.tsx` facade (4 lines) are imported only by tests. Move them to `tests/support` or a `__tests__` helper.
- The production route `/master-data/storage-layouts/demo` ships `FloorMapDemo` with sample data and inline copy (`app/[locale]/(desktop)/master-data/storage-layouts/demo/page.tsx`). Confirm it is intended in production. If not, gate it on the environment.
- The production shell lives at `components/examples/c-sidebar-2.tsx` and is exported as `Pattern`, re-exported by `shell/DesktopShell.tsx`. Rename and move it to `components/shell/AppShell.tsx`. There is a co-located test, `c-sidebar-2.test.tsx`, to move with it.
- Deprecated aliases still exported: `FLOOR_PAGE_SIZES` (`system/PageSizeSelect.tsx:10-11`) and `PageHeader.description` (`ui/PageHeader.tsx:31-32`).
- `draftGuard.ts:12,28` and `DraftGuardProvider.tsx:97` describe the guard as "HR form" only, but FG uses it too.
**Effort:** S. **Verification:** `pnpm typecheck`, `pnpm lint` and `pnpm test`. Coverage of the moved tests is unchanged.

#### F19. Text fields: no `FormInput` counterpart to `FormSelect`, plus local wrappers
- About 26 inline `FormField` + `Input` render-prop pairs. Two local wrappers do the same job: FG `Field` (`finishedGoods/shared.tsx:152-208`) and storage `Field` (`StorageLayoutScreens.tsx:470-493`). The storage one uses `id={name}` rather than `useId`, so ids would collide if two such forms mounted together. Storage also has `OverrideField` (`:1779-1808`).
- Textarea: only `hr/CorrectionForm.tsx:29-77` (`ReasonField`, styled with `fieldControlClassName`). FG "describe the issue" uses a single-line `Field` (`MoveScreen.tsx:831-836`).
- Inline validation outside `FormField.error`: `hr/HolidaysScreen.tsx:86-90` renders a raw `<p role="alert">` for an invalid year.
- Filter selects without visible labels: `StorageLocationCatalogue.tsx:230-268` (`placeholder=""`, `emptyLabel=""`, `aria-label` only). HR and FG filters use visible `FormSelect` labels.
**Proposal:** add `ui/FormInput.tsx` (FormField + Input, generated id, value/onValueChange) and `ui/Textarea.tsx` (lifted from `ReasonField`'s control). Retire FG `Field` and storage `Field`. Use `FormField error` for HolidaysScreen. Give storage filters visible labels with `FormSelect`.
**Effort:** S–M. **Verification:** `FormField.test.tsx`, `FormSelect.test.tsx`, `HrScreens.test.tsx`, `StorageLocationCatalogue.test.tsx` and `pnpm test:a11y`.

#### F20. Three date and time formatting paths
HR's cached, timezone-aware `Intl` (`hr/format.ts:15-117`), next-intl `useFormatter` (`jobScan/JobScanRecordRow.tsx:34,124`), and ad-hoc `new Date(move.createdAt).toLocaleString(locale)` (`PalletScreens.tsx:1437`; passes lint because a locale is given, but has no explicit time zone). **Proposal:** `lib/format/datetime.ts` (see F17) plus a `useDateFormat()` next to `useMeasureFormat`. **Effort:** S. **Verification:** `format.test.ts`, `PalletScreens.test.tsx` and `JobScanRecords.test.tsx`.

#### F21. Search dialog loader and body duplicate the header, input, AI button and disclosure markup
`SearchDialogLoader.tsx:217-283` and `SearchDialog.tsx:199-266` contain the same title, icon-prefixed combobox input, AI button and `global-search-ai-disclosure`. The duplication exists so focus and IME state can be handed over seamlessly. **Proposal:** a tiny presentational `SearchInputRow` in the loader chunk (no data hooks) that both render. **Risk:** the focus/IME handoff tests (`SearchDialogLoader.test.tsx`, `SearchDialogFocus.test.tsx`, `GlobalSearch.test.tsx`, `SearchTriggers.test.tsx`) must stay green, and the loader chunk must stay light. **Effort:** S.

#### F22. Scene controls diverge between the pallet scene and the floor map
`PalletScene.tsx:604-710` builds view, rotate, zoom (with a % output) and reset from raw `Button size="icon"` inside `SceneToolbar`, which only `PalletScene` uses. `FloorMapCameraControls.tsx:52-145` uses `IconButton` plus a popover. Both use `StorageViewModeToggle`. The camera models differ legitimately: pallet zoom is 1–2.5 with reset, floor zoom 1–8 with fit, reference and packages. **Proposal:** share only the control primitives (`IconButton`, a `SceneZoomControls` with `min/max/step` props) and the toolbar container. Keep both camera hooks. **Effort:** S. **Verification:** `PalletScene.test.tsx` (`data-camera-zoom` assertions), `PalletScene.a11y.test.tsx` and `FloorMap.workspace.test.tsx`.

#### F23. Repeated "latest request wins" async pattern
`BarcodeImagePicker.tsx:33-128`, `LocationImageReader.tsx:66-145` and `LocationPicker.tsx` (`lookupVersion`) each combine a version counter, an `AbortController` and `busy`/`error` state. A small `useLatestTask()` (run, cancel, isCurrent) could serve the two image readers. **Leave `LocationPicker`'s `acquisitionOpen`/`lookupVersion` as they are**, because they encode scan-session ownership. **Effort:** S–M, and the value is moderate. Do this only together with F1/F2.

#### F24. HR draft-guard expression repeated
`useDraftGuard(write.state.kind !== "SAVED" && <dirty>, reset, write.pending?)` appears 7 times: `CorrectionForm.tsx:112`, `EmployeeForm.tsx:158`, `PeriodsScreen.tsx:194`, `PeriodDetailScreen.tsx:690`, `ReviewDetail.tsx:275,528` and `SettingsScreen.tsx:135`. An HR-local `useHrDraftGuard(write, dirty, discard)` would remove the repetition. It is optional and low value. Keep it HR-local because it depends on `HrWriteState`.

---

## 3. Recommended ownership: global vs domain-local vs separate

| Concern | Owner | Notes |
|---|---|---|
| Buttons, IconButton, inputs, `FormField`/`FormSelect`/**new `FormInput`/`Textarea`**, `SelectControl`, `SegmentedControl`, `CheckboxField`, `Dialog` (+ **`size="xl"`**), `ConfirmDialog`, **new `popover`/`dropdown-menu`**, `Notice`/`ErrorNotice`, `StatusBadge`, `EmptyState`, `Panel`, `SectionHeader`, `PageHeader`, `PageContainer`, `StickyActionBar`, `TableScroller`/`DataTable`, `DescriptionList`, `CollapsibleSection`/`summaryClassName` | **Global** `components/ui`, `components/table` | Lint keeps them feature-free. |
| Glyph aliases: `ScanIcon`, **new `AiIcon`** | **Global** `components/ui` | One glyph per cross-domain intent. |
| Read gating: `QueryGate`, `OutcomeGate`/`DataGate`, `LedgerPanelStatus`, `RouteLoading`, `QueryErrorBoundary` | **Global** `components/system` | Adopt in FG and storage (F4). |
| Pagination: `useCursorPagination`, `useScanContinuation`, `useCatalogueSync`, `CursorPagination`, `PaginationFooter`, `PageSizeSelect` | **Global** hooks/system | HR adopts (F12). |
| Draft and navigation guard | **Global** providers/system | Storage keeps its own `useNavigationGuard` instance for save-and-continue (`StorageLayoutScreens.tsx:977`); this is intentional. |
| `useAsyncOperation`, `useRequestIdentity`, `written()`, `resolveWriteError` | **Global** hooks/lib | FG (`useOperation`) and **storage (`useStorageOperation`, new)** wrap them. |
| `useHrWrite`, `WriteFeedback`, `HrGate`, `useHrError` | **HR-local** | Different outcome model (UNCERTAIN with verbatim retry, session-pinned IDs). **Do not merge with `useAsyncOperation`.** |
| Date/time formatting (`lib/format/datetime.ts`), measure formatting | **Global** lib | Moved out of HR (F17/F20). |
| Camera: **`useStillCamera`, `CameraViewport`, `captureVideoFrame`, `imageIntake.ts`** | **FG-local** `features/finishedGoods/camera/` | Only FG and JOB use cameras. Promote to global only if another domain needs one. |
| `useBarcodeCamera`, `BarcodeCameraBox`, `BarcodeImagePicker`, decoder and worker | **FG-local** (unchanged) | Keep the dedupe, single-code fallback, serialised startup and torch. |
| `LocationImageReader`, `LocationPicker`, `TicketFieldScanner`, `ticketDraft` | **JOB-local** | Session guards stay with their owners. |
| QR (`QrCode`, `QrDialog`), `PlacementStatusBadge` | **Shared storage kit** → `components/storageKit` | Used by FG and storage; currently `features/storageKit`. |
| `ZoneEditorDialog`, `ZoneGeometryFields`, `useStorageOperation`, `storageErrorMessage` overrides | **Storage-local** | Zones and reserved areas keep separate save models. |
| Floor-map theme (`--plan-*` map colours), scene colours, **persisted area colours** | **Storage-local** / `lib/storageLayouts` | Alias only the light chrome to globals (F16). Never theme persisted colours. |
| Map/scene camera hooks (`useFloorMapCamera`, PalletScene state) | **Domain-local** | Share only control primitives (F22). |
| `HrToolbar`, `HrStatStrip`, `HrTimeCell`, `HrInitials`, `HrActionCard` | **HR-local** | `HrStatStrip` overlaps `DescriptionList layout="stat"` but differs in tone, rule and auto-fit, with one caller. Do not force it. |

**Keep separate (do not unify):** the AI ticket-photo flow vs the AI location reader (multi-photo burst with upload vs single read with candidate review); barcode intake vs AI read; FG `Missing` copy vs HR denial copy (only the transport layer should be shared); HR inline two-step confirm vs dialog confirm; storage vs FG write retries; floor-map vs pallet camera models.

---

## 4. Migration groups and test plans

Order: start with low-risk groups so later groups have stable primitives. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (all Vitest projects) and `pnpm test:a11y` after each group. Each group should be its own PR.

**G1 — Hygiene and tokens (F16, F17, F18, F11). Effort S.**
1. Remove unused UI primitives and unused token families, or alias them. Fix `border-focus`.
2. Move `storageKit` to `components/storageKit`. Move date formatting to `lib/format/datetime.ts` and re-export it. Extend the `FEATURE_IMPORTS` lint scope.
3. Relocate the test-only reference previews, `paginationTestAdapter.ts` and `ProductScreens.tsx`. Rename `examples/c-sidebar-2` → `shell/AppShell`.
4. Codemod icon-only `Button`s to `IconButton` with record-specific labels.

Tests: `theme-contrast.test.ts`, `format.test.ts`, `F1F2ReferencePreview.test.tsx`/`Fg1ReferencePreview.test.tsx` (moved), `ProductScreens*.test.tsx`, `BatchManager.test.tsx`, `c-sidebar-2.test.tsx` (moved), `StoragePositions.a11y.test.tsx`, `PalletScene.a11y.test.tsx`, `pnpm test:a11y`.

**G2 — Storage write path (F5, F14). Effort S–M.**
`useStorageOperation`, `resolveWriteError(…,"storage")` with overrides, `written()`, `ErrorNotice`, and `useCanManage`. Gate the "New building" CTA and form.
Tests: `StorageLayoutScreens.test.tsx`, `BuildingStatusToggle.test.tsx`, `BuildingAreaDetails.test.tsx`, `StorageLocationCatalogue.test.tsx`, `lib/resolveWriteError.test.ts` (add the storage case), `hooks/useAsyncOperation.test.tsx`, `tests/integration/storage-layouts.integration.test.ts`, `storage-location-catalogue.integration.test.ts`.

**G3 — Read gating (F4). Effort M, with a product decision first.**
`OutcomeGate`/`DataGate` in FG detail screens and the storage building and catalogue. Remove `Loading`/`LoadingCard`.
Tests: `PalletScreens.test.tsx`, `MoveScreen.test.tsx`, `PackingScreen.test.tsx`, `StackScreen.test.tsx`, `BatchManager.test.tsx`, `ProductBatches.navigation.test.tsx`, `StorageLayoutScreens.test.tsx`, `useStorageBuilding.test.tsx`, `DataGate.test.tsx`, `LedgerPanelStatus.test.tsx`.

**G4 — Dialogs and destructive actions (F6, F8). Effort M.**
`DialogContent size="xl"`. Adopt `ConfirmDialog` in Move, Packing review and Batch discard. Make storage editors non-dismissible while pending. Add confirmation for archive zone and delete holiday. Build `ZoneEditorDialog` and `ZoneGeometryFields`.
Tests: `ui/dialog.test.tsx`, `sharedControls.test.tsx`, `MoveScreen.test.tsx`, `PackingScreen.test.tsx`, `BatchManager.test.tsx`, `StorageLayoutScreens.test.tsx`, `StorageZoneDraftPreview.test.tsx`, `AreaColorPicker.test.tsx`, `SettingsHoliday.guard.test.tsx`, `HrScreens.test.tsx`, `useNavigationGuard.test.tsx` (prompt unchanged).

**G5 — Camera and AI acquisition (F1, F2, F3, F23). Effort M–L.** This is the highest-risk group, so do it in this order:
- (a) `imageIntake.ts`
- (b) `captureVideoFrame` + `useStillCamera` adopted by `PhotoCapture`, with a **new** `PhotoCapture.test.tsx` written first
- (c) `CameraViewport` across the three cameras
- (d) `AiIcon`, the AI naming and disclosure copy, and provenance
- (e) optionally `useLatestTask` for the two image readers

**Coordinate with the in-flight `useWorkflowStep` changes in `JobScanScreen`/`JobScanRecords`/`LocationPicker`.**
Tests:
- Unit: `useBarcodeCamera.test.tsx`, `BarcodeCameraBox.test.tsx`, `BarcodeImagePicker.test.tsx`, `BarcodeLocationImage.test.tsx`, `barcodeImage.test.ts`, `barcodeImage.worker.test.ts`, `barcodeImagePipeline.test.ts`, `barcodeDecoder.test.ts`.
- Components: `DestinationScanner.test.tsx`, `jobScan/LocationPhotoCamera.test.tsx`, `LocationPicker.test.tsx`, `LocationPicker.ai.test.tsx`, `LocationPicker.image.test.tsx`, `JobScanScreen.test.tsx`, `JobScanPhotoPreview.test.tsx`, `TicketCard.test.tsx`, `ticketDraft.test.ts`, `GlobalSearch.test.tsx`, `i18n/messages.test.ts`.
- Playwright: `tests/e2e/workspace/{barcode-scanning,barcode,location-image-ai}.spec.ts` and `tests/e2e/smoke/barcode-worker.spec.ts`. These need the local fixture; see README.
- Physical-device camera check: required, not replaceable by tests.

**G6 — Layout and responsiveness (F7, F13, F9, F10). Effort M.**
Container-query standard for table vs cards. Breakpoint constants for the floor workspace. Page width owned by screens. `PageHeader` spacing. `SegmentedControl` adoption. `ui/popover` and `dropdown-menu`. Read the Next.js layout docs first.
Tests: `FinishedGoodsMobileList.test.tsx`, `CatalogueFilterControls.test.tsx`, `FloorLocationTable.test.tsx`, `FloorMap.workspace.test.tsx`, `useFloorWorkspaceView.test.tsx`, `useFloorMapViewport.test.tsx`, `HrScreens.test.tsx`, `PageHeader*.test.tsx`, `StickyActionBar.test.tsx`, `StatusReason.test.tsx`, `ui/sidebar.test.tsx`, plus a manual visual review at phone, tablet and desktop widths.

**G7 — HR alignment and copy (F12, F15, F19, F20, F21, F24). Effort M.**
HR requests on `useCursorPagination` (add the `Pagination` namespace to the HR scope). Move `tr()`/`PalletScene` copy into the catalogue. `FormInput`/`Textarea`. Visible storage filter labels. `useDateFormat`. Optionally `SearchInputRow` and `useHrDraftGuard`.
Tests: `SelfService.test.tsx`, `selfService.test.ts`, `HrNavigation.test.tsx`, `HrShortcuts.test.tsx`, `ShortcutCustomizeScreen.test.tsx`, `CorrectionForm.independent.test.tsx`, `EmployeeForm*.test.tsx`, `PeriodsScreen*.test.tsx`, `HolidayDraftGuard.independent.test.tsx`, `useCursorPagination.test.tsx`, `PalletScreens*.test.tsx`, `PalletScene*.test.tsx`, `FormField.test.tsx`, `FormSelect.test.tsx`, `SearchDialog*.test.tsx`, `i18n/*.test.ts(x)`, `tests/integration/hr-*.integration.test.ts`.

---

## 5. False positives and already-solved examples

- **"Dialogs, forms and selects are inconsistent."** Selects are **solved**: no native `<select>`, `SelectControl`/`FormSelect` are lint-enforced, and `LocaleSwitcher` is the only documented exception. Forms broadly use `FormField`/`FieldGroup`; the remaining gap is the missing `FormInput`/`Textarea` (F19). Dialogs share one primitive with focus-return logic (`ui/dialog.tsx:62-87`); the gaps are behaviour and width (F6).
- **"Barcode camera is duplicated."** Barcode scanning is **already shared** (`BarcodeCameraBox` in JOB intake, the ticket-field scanner, destination/source/support verification and the location picker). The duplication is between barcode and the **still-photo AI** paths, and within those paths (F1).
- **"Pagination differs per page."** It is solved in FG, storage and JOB. Only the new HR requests screen differs (F12).
- **"Two write hooks (`useAsyncOperation` vs `useHrWrite`) are duplicates."** They are not. They encode different, intentional retry and uncertainty semantics. Share only the presentation (`ErrorNotice`/`Notice`), not the state machines.
- **"StorageLayoutScreens uses its own navigation guard."** This is intentional: it offers save-and-continue (`save: editorRef.current.save()`), which the shell `DraftGuardProvider` deliberately does not.
- **"Hex colours in storage code violate the token system."** `areaColors.ts` presets and `sceneColors.unavailable` are **persisted physical colours** and must stay hex. `global-error.tsx` must be self-contained. The floor-map `--plan-*` scope is a deliberate map theme; only its light-mode chrome duplicates globals (F16).
- **"Status badges differ by domain."** They are already consolidated on `StatusBadge`. Domain-specific tone maps are appropriate.
- **"`<details>` vs `CollapsibleSection` is inconsistent."** It is a documented pair (`ui/disclosure.ts`), and every native `<summary>` uses `summaryClassName`.
- **"`HrStatStrip` duplicates `DescriptionList stat`."** It overlaps but differs (auto-fit columns, top rule, tones) and has one caller. Leaving it HR-local is reasonable.
- **"`FloorMap.tsx` and `FloorMapDrawing.tsx` are copies"** (both 1,196 lines). They are not: a whitespace-insensitive diff shows them almost entirely different (map shell vs SVG drawing).
- **"Every dialog needs a close label."** Every `DialogContent` call site already passes `closeLabel` or hides the button. The English default in `dialog.tsx:51` is never reached in production code paths I read.

---

### Appendix: notable line references for quick navigation

- Camera lifecycles: `useBarcodeCamera.ts:55-216`; `LocationPhotoCamera.tsx:36-125, 133-183`; `PhotoCapture.tsx:52-100, 120-149`; `BarcodeCameraBox.tsx:87-91, 121-193`.
- AI affordances: `SearchTriggers.tsx:67`; `SearchDialog.tsx:245-266`; `LocationPicker.tsx:189-225`; `PhotoCapture.tsx:208-219`; `BarcodeImagePicker.tsx:162, 340-352`; `LocationImageReader.tsx:200-231, 279, 307-315`; `JobScanScreen.tsx:459-488`; `TicketCard.tsx:96-103`.
- Storage outcomes: `StorageLayoutScreens.tsx:375, 394, 627-700, 1194, 1461, 2902, 2945`; `StorageZonesPanel.tsx:143-146, 362-410`; `BuildingStatusToggle.tsx:54-107`; `storageLayoutShared.tsx:30-38`; `lib/resolveWriteError.ts:1-21`.
- Dialogs: `MoveScreen.tsx:713-870`; `PackingScreen.tsx:1451-1536`; `BatchManager.tsx:145-160, 233-256`; `StorageZonesPanel.tsx:420-640`; `StorageLayoutScreens.tsx:569-608, 2672-2800`; `BuildingAreaDetails.tsx:56-68`.
- Responsiveness: `hooks/use-mobile.ts:3`; `useStorageLayoutMobile.ts:5`; `useFloorWorkspaceView.ts:53-55`; `FinishedGoodsTable.tsx:64-80`; `HistoryScreen.tsx:293`; `EmployeesScreen.tsx:182-190`; `FloorMap.module.css:226, 383`.
