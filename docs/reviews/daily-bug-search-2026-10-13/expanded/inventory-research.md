# Expanded inventory bug research — 13 October 2026

Research of the current working tree, limited to finished goods, physical storage, packing and job-ticket scanning. Production source, existing tests, git state, credentials and business data were not changed. All writes in the diagnostics use an isolated `convex-test` fixture with the real tenant authorization wrappers and registered production handlers.

Ten findings below were reproduced. Eight use the actual authorized backend handlers; INV-09 also renders the real Job Scan UI and bridges its Save mutation to the actual backend. INV-10 renders the real PhotoCapture component and traces preview URL allocation/release. This is component/integration evidence, not a browser or camera-hardware walkthrough. INV-06 is an authenticated API defect: the current floor editor normally supplies explicit offsets, so its UI exposure is narrower. INV-07 reproduces backend cursor instability; it does not claim that every live subscription timing produces the same visible sequence.

| Rank within this audit | ID     | Priority | Category                                | Symptom                                                                                                                                        | Confidence                                                                                         |
| ---------------------- | ------ | -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1                      | INV-02 | P1       | Storage integrity / replay side effects | Replaying an older zone save rewrites its child position to older geometry while the zone retains newer geometry                               | Runtime reproduced                                                                                 |
| 2                      | INV-04 | P1       | Concurrency / physical measurements     | A stale measurement editor silently restores older dimensions over another operator's measurements                                             | Runtime reproduced                                                                                 |
| 3                      | INV-03 | P2       | Concurrency / product master data       | Saving notes from a stale product editor silently restores an older product name                                                               | Runtime reproduced                                                                                 |
| 4                      | INV-01 | P2       | Idempotency / lost-response recovery    | An exact retry of a successful layout write is refused as `VERSION_CONFLICT`                                                                   | Runtime reproduced for building update; same ordering source-demonstrated for other listed callers |
| 5                      | INV-05 | P2       | Quantity integrity                      | Legacy measurement stores `1.5 PCS`, although the packing contract requires integer discrete quantities                                        | Runtime reproduced                                                                                 |
| 6                      | INV-09 | P2       | Job Scan / acquisition and save limits  | UI collects 51 valid tickets and offers Save; the server refuses the entire group and stores zero records                                      | UI + backend reproduced                                                                            |
| 7                      | INV-06 | P2       | Floor geometry / optional overrides     | Omitting old offsets restores inherited dimensions but retains offsets that were absent from validation, creating out-of-bounds saved geometry | API runtime reproduced                                                                             |
| 8                      | INV-07 | P2       | Job-record search / pagination          | Search offset cursors duplicate already-seen records after a concurrent insertion                                                              | Backend runtime reproduced                                                                         |
| 9                      | INV-08 | P3       | Job-record search / discoverability     | Searching the displayed location name returns no matching mapped record                                                                        | Runtime reproduced                                                                                 |
| 10                     | INV-10 | P3       | Browser resources / photo previews      | Closing the photo panel leaves each unsubmitted image Blob URL allocated across remounts                                                       | Real component resource lifetime reproduced                                                        |

Priorities are provisional: P1 means stored physical data can be silently corrupted; P2 means material integrity or workflow failure; P3 means a narrower search/resource failure without a measured severe outcome. INV-03 and INV-04 share a lost-update concurrency cluster, but involve different mutations and edit workflows. Version/status-before-replay failures are grouped under INV-01 rather than counted separately.

## INV-02 — replay rewinds the child position but leaves the newer zone unchanged

- **Evidence:** `convex/storageLayouts/zones.ts:740` calls `updateMasterDataRow`; `:774` patches the default `storagePositions` row regardless of `updated.value.replayed`; `:788` then returns the replay status. `updateMasterDataRow` in `convex/lib/masterDataStore.ts:276` returns an old success without reapplying the parent patch.
- **Trigger:** Save zone A at X=1000 / label A; save a newer zone B at X=2000 / label B; retry the identical successful A request, such as recovery after a lost reply while another operator updated the zone.
- **Actual:** Retry says `written=true, replayed=true`. Database zone is `["Zone B",2000]`; its default child position is `["Zone A",1000]`.
- **Expected:** A replay returns its original receipt without changing parent or child state. The child remains consistent with the newer zone.
- **Affected callers:** `StorageZonesPanel.saveStorageZone` (`src/features/storageLayouts/StorageZonesPanel.tsx:391`), consumers of storage positions / QR address resolution, and authorized `updateStorageZone` callers. In SIMPLE mode placement planning uses the zone envelope, so the probe proves child metadata/geometry corruption; it does not claim an unsafe SIMPLE placement was performed.
- **Confidence:** Runtime reproduced by `INV-02` in `inventory-backend.probe.ts`; no imported malformed data was necessary.
- **Minimal verification:** The three valid mutations above, then compare the zone and default position in an isolated fixture. Assert a replay creates no child-row changes.
- **Fix direction:** Perform replay handling before stateful validation and guard all child synchronization with `!updated.value.replayed`. Derive synchronization from the committed current zone, retaining transaction boundaries and audit/idempotency semantics.

## INV-04 — stale measurement editors silently lose physical dimension changes

- **Evidence:** `convex/finishedGoods/workflow.ts:463` accepts no expected revision / measurement version; `:520` replaces quantity, lot and all measurement fields. `src/features/finishedGoods/PalletScreens.tsx:286` initializes the local form once and `:373` sends the full form snapshot, without its baseline version.
- **Trigger:** Two editors load the same unreserved legacy pallet at width 1000. A saves width 2000. B changes only the lot and submits the full older form.
- **Actual:** B receives `written=true`; the database width becomes 1000 while B's lot is saved. A's physical measurement disappears without a conflict notice.
- **Expected:** Refuse a stale baseline with a recoverable conflict, or merge only explicitly changed nonconflicting fields. The earlier physical width must not silently revert.
- **Affected callers:** Legacy pallet Measurement screen (`/finished-goods/pallets/[id]/measure` through `PalletScreen`), including pending legacy packing pallets. Preparation-batch pallets already have separate measurement locking and are outside this repro.
- **Confidence:** Runtime reproduced via the authorized actual `saveMeasurement` handler. Two-tab UI behavior is supported by the fixed local state/full payload code; no browser was run for this scenario.
- **Minimal verification:** Load a shared baseline, submit A's width change and B's lot change with separate request IDs, and verify that either B is refused or width 2000 survives. Cover refreshed queries with an already-open dirty editor too.
- **Fix direction:** Add a stable expected measurement revision to the mutation and the editor baseline. Compare within the transaction; retain dirty drafts on conflicts and require an explicit reload/merge. Do not rely solely on millisecond `updatedAt` as a collision-proof version.

## INV-03 — stale product edits overwrite unrelated product details

- **Evidence:** `convex/finishedGoods/workflow.ts:201` has no expected product revision; `:336` patches the full supplied product fields. `src/features/finishedGoods/ProductScreen.tsx:211` initializes form state once; `:278` always sends name, unit, storage condition, notes and references from that snapshot.
- **Trigger:** Two operators load Original product / Original notes. A renames the product. B edits only its notes from the stale form and saves.
- **Actual:** B's request succeeds and the stored result is `Original product / Notes edited by B`; A's rename disappears.
- **Expected:** Detect the stale edit baseline or merge changed fields safely. A successful notes-only edit must not silently revert an unrelated rename.
- **Affected callers:** Existing product edit / Prepare more goods / resume pallet measurement flows within `ProductForm`.
- **Confidence:** Runtime reproduced by actual authorized product mutations; caller stale-state behavior source-demonstrated.
- **Minimal verification:** Two independent payloads from the same read version, A changes name, B changes notes. Verify stale conflict or preserved rename; also verify persistent local drafts reopened after another user's update.
- **Fix direction:** Add and enforce product revision ownership, propagate the loaded baseline into Save, and give the editor a conflict recovery path that preserves its draft.

## INV-01 — completed layout writes cannot be retried with their original expected version

- **Evidence:** `convex/storageLayouts/writes.ts:295` checks `expectedVersion` before calling `updateMasterDataRow` (`:341`). The same ordering occurs for floor save (`:596`, `:603` before `:653`), floor-count increase (`:494` before its update), schematic approval (`:406` before `:443`), and status writes (`:746` before `:793`). The successful original mutation advances those versions.
- **Trigger:** `updateStorageBuilding` commits with request R / expectedVersion 1, but its reply is lost. Retry exactly the same args and request R.
- **Actual:** `{written:false,error:{code:"VERSION_CONFLICT"}}`; the idempotency record is never consulted. The successful update remains in the database but the retry does not recover its success.
- **Expected:** Return the recorded success with `replayed=true` after authorization, request identity and fingerprint validation. The old precondition is required for a fresh write, not a replay.
- **Affected callers:** Building dimension settings, Floor editor, add-floor settings, schematic approval, BuildingStatusToggle and API clients that retry ambiguous responses. Some UI retries rebuild payloads from updated reactive versions; the exact original-request recovery failure is proved at the public mutation boundary.
- **Confidence:** Runtime reproduced for `updateStorageBuilding`. Related mutation ordering is source-demonstrated, not separately counted as independently runtime-reproduced cases.
- **Minimal verification:** For each mutation, execute once, discard its response, retry identical args/request ID and require a replay receipt without a second write. Then change one argument with the same request ID and require an argument-conflict refusal.
- **Fix direction:** Use `replayTenantWriteIfPresent` before mutable-version/lifecycle checks, within the authorized wrapper and with the original fingerprint. Keep ordinary optimistic concurrency checks for new commands.

## INV-05 — legacy measurement bypasses the discrete quantity precision contract

- **Evidence:** `convex/model/finishedGoods/packing.ts:16` assigns zero decimal precision to PCS / pieces / ชิ้น; `:30` rejects fractional minor quantities. `convex/finishedGoods/workflow.ts:496` checks only finite positive range in `saveMeasurement`. The UI actual quantity field permits `step="any"` (`src/features/finishedGoods/PalletScreens.tsx:465`). The product default-quantity validation (`workflow.ts:254`) also checks only numeric range, and `createPallet` copies that default (`:375`).
- **Trigger:** Create a legacy pallet for an ACTIVE product whose unit is PCS, edit its actual quantity to 1.5 and confirm its dimensions.
- **Actual:** `quantityToMinor(1.5,"PCS")` is null, but the real measurement mutation returns `written=true` and saves quantity 1.5.
- **Expected:** All persisted quantities follow the product unit precision; the mutation refuses a fractional discrete count with a field error.
- **Affected callers:** Legacy Measurement; legacy createPallet through a fractional product default is an additional source-demonstrated path. Modern batch packing already uses `validatePacking`.
- **Confidence:** Measurement path runtime reproduced. Default-quantity path source-demonstrated.
- **Minimal verification:** Test both PCS/ชิ้น fraction rejection and valid three-decimal non-discrete quantities using the real mutation; test product defaults as well.
- **Fix direction:** Use the common `quantityToMinor` contract after loading the product. Match input step and validation hints to unit precision without converting or truncating the user's quantity silently.

## INV-09 — Job Scan can collect a group the server will never save

- **Evidence:** `src/features/finishedGoods/jobScan/JobScanScreen.tsx:279` appends barcode pairs without a group cap; `:491` appends manual tickets without a cap; `:216` appends photos. Submit validation (`:283`) and the Save disabled rule (`:612`) omit the count maximum. `convex/finishedGoods/jobScans.ts:272` refuses every group above `MAX_ITEMS=50`.
- **Trigger:** Scan 51 distinct complete ticket pairs in the same selected location, or repeatedly add photo/manual groups until the accumulated count exceeds 50.
- **Actual:** Real UI contains 51 complete tickets and an enabled `Save 51 tickets` button. Clicking it invokes the actual backend, receives `SCAN_GROUP_SIZE_INVALID`, and writes zero job records. The UI remains in the oversized group; the operator must remove entered work manually to make any save succeed.
- **Expected:** Enforce the shared count limit at acquisition with useful feedback, or split/persist the group safely with clear partial progress. Do not offer a whole-group Save that deterministically refuses.
- **Affected callers:** JobScanWorkflow barcode, photo and manual acquisition plus submit. The 20-photo cap in a single PhotoCapture panel does not cap the accumulated workflow.
- **Confidence:** Real UI + authorized actual backend reproduced in `inventory-jobscan.probe.tsx`. The camera/file source is a controlled input callback; camera hardware is not claimed.
- **Minimal verification:** Deliver 50 valid pairs, then a 51st, and verify meaningful rejection/next-batch behavior before Save. Cover repeated 20-photo submissions and manual additions too; ensure no ticket is silently discarded.
- **Fix direction:** Export a shared job-group maximum and apply it to every acquisition path and the submit blocker, with user-visible count feedback. Chunked saving needs explicit stable per-chunk request identities and recovery, so merely splitting the array in submit is insufficient.

## INV-06 — optional offsets are validated as absent but retain older values when saved

- **Evidence:** Floor input declares optional offsets (`convex/storageLayouts/writes.ts:49`). Save substitutes the new input into the layout (`:605`), so the model computes inherited centered offsets. Patch clears missing dimension overrides (`:667`) but excludes missing offset overrides from the patch (`:670`), retaining them in the stored row. `convex/model/storageLayout/storageLayout.ts:190` computes default centering and `:206` checks floor bounds.
- **Trigger:** In a 10000-wide building, save a 6000-wide floor at X=2000. Next save the floor using supported optional inheritance input `{floorNumber:1,reservedBlocks:[]}`, omitting width and offsets.
- **Actual:** Save succeeds after validating inherited width 10000 at computed X=0. Stored width override is removed but stored X remains 2000, so the persisted floor extends to X=12000 and no longer matches the validated geometry.
- **Expected:** Stored optional overrides exactly match the data validated, or the validation must explicitly merge retained offsets. A successful Save must not create an out-of-bounds floor.
- **Affected callers:** Authorized `saveStorageFloor` clients omitting offset overrides. Current Floor editor normally sends explicit offsets, so this is narrower than a routinely reproduced UI failure.
- **Confidence:** API runtime reproduced; this is not a malformed data fixture, because both saves use valid accepted API arguments.
- **Minimal verification:** Execute the two saves, read the persisted optional fields, and run the layout model on that saved state. Verify reset/inheritance matches validation and remains valid when building defaults later change.
- **Fix direction:** Patch `offsetXMm: args.floor.offsetXMm` and Y consistently with the other optional overrides when omission means inheritance. If omission is meant to retain offsets, construct validation input with the same retained values and reject invalid geometry instead.

## INV-07 — searched job-record cursors shift with concurrent inserts

- **Evidence:** `convex/finishedGoods/jobScans.ts:406` recomputes all search matches on every query; `:417` treats the cursor as a numeric offset and `:420` returns offset + pageSize, without an anchor or snapshot identity. `src/features/finishedGoods/jobScan/JobScanRecords.tsx:78` forwards this cursor unchanged.
- **Trigger:** Four matching records ordered newest to oldest. Read search page 1 (size 2): FO0004 / FO0003. Another user inserts a newer matching FO0005. Request the next page using the original returned cursor.
- **Actual:** Page 2 contains FO0003 / FO0002. FO0003 appears again across the previously read page boundary.
- **Expected:** A continuation is tied to a stable ordering boundary or explicitly resets after a result-set change. Users should not unknowingly reread or miss shifted rows while navigating an active warehouse history.
- **Affected callers:** Searched Job Scan Records with concurrent saves/deletes/remapping. Unsearched queries use the database page cursor and do not use this offset path. A live first-page subscription may rerender before navigation, so not every timing looks identical; the returned API continuation instability is what the probe establishes.
- **Confidence:** Actual backend query/mutation sequence runtime reproduced.
- **Minimal verification:** Insert and delete rows before a current page boundary between page requests; require anchored continuation or an explicit stale-cursor/reset result.
- **Fix direction:** Use a stable compound ordering cursor, e.g. createdAt + ID, with bounded search continuation. Alternatively bind the offset to a result generation and force a visible reset when that generation changes.

## INV-08 — location-name search cannot find names shown on mapped job records

- **Evidence:** `convex/finishedGoods/jobScans.ts:409` searches factoryOrder, productBarcodeText, partName, locationText and locationCode but omits locationName. Its returned row includes locationName (`:473`); `src/features/finishedGoods/jobScan/JobScanRecordRow.tsx:104` displays it. The search label promises part or location (`messages/en.json:1443`, `messages/th.json:1443`).
- **Trigger:** Save a mapped record at code `INV-BUILDING-F01-Z01`, displayed location name `Original zone`. Search `Original zone` in records.
- **Actual:** The unfiltered record contains `locationName:"Original zone"`; searched result contains zero rows.
- **Expected:** The displayed location name matches the location search, just as its code/text already do.
- **Affected callers:** JobScanRecords text search for mapped zones, subpositions and named registrations where name differs from code/text.
- **Confidence:** Actual save + list query runtime reproduced.
- **Minimal verification:** Search a unique displayed location label differing from code/text, plus case-insensitive and unmapped-text control cases.
- **Fix direction:** Include the persisted locationName in the search predicate and in any replacement search index/continuation implementation.

## INV-10 — closing the photo panel leaks its unsubmitted preview URL allocations

- **Evidence:** `src/hooks/use-file-upload.ts:129` allocates a Blob URL for each preview. Cleanup exists only in `clearFiles` (`:143`) and `removeFile` (`:281`); there is no unmount cleanup. Real consumer `src/features/finishedGoods/jobScan/PhotoCapture.tsx:45` owns this hook, permits 20 photos up to 25 MiB each (`:48`), and its Cancel button (`:163`) calls `onClose` without clearing the files. `src/features/finishedGoods/jobScan/JobScanScreen.tsx:498` conditionally mounts the panel and `:500` closes/unmounts it.
- **Trigger:** Open the photo panel, choose an image, then Cancel without sending it to AI. Reopen and repeat, or leave the page while these panel previews remain selected.
- **Actual:** The real component probe, with allocation/revocation resource spies, repeats three selection→Cancel→unmount cycles: `{allocated:3,revoked:0,liveAfterThreeUnmounts:3,submittedToParent:0}`. Explicit Remove of an identical preview performs the revoke and passes the control case.
- **Expected:** Unmount releases every preview URL owned by this panel/hook, including Cancel and navigation dismissal. Reopening starts without outstanding allocations from discarded panels.
- **Affected callers:** PhotoCapture inside JobScanWorkflow, including switching its acquisition panel or leaving before submission. The parent workflow's separate `previewUrls` ownership (`JobScanScreen.tsx:111`, `:210`) begins only when `onPhoto` receives submitted files. In this repro submit is never called, so the parent's cleanup cannot revoke these hook-owned URLs.
- **Confidence:** Real PhotoCapture lifecycle reproduced; no camera stream, backend mutation or parent-owned preview is involved. Browser heap usage and a crash were not measured, so severity remains P3 despite repeated large-photo exposure being plausible.
- **Minimal verification:** Allocation/revocation ledger around real panel close/remount and page unmount; require zero outstanding owned URLs. Keep an explicit Remove control and a submit transfer case to distinguish ownership.
- **Fix direction:** Give the hook an owned-URL registry/ref and idempotent unmount cleanup. Revoke only URLs it created, independently of externally supplied FileMetadata URLs; integrate clear/remove into that same ownership registry.

## Reproduction and existing checks

```sh
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/probes/inventory.config.mts --reporter=verbose
```

**Observed:** 3 files / **10 failed expected-correct assertions and 1 passed resource control**, exit 1. The backend cases and photo-resource case were rerun with identical wrong outcomes. This is deliberate diagnostic failure on unchanged source, not a failure claimed for the normal test suite. Raw output: [inventory-evidence.log](./probes/inventory-evidence.log). The narrow photo run is separately captured in [inventory-photo-evidence.log](./probes/inventory-photo-evidence.log).

```sh
pnpm exec vitest run tests/integration/finished-goods.integration.test.ts tests/integration/finished-goods-job-scans.integration.test.ts tests/integration/storage-layouts.integration.test.ts --reporter=dot
```

**Observed:** 3 files / **45 existing tests passed**, exit 0. Output: [inventory-existing-checks.log](./probes/inventory-existing-checks.log). No full-suite run, build, server launch, browser automation, deployment, push or production write was performed by this audit.

Diagnostics are confined to `expanded/probes/inventory-*` and use `.probe.*` names outside main Vitest discovery. ESLint passed for all four new diagnostic/config files. No application fixes have been made.

## Rejected or deferred hypotheses

- Cross-tenant/warehouse unit and mapped-location access is explicitly checked by `tenantDb`, `palletOf`, `productOf`, `targetContext` and job-scan selection validation. No isolation bypass was found in the inspected paths.
- Repacking physically held units is protected independently of convenience unit status; reservations, stack children and active moves are inspected. This was not reported as a bug.
- Stack ancestry, occupancy, pallet-only supports and active move ownership have explicit guards. No confirmed stack cycle or moving-support bypass emerged.
- Large-history `.all(10000)` limits were not counted as bugs merely because they are bounded. This report does not turn stated pilot limits into findings.
- Late camera permission grants and decoder callbacks are guarded/stopped in the barcode and location-camera implementations. No hardware leak was asserted without an actual reproduction.
- Location ledger label drift after a zone/position rename was not counted: active scanner/location readers derive labels from the live zone/position rows.
- Image barcode pairs of the wrong two-field shape were not counted because BarcodeImagePicker does not offer pair acceptance for that shape.
