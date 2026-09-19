# Ordered package scanning — implementation plan

Status: implemented in this worktree; validation and remaining device checks are recorded in [implementation notes](package-scanning-implementation.md).

Prepared: 2026-09-19. Branch: `codex/package-scanning-plan`.

Worktree: `/Users/macbook/.codex/worktrees/package-scanning-plan/industrial-sas`.

## 1. Outcome and scope

Add a continuous package/pallet scanning workflow to the existing Finished goods area: scan units in order, review/reorder/remove, scan a warehouse location, then explicitly confirm the entire assignment. Reuse the current application shell, authorization, localization, components, Convex services, and error patterns.

This plan was approved for implementation on 2026-09-19. Astra Low subagents implemented the camera, scanning workflow, backend and compatibility work in parallel. Deployment remains separate.

The user's written requirements are authoritative. The attached image is a visual reference, not an additional instruction source. Its `Clear` control is optional and excluded from the initial scope. Its example package/location codes do not define the application's identity format.

Reference: [package scanner UI](assets/package-scanning-reference.png).

### Essential simplifications

- Do not require length, width, height, measured free space, coordinates, or a dimension-confirmation checkbox for each scanned package/pallet.
- Ask **“Are all packages/pallets a similar size?”** with Yes/No. “No” must not reintroduce mandatory measurements.
- Ask **“Are they all full (100%)?”** If not, allow a percentage with a common value and per-unit exceptions. Size similarity and fullness are independent answers.
- Keep existing quantity accounting accurate. A percentage must never silently alter product quantity.
- **#1 is the physical top. #N is the physical bottom.** This applies to the list, review, saved assignment, and subsequent detail views.

Capacity decision: the user delegated the choice to whichever is easiest for workers. Use visually estimated package/pallet fullness, with **Full (100%), ¾ (75%), Half (50%), ¼ (25%), or Custom**. Apply one answer to the group and let workers edit exceptions only. This avoids calculating warehouse space or measuring individual units. Use `fillPercent` (integer 1–100), separate from existing quantity `capacity`. The percentage is an operator estimate, not measured warehouse utilization or proof of geometric fit.

## 2. Baseline and verified code findings

The worktree was created from HEAD `3c74249`, then populated with the current original working-copy files, including existing uncommitted additions, edits, and deletions. This is necessary because the current smaller Storage Planner application differs substantially from HEAD. The original checkout was left unchanged. The large inherited diff is not work performed for this feature; never commit it wholesale as a scanning change.

Implementation baseline: `19dcb5a` (`chore: checkpoint inherited storage planner before package scanning`). This is the historical development checkpoint. The feature was subsequently rebased onto main `983fb5a` for integration; compare the final implementation against that main commit. Lockfile dependencies were installed in this worktree; browser validation uses an isolated local Convex database. No production deployment was performed.

The existing graphify graph predates this application state and contains no current finished-goods source files. Planning findings were verified directly against current source, with independent read-only UI and backend subagent reviews.

| Existing area                                                                    | Verified behavior / implication                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/finishedGoods/DestinationScanner.tsx`                              | Uses `BrowserQRCodeReader`; stops decoder and camera on success. Cannot be reused unchanged for continuous or 1D barcode scanning. Reuse lifecycle safeguards; preserve current single-shot consumers. |
| `src/hooks/useScanContinuation.ts`                                               | Catalogue pagination, not camera acquisition. Do not repurpose it.                                                                                                                                     |
| `src/features/finishedGoods/shared.tsx`                                          | Reuse `useFGText`, `useCanManage`, `useOperation`, `written`, `ErrorNotice`, draft identity, and unsaved-change patterns.                                                                              |
| `src/features/finishedGoods/ProductScreens.tsx`                                  | Add a Scan Packages action to the existing Finished goods catalogue.                                                                                                                                   |
| `src/app/[locale]/(desktop)/finished-goods/page.tsx`                             | Follow the thin localized route pattern and existing desktop shell.                                                                                                                                    |
| `convex/schema.ts`                                                               | `finishedGoodsPallets` represents storage units including boxes/pallets; do not create a duplicate package inventory model. Measurements are optional on units but required on existing placements.    |
| `convex/model/finishedGoods/packing.ts`                                          | `validatePacking` currently requires dimensions and confirmation; `MAX_FG_PACKAGES` is 50.                                                                                                             |
| `convex/finishedGoods/batches.ts`, `batchManagement.ts`, `workflow.ts`           | Packing commit, correction, reservation and confirmation enforce requirements beyond the visible fields. UI-only changes would fail.                                                                   |
| `finishedGoodsBatches.capacity`                                                  | Product quantity per package used in splitting. It is not a fullness percentage.                                                                                                                       |
| `convex/finishedGoods/workflow.ts`                                               | Existing command wrapper provides audit/idempotency; measured reserve/confirm and physical stack links are geometric. Reuse protections, not a loop of client-side single-unit assignments.            |
| `convex/lib/finishedGoodsSummary.ts`                                             | Source-write tracking maintains unit/product totals and status projections. New assignments must remain inside this transaction path.                                                                  |
| `convex/storageLayouts/locationCatalogue.ts` and storage-layout occupancy models | Counts, occupied-area math and location edit guards depend on placements. New location assignments must appear in counts without fabricated geometric area.                                            |
| `package.json`                                                                   | ZXing, Vitest, Testing Library, accessibility and Convex testing tools exist. No list drag-sort dependency exists.                                                                                     |

Read applicable `AGENTS.md` and relevant installed Next.js documentation before implementation. In particular, use the local client-boundary and routing guides; current Next.js is 16.3.3. The new interactive camera screen is a client component inside the existing localized server route.

## 3. User flow and exact behavior

1. Open **Scan Packages** from Finished goods. Keep the selected organization/warehouse and current navigation.
2. Request camera access and start scanning; offer a Start camera fallback when the browser requires an explicit gesture. Show Back, title, “Scan packages in order”, available flashlight control, large preview, scan frame and count.
3. Append each distinct package at the bottom. Keep acquisition running during validation and success feedback.
4. Allow review, touch drag, keyboard reorder and removal while remaining on the package screen. Use large visible sequence numbers and endpoint labels: **Top · 1** and **N · Bottom**. For one unit, indicate it is both top and bottom.
5. Show the two compact size/fullness questions below the list. Default to Yes and Full (100%) for new unanswered groups, visibly editable. Offer Full, ¾, Half, ¼ and Custom rather than requiring numeric entry every time. Reuse previously saved preparation answers; do not ask twice or overwrite existing partial values with 100%. No additional measurement screen. A non-full group can use one percentage for all units or override only exceptions; mixed sizes can still share one fullness value.
6. Enable **Scan Location** once at least one valid package exists, all pending resolutions are settled, and the simple answers are valid. Freeze the package list for location scanning; ignore package callbacks immediately on switching modes.
7. Header becomes **Scan Location**, subtitle “Scan the warehouse location”. Show “N packages — Will be assigned to this location”. Accept a supported barcode or QR location identity only.
8. On valid location detection, pause acquisition and show **Location detected**, location code/name and “N packages will be assigned”. Display the final top-to-bottom order and size/fullness summary. No write occurs yet.
9. **Rescan location** starts location acquisition again. Back to packages restores the same list, order and answers. Changing the list invalidates the prior confirmation snapshot.
10. **Confirm Location** submits one atomic assignment. Disable repeated submission and conflicting edits. On success show the saved location/count/order and a way back to Finished goods. On failure preserve the draft and show existing-style error feedback.

### Ordering rules

- Canonical order is a stable array of resolved unit IDs, never timestamps, barcode sorting, or backend completion order.
- Scans A, B, C produce `[A, B, C]`: A is top, C is bottom. Dragging C above B produces `[A, C, B]`: A remains top, B becomes bottom.
- Remove B from `[A, B, C, D]` to get `[A, C, D]` with labels 1, 2, 3. Persist that exact array on confirmation.
- Reordering changes intended physical order; it does not command machinery or prove that units are physically stackable.
- Never map list index directly to existing bottom-up geometric `zMm` or support links. No dimensions or support relationships may be invented from sequence.

### Acquisition and validation

- Use the installed ZXing multi-format reader for 1D barcode and QR decoding. Inspect its installed interfaces before choosing options.
- Use per-code cooldown (initial target around one second), plus session-wide canonical-ID deduplication. Distinct codes must not be suppressed by a global cooldown/in-flight lock.
- Insert a pending row immediately in detection order; resolve asynchronously in place. Pending rows show “Checking…” and do not count as successfully scanned packages. Invalid rows show an actionable inline issue and can be removed/retried; they block confirmation until resolved or removed.
- Two different labels resolving to the same unit produce one row. Keep the earlier detection, remove the later pending duplicate, and show subtle “Package already scanned” feedback.
- Success feedback lasts roughly one second and is nonmodal. It must not cover critical controls, move focus, or stop the camera. Announce status accessibly without flooding announcements for repeated frames.
- Removal cancels pending resolution for that row. A late result cannot restore it. A removed unit may be deliberately scanned again after cooldown and will append to the bottom.
- Retain session/generation guards for mode changes, unmount, context changes, retry and late camera startup. Stop all media tracks on exit; release flashlight resources too.
- Ignore normal frames with no readable code. Distinguish invalid identity, wrong entity type, unavailable unit/location, transport failure, permission denial and fatal decoder errors.
- Gate flashlight by actual device support; omit/disable clearly when unavailable. Sound/haptics are optional and are not required in the first implementation.
- Preserve the existing typed/handheld-code fallback, labeling it as manual verification; never record manual entry as camera evidence.
- Limit one group to 50 units initially, matching the existing bound. Explain the limit visibly, preserve the current list and prevent further additions; never truncate silently.

### State contract

Flow: `PACKAGES → LOCATION_SCANNING → LOCATION_DETECTED → SUBMITTING → COMPLETED`.

Camera state is separate: `OFF | STARTING | ACTIVE | UNAVAILABLE | ERROR`. Per-row resolution and transient scan feedback are separate from the flow state. This avoids stopping the camera whenever a row or toast changes.

Required states: empty, active camera, pending validation, success, duplicate, multiple units, remove/reorder, location scanning/detected/rescan, invalid scan, denied/unavailable camera, decoder error, save failure and successful completion. Returning from location scanning preserves the package draft. Unsaved exit follows the existing warning pattern.

If drafts are persisted, scope them by actor, organization and warehouse and version their format. Clear scanned location evidence on restoration and require fresh location verification. A context switch ends the camera session and cannot carry units into another warehouse. Do not claim offline completion; retry only when connected.

## 4. Backend and persistence contract

### Reuse with a necessary additive extension

Keep `finishedGoodsPallets` as unit identity and `pallet.placementId` as its authoritative current placement. Extend `finishedGoodsPlacements` with a backward-compatible location-only variant, rather than writing zero/fake dimensions or creating a competing inventory model.

- Existing rows without a mode continue to mean geometric placement and retain all required geometry.
- New `LOCATION_ONLY` rows contain real warehouse/building/floor/zone/location identity, optional real support-position identity when the scanned label addresses one, existing stored/released status and verification/audit fields. They omit geometry and physical supporting-pallet links.
- Model this as an explicit schema/type variant with reliable narrowing. Do not make every coordinate optional without distinguishing the representation.
- Add one small `finishedGoodsScanAssignments` receipt with `orderedUnitIds`, corresponding placement IDs, `sameSize`, per-unit `fillPercent`, target identity, actor, server timestamp and request identity. This record is justified because preparation batches are product-specific and do not represent an ordered scanning group across products.
- Each new placement references the assignment and its 1-based sequence. The receipt's array is the canonical order; validate any stored sequence fields against it. Scan time is optional client capture metadata; confirmation time is authoritative server time.
- Add tenant-scoped indexes and register the new table wherever tenant-table policy/types require it. Preserve old records without a backfill; missing fullness stays unknown, never silently becomes 100%.

### Proposed endpoints (new names, not existing APIs)

| Operation               | Input / result                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolvePackageCode`    | Warehouse + raw code → canonical unit ID/code, format, product, current status/version and eligibility. Resolve actual stored codes, not `PKG-*` prefixes.                                 |
| `resolveLocationCode`   | Warehouse + raw barcode/QR → canonical active destination identity and version. Check complete parent hierarchy and current published/active state. Reject ambiguous or wrong-kind labels. |
| `confirmScanAssignment` | Request ID, ordered units + observed versions, destination + evidence/version, same-size answer and unit fullness → existing write envelope referencing one assignment receipt.            |
| `getScanAssignment`     | Authorized assignment ID → saved ordered units, location and answers for completion/reload/detail.                                                                                         |

Use `queryWithOrg` / `mutationWithOrg`, current warehouse permissions, `command`, tenant DB access and tracked source writes. Register the new table in `convex/lib/schemaPolicy.ts`. Add frontend references in `src/lib/convex/finishedGoodsApi.ts`; regenerate Convex types through the existing command, not manual generated-file edits.

Existing unit identities include `P-000001` and `ISAS:PALLET:1:<palletId>`. Support those real labels alongside any other registered aliases. Existing location verification restricts plain codes to manual entry; the new resolver must intentionally support plain location barcodes scanned by camera as well as stored QR payloads, without falsely labeling camera scans as manual.

### Atomic confirmation rules

1. Revalidate actor access, warehouse, destination lifecycle/version, complete hierarchy, unit existence and eligibility inside the mutation.
2. Accept units awaiting measurement or placement: absence of dimensions must not block this workflow. Reject retired units, active reservations/moves, existing stored placements and support conflicts. This feature is initial assignment, not an implicit relocation or cancellation flow.
3. Reject an empty/oversized group, duplicate canonical IDs, malformed percentages or stale versions. Resolve aliases server-side as necessary; do not trust client labels or ordered IDs without scoped validation.
4. Validate every unit and target before writing. A returned failure envelope does not roll back earlier successful database writes; therefore do not write unit 1 and later return failure for unit 2. Unexpected failures must abort the transaction.
5. Insert the receipt and all placement rows and patch all units to `STORED` atomically. Existing summary tracking must observe those writes. Quantities remain unchanged.
6. Read and write each unit within the transaction so competing assignments conflict and retry against the new state. The target may contain other groups; groups remain distinct. Do not merge them into a global top/bottom order or infer a percentage capacity limit.
7. Freeze request ID and payload for retries after ambiguous network failure. Same request/same payload returns the same receipt; changed payload must not reuse a successful request ID. Include actor identity for this actor-bound verification operation, following the existing move-command pattern where appropriate.
8. Scanning a label is not independent proof of placement. The explicit Confirm Location action is the worker's physical confirmation, recorded with the verification method and current actor.

### Compatibility work is required, not a follow-up

Audit all readers/writers of `finishedGoodsPlacements`, `placementId`, `STORED`, and geometry fields. Location-only rows must:

- Appear in catalogue/detail/location counts and ordered assignment details, including after reload.
- Prevent occupied locations/buildings/positions from being deleted or edited incompatibly through existing occupancy guards.
- Be excluded from measured footprint, collision and 2D/3D geometry calculations. Views with unmeasured assignments must label measured area as partial/unknown instead of implying empty space or 100% free capacity.
- Render an ordered list in details instead of a fabricated 3D stack. Existing geometric rows still render normally.
- Receive explicit handling in move, stack, measure/correction, retirement and cancellation paths; none may dereference missing dimensions or silently release/reassign a group. Initial release/move support for location-only groups is outside this feature; show a clear unavailable action rather than a broken route, and preserve the saved assignment.
- Keep source and derived summary counts consistent. Do not add a second inventory ledger.

### Simplified package preparation

To avoid forcing workers through measurement before they can scan, add a simple path to the existing preparation flow. It retains product quantity and package splitting, permits absent dimensions and uses the two simple questions. Separate quantity validation from optional geometric validation. Preserve exact measured placement as an existing advanced capability; only that capability requires complete dimensions.

Update batch commit and correction validators as well as the form; allow simple units to proceed to scanning instead of being trapped at a “Measure” next action. Preserve quantities, existing measurements, batch revision checks, retirement safeguards and measured-mode validation. Add optional same-size/fullness metadata to preparation and revision snapshots as needed, and return it during unit resolution so scanning can prefill answers by canonical unit ID. Preserve exceptions when combining units from different preparation batches. Do not reinterpret `batch.capacity` or use fullness to calculate stock automatically.

## 5. Subagent task breakdown

All tasks below are implemented. Each agent reads this plan, current `AGENTS.md` and its owned files. Work only inside the new worktree; report changed files, actual checks and unresolved issues. Do not deploy or rewrite unrelated modules. Coordinate shared files through the integrating agent.

### T0 — Contract and baseline owner (integrating agent)

Depends on: none. Owns: this plan, shared contracts, baseline/checkpoint coordination.

- Establish the inherited baseline separately from feature work. Carry forward the user's preference for the easiest interaction: fullness presets, one group answer and exception-only edits.
- Freeze DTOs, flow events, location-only type discriminator, endpoint names and error codes used by subsequent tasks. Include actor/org/warehouse draft scope and 50-unit bound.
- Enumerate actual consumers of placement geometry and list their owners before parallel edits.
- Select a maintained touch/keyboard list-sort approach after checking the installed stack. Only the integrator edits `package.json`/lockfile if a small dependency is required.

Done when: backend, camera, state and UI agents can implement against one written contract, with no overlapping file ownership.

### T1 — Ordered scanning session

Depends on: T0. Owns proposed `scanSession.ts`, `usePackageScanSession.ts` and their focused tests under `src/features/finishedGoods/`.

- Implement deterministic append/pending/resolve/duplicate/remove/reorder events, canonical-ID dedupe, mode transitions and immutable submit snapshots.
- Preserve detection order under out-of-order responses. Cancel removed rows and late previous-mode callbacks.
- Implement simple answers and fill overrides, draft restore and count derivation without coupling camera lifecycle to list state.

Done when: `[A,B,C] → [A,C,B]` submits that order, #1/top and #N/bottom remain correct, rapid distinct scans are not lost, zero/unresolved/invalid rows cannot advance, retries retain their payload.

### T2 — Continuous barcode/QR camera

Depends on: T0. Owns proposed `useBarcodeCamera.ts`, `PackageScanCamera.tsx` and camera tests.

- Implement multi-format live capture, rear-camera preference, session guards, per-code cooldown, success/duplicate feedback, torch detection, permission/error/retry and cleanup.
- Support continuous package mode and gated location mode through the agreed callback contract.
- Preserve `DestinationScanner.tsx` behavior. If a shared extraction is necessary, agree ownership with the integrator and retain all existing single-shot tests.

Done when: decoding A then B keeps one camera session active; barcode and QR callbacks work; late startup/mode change/unmount cannot leak a stream or insert a package.

### T3 — Assignment schema and atomic backend

Depends on: T0. Owns `convex/schema.ts`, proposed `convex/finishedGoods/scanning.ts`, assignment domain validation, tenant registration and focused integration tests. Owns narrow shared command-helper changes during its wave.

- Add compatible placement variant and assignment receipt; implement scoped resolution, confirmation and readback.
- Reuse authorization, audit, idempotency and summary tracking. Preflight all validation before mutations; prevent concurrent assignment and altered-payload replay.
- Add proper scoped indexes; resolve current application labels including real zone/position QR payloads without exposing cross-tenant existence.

Done when: complete groups save atomically in exact order, missing dimensions succeed, invalid final member saves nothing, concurrent conflicts cannot double-store a unit, reload returns the same order and percentages.

### T4 — Reference-based workflow UI

Depends on: T0 contracts; integrates T1/T2/T3 when available. Owns proposed `PackageScanningScreen.tsx`, `ScannedPackageList.tsx`, `ScanGroupDetails.tsx`, `LocationScanConfirmation.tsx`, new scan route, and catalogue entry action in `ProductScreens.tsx`.

- Build the large live preview, overlaid header/count, nonblocking feedback, high-contrast numbered list and sticky Scan Location action using existing tokens and controls.
- Add touch-handle drag, visible drag state, keyboard/up/down alternatives, focus retention and live announcements. Preserve normal page scrolling; do not rely solely on native HTML drag/drop.
- Place simple questions in the existing flow, not a mandatory dimension wizard. Wire location mode, rescan, back, confirmation, save/retry and completion.
- Provide English/Thai text through `useFGText`, existing `ErrorNotice`/`Notice`, warehouse access boundary and permission affordances. Preserve navigation and desktop responsiveness.

Done when: all specified states are reachable and understandable, minimum 44px touch controls fit narrow screens, sticky actions do not hide rows, and no package-by-package camera restart is needed.

### T5 — Placement reader compatibility

Depends on: T3 schema contract. Owns placement read adapters and affected storage-layout catalogue/occupancy views, `PalletScreens.tsx`, `PalletScene.tsx`, `DestinationPicker.tsx`, and narrow geometry-consumer branches agreed in T0.

- Update every placement consumer identified in T0 for the explicit variant, including location edit/delete guards, counts, summary detail, rendering and geometry-dependent action availability.
- Show saved top-to-bottom order and actual location for location-only units. Never depict unknown dimensions as a measured stack.
- Retain all behavior for existing measured placements and active moves; test a location containing both types.

Done when: location-only assignments are visible and counted, cannot be orphaned by location edits, produce no misleading geometric utilization, and no existing reader crashes or silently drops them.

### T6 — Remove measurement gates from simple preparation

Depends on: T3 and T5 shared-file changes landed. Owns `PackingScreen.tsx`, `PackingDimensionFields.tsx`, `packingRows.ts`, `unitNextAction.ts`, packing validators, batch commit/correction and their tests. Coordinate `workflow.ts`, `schema.ts` and shared API edits with T3/integrator; do not edit them concurrently.

- Introduce simple preparation with optional measurements and the agreed answers. Preserve quantity splitting and advanced measured preparation.
- Split validation so dimensions/confirmation are required only by geometric operations; update server and client together.
- Make Scan Packages available for unmeasured units; retain legacy statuses safely until broader status cleanup is separately requested.

Done when: a package can be prepared, scanned and assigned without entering dimensions, while quantity mismatch still fails and measured placement still enforces its own geometry rules.

### T7 — Integration and verification

Depends on: T1–T6. Integrator owns API reference wiring, generated artifacts, final shared-file merges, test fixtures and feature-wide checks. A QA subagent may own separate test files after file ownership is agreed.

- Wire real APIs; remove temporary contract stubs. Review diff against the inherited checkpoint.
- Run focused behavioral/a11y/backend checks, then repository checks and build. Investigate failures; distinguish inherited failures with evidence rather than deleting tests.
- Perform device acceptance and save concise screenshots/check results with real live scanner states where available. Do not claim optical or touch verification from unit mocks.

Done when: all acceptance checks below pass, failures are resolved or explicitly documented, no requested state is missing, and implementation is ready for user review. Deployment remains a separate action.

### Scheduling and ownership

With three subagent slots, run T1, T2 and T3 in parallel after T0. Next run T4 and T5; T6 starts after their relevant shared contracts/edits settle. Finish with T7. Queue work instead of exceeding the available slots. Backend and UI preparation edits to shared files must be serialized.

Handoff format for every task: implemented behavior; exact owned files changed; public contract changes; tests actually run and results; outstanding integration work. No agent may silently change the meaning of fullness, sequence, location identity or duplicate handling.

## 6. Acceptance and verification checklist

| Scenario                  | Required result                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty list                | Zero count, clear scan instruction, Scan Location disabled.                                                                                            |
| Continuous A/B/C          | Camera remains active; count 3; A top and C bottom.                                                                                                    |
| B resolves before A       | Final list still A/B in detection order.                                                                                                               |
| Repeated frames / aliases | One canonical unit, subtle duplicate feedback, no count increase.                                                                                      |
| Remove/reorder            | Immediate contiguous numbering/count; reordered payload and saved readback match exactly.                                                              |
| Remove then late resolve  | Removed row never reappears. Deliberate later rescan appends at bottom.                                                                                |
| Mode switch               | Package callbacks cannot add units in location mode; back retains the list.                                                                            |
| Wrong/unknown code        | Entity-specific feedback; no accidental package/location creation or assignment.                                                                       |
| Barcode and QR            | Real 1D package/location barcode and QR labels decode on supported devices.                                                                            |
| Camera lifecycle          | Permission denied, missing API, retry, ordinary unreadable frames, fatal errors, late startup, unmount and unsupported torch handled.                  |
| Wrong location            | Rescan without losing order; only explicit confirmation saves.                                                                                         |
| Similar/mixed size        | Both paths work without mandatory dimensions. Common fullness and exceptions survive reorder by unit identity.                                         |
| Percentage                | 100 and valid partial values save; 0, negative, >100, fractional/nonfinite/blank required values fail. Quantity and existing split capacity unchanged. |
| Missing measurements      | Simple preparation and group storage complete; measured advanced operations still validate geometry.                                                   |
| Atomicity                 | Failure on any member leaves all units unassigned; competing workers cannot double-assign.                                                             |
| Retry/double tap          | Same command yields one receipt and one set of placements. Changed payload cannot replay an old success.                                               |
| Security/lifecycle        | Cross-org/warehouse units and destinations, inaccessible/retired units, inactive/unpublished locations and stale revisions rejected server-side.       |
| Persistence               | Refresh/detail readback preserves top-to-bottom sequence and exact target; restored unfinished drafts require fresh location verification.             |
| Compatibility             | Old measured placements/moves still work; mixed locations count both kinds, geometric usage marked incomplete and occupancy guards retain all units.   |
| Accessibility/mobile      | Keyboard reorder, labeled buttons, focus recovery, noncolor feedback, readable contrast, touch drag and long-list scrolling work in both languages.    |
| Limit                     | 50-unit group works; 51st is refused without truncating or losing the first 50.                                                                        |

Suggested automated layers: pure session/domain tests; decoder lifecycle mocks patterned on `DestinationScanner.test.tsx`; screen interaction and `jest-axe` tests; Convex integration tests for authorization, atomicity, idempotency, concurrency, order readback and mixed placement types.

Run focused tests first, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and formatting checks on touched files. Follow repository release checks, including dependency audit, before any later release. Use local Convex only; no production writes are needed for verification.

Manual device gate: rear camera, rapid multiple scans, actual barcode plus QR, held duplicate, flashlight available/unavailable, denied permission recovery, touch reordering near scroll boundaries and a real confirm/rescan cycle. Record untested hardware explicitly if unavailable.

## 7. Completion definition

The feature is complete when a worker can scan multiple existing packages/pallets continuously, correct top-to-bottom order, answer the simple size/fullness questions, scan a real location, and save one verified ordered assignment without entering dimensions or restarting the camera for each package. Saved order, warehouse counts, permissions, retry behavior and existing measured workflows must remain correct.
