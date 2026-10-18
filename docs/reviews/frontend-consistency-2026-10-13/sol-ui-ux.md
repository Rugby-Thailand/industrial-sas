# Independent Sol 6.1 UI/UX consistency research — 2026-10-13

Finalized: 2026-10-13T09:13:26+07:00.

Scope: current filesystem in `/Users/macbook/Development/industrial-sas`, including dirty tracked files and untracked production HR/search code. Research and planning only. No application, test, configuration, or repository documentation edits. AGENTS.md read; no Next.js code was written. No browser control, tests, or runtime workflow assertions were performed by this researcher. Parent owns browser verification; parent reports that frontend shell renders on port 3100 but Convex localhost:3211 is offline.

This is a source-backed audit, not a screenshot verdict. High-confidence observations describe concrete current render/interaction branches; visual crowding and responsive risks still need a connected preview. Preserve the existing blue/neutral palette, dark theme, geometry representations, user-entered records, and domain workflows.

## Coverage inventory

Inventory found 40 locale `page.tsx` entrypoints and 52 app locale production TSX files. Counts below exclude tests and `_prototype` assets and include production helpers, not only visible screens. Main screen render paths, shared controls, relevant state ownership, and custom CSS were inspected; not every line of every geometry helper was read.

| Area               | Production TS/TSX/CSS inventory | Coverage                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App locale routes  |                              52 | Auth sign-in, public about/privacy/terms, setup, root redirects, error/not-found, HR today/time/day/profile/review/employees/periods/period/requests/request/holidays/customize/settings, finished goods catalogue/new/product/packing/batch/pallet/measure/storage/move/stack/scan/records, storage catalogue/new/building/review/floor redirect/demo and route message layouts. |
| Finished goods     |                              54 | Catalogue/table/mobile list/filter sheet and popovers; product/batches/batch manager; packing/completion/dimensions; pallet measurement/placement/storage/move/stack and scene controls; shared headings/status/errors/draft helpers; all job scan acquisition/location/ticket/records render paths.                                                                              |
| HR                 |                              24 | Current dirty and untracked screens, forms, toolbar/stats/time/card/initial primitives, self-service navigation, write/format helpers, supervisor decision and period/export layouts.                                                                                                                                                                                             |
| Storage layouts    |                              15 | Building and location catalogues; unmeasured registered locations; new building/settings/editor/review; zones/reserved areas; occupancy; status toggle; floor selection/query helpers.                                                                                                                                                                                            |
| Storage kit        |                               3 | QR rendering/dialog and placement badge semantics.                                                                                                                                                                                                                                                                                                                                |
| UI primitives      |                              47 | Page/header/breadcrumb/back/container; panel/section/description; button/icon/variants; field/input/select/search/scan/checkbox; segment/disclosure; dialog/sheet/details/confirm; notices/empty/status/reason; table/scroller/pagination; theme toggle and sidebar.                                                                                                              |
| Shell              |   14 (+ real shell in examples) | DesktopShell alias and `examples/c-sidebar-2.tsx`; desktop rail/mobile drawer; organization/warehouse context; navigation links/pending; account/locale/theme; search trigger/provider/dialog/AI/loader/result surfaces.                                                                                                                                                          |
| System             |                              14 | Collection toolbar/paging; query/data/access gates and query error fallback; loading/navigation guard/progress; setup/public info.                                                                                                                                                                                                                                                |
| Storage components |                              26 | FloorMap/drawing/CSS/toolbar/list/table/inspector/bottom sheet/camera; zone draft and 2D/3D visualizer; area color picker; camera/pan/viewport/media hooks; reference/demo reachability.                                                                                                                                                                                          |
| Scene components   |                               3 | SceneBox/legend, SceneToolbar, scene semantic colors.                                                                                                                                                                                                                                                                                                                             |
| Hooks              |             13 at final recheck | Mobile boundary, request/write/file/draft/format/catalogue/pagination/continuation ownership; display-facing consequences.                                                                                                                                                                                                                                                        |
| i18n               |                               8 | Route/shell namespace composition, guarded localized routing, locale defaults, measurement formatting; both locale message copies inspected for reported semantics.                                                                                                                                                                                                               |

## Existing system to reuse

The app already has most of the required shared vocabulary. Creating parallel replacements would increase inconsistency.

- `src/app/globals.css:9` defines the canonical dense condition: width >= 768px **and fine primary pointer**. `globals.css:76` defines 48px touch / 36px dense targets and `globals.css:83` the 2/8/16/24px rhythm. `ui/buttonVariants.ts:25`, `ui/input.tsx:10`, `ui/select.tsx:30`, and planner module CSS already adopt it. `lg`, `default`, and `touch` button aliases currently share the same sizing; searching for `size="lg"` alone does not prove oversizing.
- `ui/PageContainer.tsx:4`, `PageHeader.tsx:32`, `Panel.tsx:9`, `SectionHeader.tsx:14`, and `DescriptionList.tsx:25` provide page width, outline, one task surface, section hierarchy and metric/fact layouts.
- `ui/FormField.tsx:67`, `FormSelect.tsx:20`, `SelectControl.tsx:79`, `ScanCodeInput.tsx:29`, `SearchField.tsx`, and `CheckboxControl.tsx` provide names, hints, invalid state, shared field shape and scan actions. Current selects have already been migrated to Radix; a generic native-select migration is obsolete.
- `ui/ConfirmDialog.tsx:66`, `dialog.tsx:68`, `DetailsPanel.tsx:30`, and `StickyActionBar.tsx:22` provide pending-dismiss protection for confirmations, opener focus return, sheet width and measured fixed-footer inset.
- `system/CollectionToolbar.tsx:27`, `PaginationFooter.tsx:37`, `CursorPagination.tsx:39`, `PageSizeSelect.tsx:15`, and `table/DataTable.tsx:75` provide collection presentation while keeping server/local paging state distinct.
- `system/DataGate.tsx:30`, `QueryGate.tsx:16`, `LedgerPanelStatus.tsx:25`, `ui/Notice.tsx:66`, `EmptyState.tsx:35` already distinguish loading, denied, failed, empty and filtered states. Do not collapse these into a generic empty card.
- `storageScene/SceneToolbar.tsx:29`, `storageLayouts/useFloorWorkspaceView.ts:54`, `FloorMap.tsx:954`, and `FloorMap.module.css:256` already solve bounded scene controls, container-aware split/inspector behavior and mobile details. Their custom anatomy has legitimate reasons.

## Prioritized findings

### F1 — High: AI ticket preview does not show the frame that will actually be captured

Evidence: `src/features/finishedGoods/jobScan/PhotoCapture.tsx:132` forces a 3:4 mobile / 4:3 desktop video with `object-cover` and max-height 55vh. `PhotoCapture.tsx:87` sizes the capture canvas to native `videoWidth`/`videoHeight` and `PhotoCapture.tsx:89` draws the full frame. On a landscape camera feed in the portrait viewport, significant horizontal content is invisible to the operator but included in AI extraction. Barcode and location AI already preserve native ratio and use `object-contain` (`finishedGoods/BarcodeCameraBox.tsx:124`, `jobScan/LocationPhotoCamera.tsx:138`).

Impact: operators cannot reliably frame one ticket and may include another label outside the visible camera view. Also creates a larger camera block for one acquisition path than the other two.

Recommendation: reuse the measured native-ratio camera viewport behavior from BarcodeCameraBox/LocationPhotoCamera, with one bounded visual frame and consistent status/action anatomy. Keep barcode auto-detection, AI ticket multi-photo queue, and AI location one-photo review as separate workflows. If intentional crop is wanted, capture that same crop and expose it explicitly; do not silently use a different frame.

Verification: native 16:9 and 4:3 feeds, phone portrait/landscape, narrow desktop, and a ticket at each edge; captured image contains exactly what the visible framing promises. Retain multi-photo selection, blob cleanup, stream shutdown, 20-photo maximum and explicit AI-submit action.

Relevant current tests: `src/features/finishedGoods/BarcodeCameraBox.test.tsx`, `src/features/finishedGoods/jobScan/LocationPhotoCamera.test.tsx`, `src/features/finishedGoods/jobScan/JobScanScreen.test.tsx`, `src/features/finishedGoods/jobScan/JobScanPhotoPreview.test.tsx`. There is no current `PhotoCapture.test.tsx` in the inventory; do not claim one exists.

### F2 — High: a location-row status switch changes the whole building

Evidence: `src/features/storageLayouts/StorageLocationCatalogue.tsx:366` labels the column generically as Status and `:372` renders BuildingStatusToggle on each location. It passes `row.buildingId` and `row.buildingCode` at `:374`. `BuildingStatusToggle.tsx:90` calls building activate/returnToDraft with buildingId; accessible copy is explicitly “Active building: {code}” (`messages/en.json:648`), but visible row context is a single location. `BuildingStatusToggle.tsx:173` reserves 48px row height and `:184` reserves a separate 48px feedback slot even when no feedback exists.

Impact: visible scope suggests changing one location when all locations in the building are affected. Repeats the same write control and wide blank feedback area across many rows.

Recommendation: show a read-only StatusBadge in the location rows and keep one clearly labeled building-status control in building catalogue/editor contexts. If building activation must remain reachable from the locations table, expose a deliberate “Building status” action with the building name and scope visible. Reuse current toggle and StatusBadge; do not invent a new status system or change write semantics.

Verification: changing one building still changes every related row through authoritative data; no row falsely implies a per-location active toggle; permission loading/read-only/archived/occupied/version-conflict behavior stays intact. Inspect long Thai labels and many same-building rows.

Relevant current tests: `src/features/storageLayouts/StorageLocationCatalogue.test.tsx`, `src/features/storageLayouts/BuildingStatusToggle.test.tsx`, `src/features/storageLayouts/StorageLayoutScreens.test.tsx`.

### F3 — High: storage zone writes allow dismissal and input changes during the pending command

Evidence: `src/features/storageLayouts/StorageZonesPanel.tsx:423` immediately accepts dialog open changes and `:425` closes regardless of pendingAction. `:450` keeps the close X visible. Inputs and preview callbacks at `:480`, `:498`, `:521`, `:542`, `:574` remain enabled. Footer Cancel uses DialogClose without disabled state at `:609`; only Save reflects pending (`:625`). Mutation captures its draft before awaiting at `:333` and success clears label/editor state at `:375`.

Impact: apparent Cancel can hide a write already in progress; later edits can be overwritten by success cleanup. The user cannot distinguish cancellation of UI from completion of the original command. This is materially different from batch editor and confirmations, which freeze/retain pending state (`BatchManager.tsx:154`, `ConfirmDialog.tsx:66`).

Recommendation: adopt the established pending-write behavior: freeze editable inputs/drag controls, prevent dismissal while pending, hide/disable close and Cancel, retain clear pending label until result. Keep permission-revoked closure behavior and occupied-change review logic. Prefer a narrow reuse of dialog busy policy and existing fieldset/Button conventions; do not convert the geometry editor into ConfirmDialog.

Verification: delayed success/refusal/network error; Escape, overlay, X, Cancel and drag/input attempts during pending; no payload changes and no misleading cancellation; after failure values remain available for retry; permission revocation still closes safely.

Relevant current tests: `src/features/storageLayouts/StorageLayoutScreens.test.tsx` (existing “pending storage actions” section around `:2211` currently checks submit pending appearance), `src/features/storageLayouts/StoragePositions.a11y.test.tsx`, `src/features/finishedGoods/BatchManager.test.tsx`, `src/components/ui/dialog.test.tsx`.

### F4 — Medium: creation forms have weaker unsaved/pending navigation behavior than editing forms

Evidence: `src/features/storageLayouts/StorageLayoutScreens.tsx:369` owns NewBuildingContent; its uncontrolled inputs/form at `:404` have no draft registration/lock. Back is an enabled Link at `:461` while Create is pending at `:458`. `src/features/finishedGoods/jobScan/AddLocationForm.tsx:108` freezes its fields during a write, but Cancel remains enabled at `:259`; `:87` intentionally suppresses late UI application after unmount, although the backend create can still finish. Compare the current employee `fieldset disabled={write.locked}` at `EmployeeForm.tsx:259`, its Cancel lock at `:505`, and floor navigation guard at `StorageLayoutScreens.tsx:977`.

Impact: users can leave an in-flight creation and infer it was canceled; typed new-building/location data is less protected than similar application forms. It is not a claim that all forms need persistent drafts.

Recommendation: reuse DraftGuard/useNavigationGuard for genuinely unsaved form values and pending commands; lock explicitly local Cancel during pending. Decide whether explicit Cancel discards unsaved creation input or prompts, but document and apply that same behavior across equivalent creation forms. Avoid persistent storage of sensitive/new drafts without a product reason.

Verification: type then browser/page Back, sidebar navigation, language/warehouse change; pending create followed by attempted navigation; no duplicate creates or ambiguous result; intentional discard still works when settled.

Relevant current tests: `src/features/storageLayouts/StorageLayoutScreens.test.tsx`, `src/features/finishedGoods/jobScan/AddLocationForm.test.tsx`, `src/components/providers/DraftGuardProvider.test.tsx`, `src/components/system/useNavigationGuard.test.tsx`.

### F5 — Medium: acquisition controls repeat start/stop and fallback choices with uneven hierarchy

Evidence: `BarcodeCameraBox.tsx:184` always adds a full-width Start/Stop camera button. DestinationScanner also embeds an input scan icon that calls the same action (`DestinationScanner.tsx:133`, `:137`). LocationPicker already has a pressed scan action at `LocationPicker.tsx:187`. The image picker additionally exposes full-width AI fallback (`BarcodeImagePicker.tsx:337`) while LocationPicker separately has the AI icon at `:205`. LocationImageReader shows camera shutter plus Choose image and Use device camera simultaneously (`LocationPhotoCamera.tsx:172`, `LocationImageReader.tsx:200`, `:221`). The camera recovery case can stack Retry and Stop as separate full-width rows (`BarcodeCameraBox.tsx:173`, `:184`).

Impact: repeated controls for the same operation consume vertical room around the useful frame/code and weaken the next action, especially phones. The duplicate device-camera/web-camera capability itself is useful and should remain available.

Recommendation: define one acquisition presentation rule using existing IconButton, Button, ScanCodeInput, SectionHeader and Notice: one mode entry; one camera state control; primary capture/use action; compact adjacent file choice; secondary fallbacks revealed when relevant. Let BarcodeCameraBox be composed without an extra generic full-width camera toggle where an owning scan action already exists. Avoid icon-only ambiguity for choosing **different** acquisition methods; camera=photo capture, ScanIcon=barcode/QR decoding, Sparkles=AI extraction.

Verification: each capability remains reachable by keyboard/touch, no duplicate Start/Stop entrypoints in one visible task, button names explain AI/local decoding, unavailable camera still offers file/manual recovery, scan continuation and stream ownership unchanged.

Relevant current tests: `BarcodeCameraBox.test.tsx`, `BarcodeImagePicker.test.tsx`, `DestinationScanner.test.tsx`, `jobScan/LocationPicker.test.tsx`, `jobScan/LocationPicker.ai.test.tsx`, `jobScan/LocationPicker.image.test.tsx`, `jobScan/LocationPhotoCamera.test.tsx`, `jobScan/JobScanScreen.test.tsx` (all within `src/features/finishedGoods`).

### F6 — Medium: AI ticket camera has weaker failure recovery and accessibility feedback

Evidence: `PhotoCapture.tsx:136` renders a plain overlay paragraph for startup/error; `:138` uses generic cameraError. Unlike BarcodeCameraBox's warning Notice (`:153`), live status (`:168`) and Retry (`:173`), and LocationPhotoCamera's Notice/Retry (`:150`), ticket capture has no Retry camera action or live error/status semantics. Startup happens once in an effect with no retry dependency (`PhotoCapture.tsx:52`, `:81`). Its video has no accessible preview label at `:127`. Current cameraError copy says “Allow camera access or type instead” (`messages/en.json:1403`), but the visible ticket-camera panel itself offers photo selection/cancel rather than typed entry.

Impact: temporary camera failure requires closing/reopening a mode; a screen-reader user receives less useful state feedback; fallback instruction refers to an action outside the panel.

Recommendation: reuse current Notice/live-status/Retry behavior and localized camera-preview label from other camera implementations. Keep chosen photos when retrying. Error copy should point to visible fallback actions and discriminate permission versus unavailable/start failure where the existing implementation knows the cause.

Verification: denied permission, later grant, device busy, playback failure, no getUserMedia; retry retains photo queue and does not accumulate streams; all states announced once without repeated scan spam.

Relevant current tests: camera and job scan files listed under F1/F5; camera lifecycle mechanics also in `src/features/finishedGoods/useBarcodeCamera.test.tsx`.

### F7 — Medium: request detail direct links do not return to their parent list

Evidence: `src/features/hr/RequestsScreen.tsx:203` renders PageHeader without breadcrumbs. `PageHeader.tsx:53` defaults fallbackHref to `/` if no parent crumb; `PageBackButton.tsx:22` uses that fallback when no tracked history exists. Day and period detail already pass their actual parents (`DayScreen.tsx:37`, `PeriodDetailScreen.tsx:81`). Scan entry and records headers similarly use Heading without a finished-goods crumb (`JobScanScreen.tsx:365`, `jobScan/JobScanRecords.tsx:176`).

Impact: a copied/bookmarked request detail sends Back to the app root/storage landing rather than Requests. Ordinary history Back remains valid and should be kept.

Recommendation: use existing PageHeader breadcrumbs with `ROUTES.hrRequests` on request detail. Audit other true child routes, including scan/records, for explicit parent fallback; customize already has a Today parent at `ShortcutCustomizeScreen.tsx:54`. No new breadcrumb implementation.

Verification: direct open with empty app history returns to parent; navigation from a prior page still goes back to that actual page; locale, search query and draft guard semantics stay intact.

Relevant current tests: `src/features/hr/SelfService.test.tsx`, `src/features/hr/HrNavigation.test.tsx`, `src/components/ui/PageHeader.test.tsx`, `src/components/ui/PageBackButton.test.tsx`, `src/lib/browser/history.test.ts`.

### F8 — Medium: invalid geometry uses a success icon and misleading generic boundary wording

Evidence: `src/components/storageLayouts/StorageZoneDraftPreview.tsx:112` computes overlap; `:125` combines positive dimensions, height, boundaries and overlap into fitsFloor. `:274` always shows CheckCircle2, including invalid state; `:277` calls every invalid condition “outside floor” even if dimensions are zero, stack height too high, or another zone overlaps. The zone form separately disables Save via its similar validity predicate (`StorageZonesPanel.tsx:263`, `:633`).

Impact: a check icon reinforces success while invalid text/color warns. Users cannot tell which value to fix when a geometrically inside-floor region is rejected for overlap or height. Existing visual constraints should stay intact.

Recommendation: reuse StatusBadge/TONE_ICONS and FieldMessage/Notice patterns; return reasoned presentation from geometry validity (nonpositive size, height, boundary, overlap), with accurate localized text and inline field association where possible. This need not create a new general validation framework.

Verification: each invalid reason is stated accurately, icon changes as well as color, valid case stays quiet/successful, drag and typing produce same reason, occupied/reserved overlap exceptions keep identical geometry rules.

Relevant current tests: `src/components/storageLayouts/StorageZoneDraftPreview.test.tsx`, `src/features/storageLayouts/StorageLayoutScreens.test.tsx`, `src/features/storageLayouts/StoragePositions.a11y.test.tsx`, `src/lib/storageLayouts/storagePlacementGeometry.test.ts`.

### F9 — Low/medium: HR request pagination duplicates the shared presentation and loses live status

Evidence: `RequestsScreen.tsx:169` implements its own wide Previous/Page/Next layout with text arrows. Page indicator at `:178` has no live status semantics. Existing PaginationFooter uses compact named IconButtons and an aria-live indicator (`system/PaginationFooter.tsx:48`, `:51`); other paged collections consistently use it through CursorPagination. HR requests correctly use their own server contract (limit 20 at `RequestsScreen.tsx:60`).

Recommendation: reuse PaginationFooter presentation with a fixed-size or omitted size control; retain requests' own cursor/state and API. Do not replace fixed 20 with warehouse cursor page-size options or blindly import CursorPagination (HR route namespace currently lacks Pagination at `i18n/clientMessages.ts:39`). Keep text labels if usability evidence favors them, but make placement/status/name conventions shared.

Verification: previous/next states and full-history filtering unchanged; page change announced; small Thai screens do not need a large extra pagination row; no cursor history or namespace regression.

Relevant current tests: `src/features/hr/SelfService.test.tsx`, `src/components/system/PaginationFooter.test.tsx`, `src/i18n/sharedCopyCoverage.test.tsx`.

### F10 — Low/medium: ordinary form width/alignment and action placement lack a clear route contract

Evidence: centered form PageContainer wraps scan heading and task (`JobScanScreen.tsx:364`, `:405`). Product header remains full shell width while only the form is max-w-3xl/left-aligned (`ProductScreen.tsx:317`, `:337`). New building has the same left-aligned form (`StorageLayoutScreens.tsx:404`) under a full-width route header (`src/app/[locale]/(desktop)/master-data/storage-layouts/new/page.tsx:25`). HR's page layout is centered max-w-7xl (`src/app/[locale]/(desktop)/hr/layout.tsx:10`) but profile task itself is left max-w-3xl (`ProfileScreen.tsx:52`). Scan uses responsive fixed footer (`JobScanScreen.tsx:588`), packing uses sticky footer (`PackingScreen.tsx:1402`), product uses inline footer (`ProductScreen.tsx:423`) and measurement uses a framed action panel (`PalletScreens.tsx:537`).

Impact: similarly sized forms appear at different horizontal origins and their next actions move differently on phones. This is a visual consistency candidate, not evidence that every task must have one layout.

Recommendation: use PageContainer's existing form/compact/wide/full contracts at the task boundary, aligning header and content; explicitly allow a wide scene plus narrower inspector. Document when a long mobile task earns StickyActionBar and when a short form uses an inline DialogFooter-style action row. Preserve full-width geometry surfaces and domain-specific action meanings.

Verification: screenshots at 390/768/1024/1440, expanded/collapsed rail, both locales; header/fields/actions line up per declared page type; no fixed footer obscures error text/last field; no mobile viewport jump or lost draft.

Relevant current tests: `src/components/ui/StickyActionBar.test.tsx`, `src/components/ui/PageHeader.test.tsx`, `src/features/finishedGoods/ProductScreens.a11y.test.tsx`, `PalletScreens.a11y.test.tsx`, `PackingScreen.test.tsx`, `src/features/storageLayouts/StorageLayoutScreens.test.tsx`.

### F11 — Low: one-item row menu adds an unnecessary interaction while another action stays separate

Evidence: `jobScan/JobScanRecordRow.tsx:133` opens a MoreVertical dropdown; it contains only Change location (`:158`–`:166`). Delete remains a separate adjacent IconButton at `:171`. Two targets still occupy the row, but one needs an extra click/menu/focus handoff for its only command.

Recommendation: either a direct named location IconButton beside delete, or one coherent More menu with both secondary commands if that reduces clutter on phones. Reuse IconButton/current Radix menu and retain confirmation before deletion; preserve changing-location focus handoff. Do not hide frequent actions solely to minimize button count.

Verification: keyboard and touch actions reachable; changing location moves focus to picker and closing returns correctly; deletion confirmation and bulk selection stay intact.

Relevant current tests: `src/features/finishedGoods/jobScan/JobScanRecords.test.tsx`, `src/features/finishedGoods/jobScan/LocationPicker.test.tsx`.

### F12 — Low: internal navigation and scene display icons communicate inconsistent meanings

Evidence: location “Open” links navigate inside the same app but show ExternalLink (`StorageLocationCatalogue.tsx:395`, `:401`); read-only finished-good internal opening shows ArrowUpRight (`FinishedGoodsTable.tsx:174`) while mobile opening shows ChevronRight (`FinishedGoodsMobileList.tsx:75`). FloorMapCameraControls uses QrCode for “Show pallet footprints” (`FloorMapCameraControls.tsx:115`, `messages/en.json:298`), although QrCode elsewhere actually reveals QR labels and ScanIcon is already centralized. Finished goods table layout uses List (`FinishedGoodsCatalogue.tsx:299`) while storage table layout uses Table2 (`StorageLocationCatalogue.tsx:205`).

Recommendation: define a short semantic icon map using current Lucide assets: internal navigation, external/new-tab, edit, scan/decode, photo capture, AI, QR label, table/list/map, footprints. Change only ambiguous placements; no new icon library. Keep all accessible names and physical-move actions distinct from camera pan/rotation.

Verification: icon changes match actual effect in both locales; none remove visible text required to explain scope; screen-reader names remain complete; dark/light shapes remain readable.

Relevant current tests: `src/components/ui/sharedControls.test.tsx`, `src/features/finishedGoods/FinishedGoodsMobileList.test.tsx`, `src/features/storageLayouts/StorageLocationCatalogue.test.tsx`, `src/components/storageLayouts/FloorMap.workspace.test.tsx`.

### F13 — Low: displayed quantities use raw values beside locale-formatted totals/dimensions

Evidence: warehouse counts use `measure.count` (`FinishedGoodsCatalogue.tsx:166`), dimensions use shared formatter (`FinishedGoodsTable.tsx:221`), but product/pallet quantities interpolate raw values (`FinishedGoodsTable.tsx:151`, `:217`, `FinishedGoodsMobileList.tsx:82`, `:127`); packing summary interpolates allocated arithmetic/raw text (`PackingScreen.tsx:1407`–`:1410`). Shared `useMeasureFormat` provides `decimal` with explicit precision at `hooks/useMeasureFormat.ts:25`.

Impact: large quantities have no grouping and equivalent totals/rows use visibly different number treatment. Fractional quantities require care; count() defaults to zero decimals and must not be applied blindly.

Recommendation: use route-locale decimal display with the existing business quantity precision. Keep editable strings and stored numeric values unchanged. User-entered product names, SKU, codes and SI units must not be translated.

Verification: integer and fractional counting units, values 1,234/1,234.125, allocation arithmetic, Thai/English; no display rounding that hides meaningful precision or changes validation.

Relevant current tests: `src/features/finishedGoods/FinishedGoodsMobileList.test.tsx`, `src/features/finishedGoods/PackingScreen.test.tsx`, `src/features/finishedGoods/ProductScreens.test.tsx`, `src/lib/storageLayouts/storageKit.test.ts`.

## Additional review candidates (do not promote without visual/product validation)

- History currently shows both month and date-range selectors for the same range (`HistoryScreen.tsx:126`, `:141`), plus four large clickable metric cards (`:187`) using 48px decorative icon blocks (`HrActionCard.tsx:57`). Could become a compact month preset + secondary custom range and smaller actionable strip, but those cards intentionally filter the list; replacing them with passive DescriptionList metrics would lose behavior. Current HrStatStrip exists for passive metrics (`HrUi.tsx:55`). Preserve inspectability and selected-state semantics. Verify with `HrSimplification.test.tsx`, `SelfService.test.tsx`, `HrScreens.test.tsx` before pursuing.
- Shared tables retain 48px header and 56px row minimum heights (`ui/table.tsx:80`, `:93`), while bounded planner table CSS uses 48/36 density (`FloorWorkspaceLocationList.module.css:95`). This may be intentional for multi-line/badged rows. A dense data-table variant may help high-volume lists; do not shrink all rows because buttons are 36px.
- Two date inputs remain side-by-side on small phones (`HistoryScreen.tsx:73`); native date controls should be visually checked at 320px/200% zoom in Thai and English before changing to stacking. Source alone does not prove clipping.
- QrDialog defaults to 672px-wide `md` dialog around a centered QR (`storageKit/QrDialog.tsx:33`), while scan-field dialog uses `sm` (`TicketFieldScanner.tsx:70`). `size="sm"` is likely sufficient for QR-only content, but long code/description and camera/scanner needs differ. Do not impose one width on editor, photo, QR and confirmation dialogs.
- New building pre-fills persisted English “Main storage” (`StorageLayoutScreens.tsx:410`) on the Thai route. Prefer an explicit example placeholder or localized suggested name if product wants it. Do not translate existing records.

## Positive patterns and rejected false positives

1. The global dense condition deliberately keeps 48px controls on touch tablets/laptops. Do not replace it with simple `md:h-9` or shrink mobile controls to solve clutter. Much earlier density inconsistency has already been fixed in this dirty tree.
2. LocaleSwitcher intentionally composes shared Select directly for its flag current value (`LocaleSwitcher.tsx:6`), has full locale menu names and accessible compact name, preserves query/hash and draft guards (`:43`). It should not be rewritten merely because it bypasses SelectControl.
3. The floor workspace uses container width for split and inspector behavior (`useFloorWorkspaceView.ts:54`), while shell mobile drawer uses 1024px and simple floor list adaptation uses 580px. These answer different layout questions. One universal mobile hook would be a regression; density is the common rule already.
4. Map plan colors, white QR backing, black camera/image stage, strong focus markers and small SVG labels have functional purposes. FloorMap defines a matching dark palette (`FloorMap.module.css:54`); selected map labels intentionally use dark text on light selection (`FloorMapDrawing.tsx:718`). Hardcoded-looking map colors alone do not prove theme inconsistency.
5. `F1F2ReferencePreview`/`Fg1ReferencePreview` currently have no production imports found; their custom dark art should not drive a high-priority production theme change. `_prototype` trees are design references, not live implementation. FloorMapDemo is routed but is a demo, not evidence of everyday workflow inconsistency.
6. Photo AI multi-image explicit Read action and location AI automatic one-image read are different legitimate workflows. `messages/en.json:1519` explicitly discloses automatic extraction. Preserve disclosure, operator review, cancel/late-result invalidation and local-barcode/no-upload copy; do not force identical business steps.
7. Confirm stored, return physically to source, reservation release, stack support verification and dimension-check acknowledgements carry distinct physical-state meaning. Remove duplicate presentation, not these safety/state distinctions. Read-only users must not gain commands through simplified layouts.
8. OutcomeGate/QueryGate represent denied/not-ready differently from empty. Finished-goods warehouse summary explicitly distinguishes missing totals from zero and page counts (`FinishedGoodsCatalogue.tsx:155`). HR incomplete bounded reads include warning, not invented totals (`EmployeesScreen.tsx:175`, `PeriodsScreen.tsx:84`). Keep that honesty.
9. Current HR uses shared PageHeader, Panel, FormField/FormSelect/SelectControl, DescriptionList/StatusBadge, guarded writes and URL-backed employee/period/review state. This audit does not support wholesale HR redesign or a replacement component library.
10. Public pages intentionally force `lang="en"` in their layout, and global fatal error is bilingual/self-contained to work without normal providers. Those are not accidental locale leakage claims. Sign-in already imports shared field/button styles (`SignInScreen.tsx:53`–`:60`). Organization-required duplicates its title in header/notice (`OrganizationRequired.tsx:13`, `:16`), a low-priority copy simplification, not a critical auth design failure.
11. SceneToolbar already collapses secondary tools by container width, and Bottom Sheet inspector maintains focus return (`FloorMap.tsx:964`). Do not replace functioning geometry panels with generic card grids.

## Effort and confidence summary

Effort is relative implementation scope, not a promised schedule: S = one small presentation change with focused verification; M = several composed surfaces/state edges; L = cross-flow work and connected-camera/browser validation.

| Finding                            | Severity   | Effort | Confidence                                                       |
| ---------------------------------- | ---------- | ------ | ---------------------------------------------------------------- |
| F1 preview versus captured frame   | High       | M      | High source evidence; camera/browser visual check needed         |
| F2 building toggle in location row | High       | S–M    | High                                                             |
| F3 zone pending dismissal/edit     | High       | M      | High                                                             |
| F4 create-form navigation/pending  | Medium     | M      | High for pending controls; discard-policy choice needed          |
| F5 duplicate acquisition controls  | Medium     | L      | High duplication evidence; target hierarchy needs browser review |
| F6 ticket camera error/retry       | Medium     | M      | High                                                             |
| F7 request detail parent           | Medium     | S      | High                                                             |
| F8 geometry icon/error reason      | Medium     | M      | High                                                             |
| F9 HR request pager                | Low/medium | S      | High                                                             |
| F10 page/form/action anatomy       | Low/medium | M–L    | Source-backed candidate; screenshots needed                      |
| F11 one-item row menu              | Low        | S      | High duplication evidence; frequency/product judgment needed     |
| F12 semantic icon map              | Low        | S–M    | High current semantics; mapping is a design decision             |
| F13 numeric display                | Low        | M      | High raw-value evidence; business precision verification needed  |

Source drift: parent observed `JobScanScreen.test.tsx` modified externally during this audit. Final recheck also found concurrent changes to `PageBackButton.tsx`, `JobScanScreen.tsx`, `lib/navigationGuard.ts`, and a new `hooks/useWorkflowStep.ts`; header Back now first calls backWithinPage and job-scan location selection has a guarded local step. Production anchors were refreshed for these files. Parent should review those external changes separately; they do not repair the request-detail breadcrumb fallback or ticket camera frame/recovery findings. This researcher made no repository edits and did not run tests; references concern current production source. Before implementation, revalidate file/line anchors and read current tests instead of assuming a frozen tree.

## Suggested implementation sequence for a later authorized pass

1. Correct scope/command reliability first: F2 building-status scope, F3 pending zone dialog, F4 pending creation behavior. Verify delayed commands, permissions, navigation/draft guard and request identity before cosmetic changes.
2. Align acquisition presentation around current camera/scan primitives: F1 true preview frame, F6 state/retry, then F5 remove duplicate controls. Validate all photo/barcode/AI outcomes and stream cleanup.
3. Apply existing anatomy to narrowly equivalent UI: F7 parent crumbs, F8 geometry reason/icon, F9 shared pagination presentation, F11 row actions and F12 semantic icon map.
4. Connected browser review then decide F10 form alignment, F13 formatted quantities and additional density/range/QR candidates. Keep colors/branding and documented feature-specific differences.

Required visual matrix for the parent plan: 390px phone (include one 320px check), 768px touch tablet, 1024px fine-pointer desktop with rail expanded/collapsed, 1440px desktop; both Thai and English; light/dark; normal and reduced motion; 200% zoom; camera permission denied/available/no-device; loading/empty/filter-empty/denied/network error/pending/uncertain/retry/stale version/read-only states. Current offline backend prevents meaningful workflow screenshots; do not label source review or mocked tests as end-to-end verification.
