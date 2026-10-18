# Finished goods and scanning — UX flow review (Kiro, 15 Oct 2026)

Reviewer: Kiro CLI, `claude-opus-5.5`, high effort. Discovery only: no application source, tests, translations or configuration were changed. Everything written is in this directory. I ran no browser, app server or production command, and no physical camera was used.

Scope: catalogue, products, batches, packing, pallet measurement, storage, moving and stacking, barcode and photo acquisition, location selection, and job-ticket scan records. I reviewed the current working tree, including uncommitted changes.

Evidence levels used below:

- **source-traced:** I read the code path end to end.
- **real-handler:** registered Convex handlers run in `convex-test`.
- **rendered-component:** a jsdom render of the production component. Only the hardware and transport pieces named in each probe are substituted.
- **browser-verified:** none in this review. The parent owns browser verification.

## Findings

| ID       | P   | Finding                                                                                                                                                                                    | Evidence                                                                                     | Novelty                                             |
| -------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| FG-UX-01 | P1  | Units from the default **Simple packing** mode can't reach storage. Every guided "Scan Packages" step opens the Job tickets page, which rejects package labels and never changes the unit. | real-handler + pure helper + source-traced; existing rendered tests assert the dead-end link | New                                                 |
| FG-UX-02 | P2  | Job-ticket photos that were collected but not yet sent to AI are discarded without a prompt: on navigation, on Back, or when switching to barcode or toggling the photo panel.             | rendered-component                                                                           | New                                                 |
| FG-UX-03 | P3  | Barcode-from-image intake on Job tickets hides its own outcome. A refused 51st ticket shows nothing.                                                                                       | rendered-component (real `BarcodeCameraBox`)                                                 | New                                                 |
| FG-UX-04 | P3  | During "Start move", manual pallet identification is case-sensitive on the client, but the server accepts the code case-insensitively.                                                     | rendered-component + source-traced backend                                                   | New                                                 |
| FG-UX-05 | P1  | Switching warehouse, in this tab or in another tab, remounts Job tickets and silently drops unsent tickets.                                                                                | rendered-component (real warehouse store + real `QueryGate`)                                 | Known (storage-actions F05); now runtime-reproduced |

### FG-UX-01 (P1): Simple-packed units have no reachable storage path

- **User/role:** a warehouse manager preparing goods. Simple packing is the default for every new batch (`PackingScreen.tsx:136`).
- **Trigger:**
  1. Create a product, then go to Next: packing.
  2. Leave the default **Simple packing**, then Review and create.
  3. The completion panel says "Scan the package labels in order, then scan their location", and its primary link is **Scan Packages** → `/finished-goods/scan`.
- **Expected:** the units can be stored. Either a flow scans their package labels and location, or the user is guided to record dimensions and choose storage.
- **Actual:**
  - `/finished-goods/scan` now renders `JobScanScreen` (the scan `page.tsx`, changed in commit `e43f00c6`, "replace package scan with AI job-ticket scanning").
  - That screen rejects every `ISAS:` package QR (`jobScan/ticketDraft.ts:16`, "Scan a job ticket barcode. This label cannot be used here.").
  - It states that "Saving a ticket… does not confirm pallet storage."
  - The other routes all fail as well:
    - The catalogue next action (`unitNextAction.ts:19-33`), the batch unit action (`BatchManager.tsx:310-315`, `:492`) and the pallet header (`PalletScreens.tsx:1036-1048`) all send the unit to the same page.
    - The storage route shows "Measure before choosing storage" (`PalletScreens.tsx:654-661`). Its link goes to `correctionPath`, which for batch units is the batch editor. The Measure route redirects there too (`PalletScreens.tsx:121-127`).
    - For a simple batch, that editor renders only Quantity and Fullness, with no dimension fields (`BatchManager.tsx:746-776`).
    - The server refuses a direct measurement with `BATCH_MEASUREMENT_LOCKED` (`convex/finishedGoods/workflow.ts:504-505`). Recommendation returns `MEASUREMENTS_REQUIRED` (`workflow.ts:961`).
    - The backend for location-only assignment (`scanning.ts` `confirmScanAssignment`) has no client reference (`src/lib/convex/finishedGoodsApi.ts:7,25` only imports `resolveLocationCode` and `getScanAssignment`).
  - The only escape is to reopen the batch, switch it to exact measurements and commit again. That retires the units and issues new unit codes, so any labels already printed become invalid.
- **Cause:** the package-scanning UI was removed on 27 Sep. Simple packing, its completion copy and four "Scan Packages" calls to action kept pointing at the reused route. Existing tests lock in the stale link: `ProductScreens.test.tsx:1706` and `:1745-1767`, `PalletScreens.test.tsx:199-215`, `PackingScreen.test.tsx:883`.
- **Product decision needed:** whether dimensionless simple packing is still supported now that package scanning is gone. If it is, restore a UI for the existing `confirmScanAssignment` flow. If it isn't, retire the default and the copy.
- **Smallest fix:** stop routing unmeasured or simple units to `/finished-goods/scan`. Until a decision is made, let the simple-batch correction record outside dimensions and route to Find storage, and replace the completion copy and calls to action.
- **Test needed:**
  - An integration test: commit a simple batch, then a UI-reachable write stores the unit.
  - Component tests for the completion panel, catalogue, batch and pallet calls to action.
  - Update the four existing assertions listed above.
- **Confidence:** high.

### FG-UX-02 (P2): Collected job-ticket photos are lost without consent

- **User/role:** an operator photographing up to 20 job tickets before tapping "Read N photos with AI".
- **Trigger:** collect photos in **Photos (AI)**, then do any of the following:
  - navigate away (sidebar or any guarded navigation);
  - press Back or the header Back (the step's `onBack` calls `changePanel(null)`, `JobScanScreen.tsx:160-168`);
  - tap **Scan barcode**;
  - tap **Photos (AI)** again (`:508`, `:518`).
- **Expected:** a discard prompt, or the collection is kept. The Back contract requires consent before discarding a surface's own unfinished form.
- **Actual:**
  - Navigation proceeds immediately.
  - The panel unmounts and its `useFileUpload` state (`PhotoCapture.tsx:48`) is gone.
  - Reopening shows zero photos.
  - `useDraftGuard` counts only `tickets.length > 0` (`JobScanScreen.tsx:178-179`). Collected photos aren't tickets until they are sent.
- **Cause:** the photo collection is local to the `PhotoCapture` component and isn't reported to the workflow or the guard.
- **Smallest fix:** report the collected count to `JobScanWorkflow` and include it in `useDraftGuard`. Ask before Cancel, the panel toggles or Back close a non-empty collection, or keep the collection mounted while switching panels.
- **Test needed:** the probe cases below. Also Back, then Forward, with a non-empty collection.
- **Confidence:** high.
- **Note:** the existing INV-10 test (`PhotoCapture.test.tsx`) intentionally exercises Cancel releasing previews. An explicit Cancel discarding photos may be acceptable once it asks first. The silent loss through navigation and the panel toggles is the defect.

### FG-UX-03 (P3): Barcode-image intake hides its result

- **User/role:** an operator on Job tickets who uses **Scan barcode**, then Choose image. This is also the fallback after camera permission is denied.
- **Trigger:** the group already holds 50 tickets. Choose an image and press Use.
- **Expected:** "This group holds up to 50 tickets…", the same message the live camera shows.
- **Actual:**
  - Nothing is added, the picker clears itself, and no message appears.
  - Choosing an image turns the camera off (`BarcodeCameraBox.tsx:125-133`). The box renders `feedback` only while the camera is on (`:185-187`).
  - `JobScanScreen` suppresses its own feedback while the barcode panel is open (`:565`).
  - The "Barcode read" confirmation (`:303`) and `scanCodeTooLong` are invisible on the image path as well.
  - Existing tests mock `BarcodeCameraBox` so that it always prints `feedback` (`JobScanScreen.capacity.test.tsx:21-36`), which hides this.
- **Smallest fix:** render a supplied `feedback` whenever it is present, regardless of camera state.
- **Test needed:** the real `BarcodeCameraBox` with the image path, at the limit.
- **Confidence:** high. The reach is bounded: limit, too-long codes and success confirmation.

### FG-UX-04 (P3): Manual pallet identification is stricter than the server

- **User/role:** the move operator using **Scan QR (optional)**, then entering the pallet code (`MoveScreen.tsx:456-466`).
- **Trigger:** type `p-001` for pallet `P-001`.
- **Expected:** "Pallet identified". `startMove` accepts a manual code case-insensitively (`workflow.ts:1961-1971`).
- **Actual:** "This code does not identify this pallet", and Start stays disabled.
- **Related, source-traced only:** the client also accepts a _camera_ read of the plain code. The server requires the QR for the `SCAN` method, so that path would fail only after pickup is ticked.
- **Smallest fix:** mirror the server rule. Trim the code; compare a manual plain code case-insensitively; require the QR value for `SCAN`.
- **Test needed:** MoveScreen cases for lowercase manual entry and a plain-code camera read.
- **Confidence:** high for the UI. The server line is source-traced.

### FG-UX-05 (P1, already known): A warehouse switch drops unsent Job tickets

This is already known as storage-actions-2026-10-13 **F05**, which was a source-level P1 risk there. It is listed separately and isn't counted as new.

- **Trigger:**
  1. On Job tickets, choose a location and type a ticket.
  2. Change the warehouse in the header (`WorkspaceContextBar.tsx:41` → `WorkspaceProvider.tsx:99` → `writeStoredWarehouse`), or change it in another tab (the `storage` listener at `warehouseStore.ts:23`).
- **Actual:**
  - `JobScanWorkflow` is keyed by warehouse (`JobScanScreen.tsx:75`), so it remounts on the location question.
  - The ticket is gone, and no "Keep editing" prompt appears, although the ticket is registered with `useDraftGuard`.
- **Recommendation:** as F05 recommends, make the warehouse change a guarded context transition, including changes from other tabs.

## Probes and results

These are temporary probes outside the normal suite. `DESIRED` cases assert the expected outcome, so a failure is evidence of the defect, not a fix. `OBSERVED` and `CONTROL` cases assert current facts and pass.

```sh
pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/finished-goods/vitest.config.mts --reporter=verbose
```

Result: **12 tests in 5 files: 7 failed (all DESIRED), 5 passed (OBSERVED/CONTROL); exit 1; about 61 s.** The log is in `evidence/probes.log`.

| Probe file                         | Cases                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `simple-packing-dead-end.probe.ts` | FG-UX-01: OBSERVED real handlers (`MEASUREMENTS_REQUIRED`, `BATCH_MEASUREMENT_LOCKED`) ✓; OBSERVED route/label ✓; DESIRED next action ✗ |
| `job-ticket-photos.probe.tsx`      | FG-UX-02: DESIRED leave guard ✗; DESIRED keep on panel switch ✗; CONTROL typed ticket guarded ✓                                         |
| `barcode-image-feedback.probe.tsx` | FG-UX-03: DESIRED image limit message ✗; CONTROL camera limit message ✓                                                                 |
| `move-pallet-identify.probe.tsx`   | FG-UX-04: CONTROL exact code ✓; DESIRED lowercase manual ✗                                                                              |
| `warehouse-switch.probe.tsx`       | FG-UX-05: DESIRED same-tab ✗; DESIRED cross-tab ✗                                                                                       |

Other checks: `pnpm exec tsc -p docs/reviews/ux-flow-kiro-2026-10-15/finished-goods/tsconfig.probes.json` exited 0. `pnpm exec eslint docs/reviews/ux-flow-kiro-2026-10-15/finished-goods` exited 0. Before writing the probes I read the Next.js Vitest guide (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`).

## Rejected or not counted

- **Job records "Set location" leaves a dead Back entry:** disproved. `useWorkflowStep` consumes an owned step once it becomes unavailable (`src/hooks/useWorkflowStep.ts`, the effect after `registerHistoryBackHandler`).
- **A typed pallet or other non-location code in the location search shows only "No matching location":** accurate, though generic. The server's `lookupError` is unused. Not counted.
- **A clean product form gets a conflict on "Prepare more goods" after someone else edits the product:** recoverable through the reload button. This is the same clean-form freshness class as DAILY-03 and SOL-03, so it isn't presented as new.
- **The stacked-storage "Upper pallet code or QR" field has no camera action:** typing or a handheld scanner works. It's friction, not a broken task.
- **Records: assigning a location gives no success confirmation:** the records leave the Unmapped filter, and their status is visible under Mapped or All. A copy and feedback preference.
- **Known items rechecked in source, not re-reported:**
  - SOL-03 (stale stacking form) is still present: `StackScreen` sends no revision.
  - INV-09 (50-ticket cap) and INV-10 (photo blob release) appear fixed.
  - Measurement now carries `expectedRevision`, which addresses INV-04 on the client.

## Coverage

- **Context:** AGENTS.md, PRODUCT.md, the Back contract and the relevant `JobScanWorkflow`/`PhotoCapture` inventory entries, the system-audit-2026-10-14 and daily-bug-search-2026-10-13 reports (including the expanded ranking), and storage-actions F05.
- **UI source:**
  - `JobScanScreen`, `TicketCard`, `ticketDraft`, `PhotoCapture`, `TicketFieldScanner`, `LocationPicker`, `AddLocationForm`, `JobScanRecords`.
  - `BarcodeCameraBox`, `BarcodeImagePicker`, `barcodeImagePipeline` (target filtering), `DestinationScanner`.
  - `PalletScreens` (detail, measure, storage), `MoveScreen` (selection, active move), `ProductScreen`, `PackingScreen` (draft and completion), `PackingCompletion`, `BatchManager` (unit actions, available editor), `unitNextAction`, catalogue header.
- **Backend:** `jobScans`, `jobScanLocations`, `batches` (`commitBatch`), `batchManagement` (`repackAvailable`), `workflow` (`saveMeasurement`, `recommend`, `startMove`, code normalization), `scanning` exports, `warehouseStore` and `QueryGate`.

## Limitations

- No browser, device or physical camera testing; camera and decoder behavior was substituted in the probes. Mobile layout and touch ergonomics weren't measured.
- FG-UX-01: the completion and calls-to-action rendering relies on existing rendered tests and source tracing. A full end-to-end walkthrough with a seeded local backend wasn't run.
- FG-UX-04: the backend acceptance is source-traced. The probe doesn't execute `startMove`.
- FG-UX-05: the probe replaces only the server workspace snapshot with the real local warehouse store. Real multi-warehouse authorization wasn't exercised.
- Not covered in depth: PalletScene/3D accessibility, the PlacementEditor geometry, catalogue pagination performance, and Thai copy quality.
- Line numbers refer to the working tree on 15 Oct 2026.
