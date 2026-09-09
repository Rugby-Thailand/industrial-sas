# Finished goods flow — QA matrix and integration audit

Prepared 2026-09-05 from `flow.md` and the extracted planner. This is a test plan and read-only audit, not a claim that the cases have passed. Record execution evidence in the implementation run log and link screenshots/video there.

## Release-critical invariants

1. Product SKU, physical pallet identity, named location (FG-1), and exact coordinate placement are separate identities.
2. Product creation remains two steps: details, then measurement. Recommendations/reservation/storage follow.
3. All geometry uses safe integer millimetres on the server. Unit toggles convert values; display rounding must not change stored geometry.
4. Recommendations and preview adjustments do not consume space. Reservations and stored pallets both block space.
5. Reservation revalidation and write are atomic. Repeated requests cannot create duplicate pallets, holds, or placements.
6. Scanning verifies a destination identity. Operator confirmation records physical storage; scanning alone does not prove the X/Y position.
7. Auth, organization, warehouse, permissions, current destination status, bounds, height, support and collisions are enforced on the server.
8. Existing occupied or held geometry cannot be moved, shrunk, reconfigured, or archived by planner edits without an explicit safe relocation workflow. A generic confirmation boolean must not bypass fit validation.

## Execution matrix

Use desktop (about 1440 × 1000), tablet (768 × 1024), and mobile (390 × 844). Repeat primary happy flow in Thai and smoke-test English. Backend tests cover invariant combinations; browser checks cover interactions and rendering.

| ID | Scenario | Expected result | Level |
|---|---|---|---|
| F01 | Empty finished goods list | Helpful empty state, Add action, no fake inventory | UI |
| F02 | Add button | Full details page, step 1 of 2, nothing persisted by opening | UI/integration |
| F03 | Valid product, Next | One product and one pending pallet; measurement resumes same records | Integration/UI |
| F04 | Blank/whitespace required fields | Inline errors; no advancing | Unit/UI |
| F05 | Duplicate SKU; mixed case and trailing spaces | Server normalization and uniqueness; useful open-existing action | Integration/UI |
| F06 | Oversize text, punctuation, Thai names | Explicit limits; safe text rendering; wrapping preserves controls | Unit/UI |
| F07 | Save incomplete draft | Draft persists; list distinguishes from ready pallet | Integration/UI |
| F08 | Cancel/back with unsaved edits | Discard dialog; Keep editing preserves data | UI |
| F09 | New pallet for existing product | Starts measurement, distinct pallet ID, product not duplicated | Integration/UI |
| M01 | Valid L/W/H, actual qty, optional lot/weight | Live correctly scaled preview; saved measurement | Unit/UI |
| M02 | Missing, zero, negative, nonnumeric dimensions | No recommendations; save draft still possible per contract | Unit/UI |
| M03 | NaN/infinity/fractions/huge integers via direct backend | Rejected before geometry calculations | Unit/integration |
| M04 | Metres → centimetres → metres, decimals | Physical size unchanged; no silent rounding drift | Unit/UI |
| M05 | Rotate/reset camera | Dimensions and orientation of physical footprint unchanged | UI |
| M06 | Back to details then return | Same pallet, retained fields, no duplicate request | UI/integration |
| M07 | Refresh/deep link to pending measurement | Correct product/pallet state restored | UI |
| M08 | Save and exit incomplete/complete | Draft or awaiting-placement state correct | Integration/UI |
| R01 | Active FG-1 with adequate free geometry | Ranked candidate includes exact local X/Y, orientation, Z/support | Unit/UI |
| R02 | No locations, only draft/archived buildings | Clear no eligible location state and route to configure storage | Integration/UI |
| R03 | Footprint fits only after 90° rotation | Valid rotated candidate, dimensions swapped correctly | Unit/UI |
| R04 | Exact boundary contact; 1 mm outside | Boundary contact allowed by geometry policy; outside rejected | Unit |
| R05 | Adjacent pallet edge; 1 mm overlap | Edge contact allowed; overlap rejected | Unit |
| R06 | Reserved and stored footprint collision | Both excluded by recommendation and reservation mutation | Integration |
| R07 | Pallet taller than ceiling or support clearance | No-fit explanation names height limitation | Unit/UI |
| R08 | Reserved floor block/intersecting unavailable area | Never recommended; manual placement invalid | Unit/integration |
| R09 | Missing storage condition/weight limit metadata | Mark unknown; never falsely claim compatibility | UI/unit |
| R10 | Configured condition mismatch | Exclude/reject with specific reason | Unit/integration |
| R11 | Nonzero location X/Y and floor offsets | Local preview maps to correct floor/building geometry | Unit/UI |
| R12 | Rack/platform | Use configured support elevation and clearance; no floating Z | Unit/UI |
| R13 | No fit | Stay on recommendation screen with dimensions and reasons; edit/save-later actions | UI |
| R14 | Select another location and reset recommendation | Coordinates, geometry, reasons and breadcrumb all update together | UI |
| A01 | Drag, arrows, numeric coordinates, rotate | Same geometry state, consistent step and orientation | UI/unit |
| A02 | Invalid manual adjustment | Red preview, explanation, disabled Use position/Confirm | UI/integration |
| A03 | Adjust then cancel/reset | Restore previous/recommended position; no reservation | UI |
| H01 | Confirm spot opens review modal | Complete destination and dimensions; no hold until Reserve | UI/integration |
| H02 | Two pallets reserve same area concurrently | Exactly one succeeds; loser retains data and refreshes candidates | Integration |
| H03 | Repeated/double-click reserve | Single hold, stable identity | Integration/UI |
| H04 | Reservation succeeds then response lost/retry | Resumes existing reservation; no duplicate | Integration |
| H05 | Refresh, reopen, browser Back while reserved | Reservation persists and is shown accurately | UI |
| H06 | Change spot fails | Original reservation retained | Integration |
| H07 | Change spot succeeds | New hold acquired and old hold released atomically | Integration |
| H08 | Cancel reservation dialog dismiss/confirm | Dismiss keeps hold; confirm releases and returns awaiting-placement | UI/integration |
| H09 | Attempt measurement edit after reservation | Explicit release/change route; no stale incompatible hold | UI/integration |
| S01 | Open scanner | Camera requested only on click; closing releases camera stream | UI |
| S02 | Camera denied/unsupported | Retry or clearly labeled manual code verification | UI |
| S03 | Wrong/invalid QR, wrong warehouse/org code | Expected-vs-scanned error without tenant data leakage; Confirm disabled | Integration/UI |
| S04 | Correct location-level QR | Location verified; exact X/Y guide remains visible | UI/integration |
| S05 | Correct/wrong exact position QR | Only matching target position accepted | Integration |
| S06 | Change destination after verification | Prior verification invalidated | Integration/UI |
| S07 | Confirm stored with stale/cancelled hold | Rejected without creating occupied geometry | Integration |
| S08 | Double/replayed Confirm stored | One stored pallet/placement; no duplicate quantity | Integration |
| S09 | Complete storage success | Solid footprint, exact destination, useful next actions | UI |
| X01 | Unauthenticated deep links/API calls | Sign-in/authorization outcome, no data exposed | Integration/UI |
| X02 | Other organization/unauthorized warehouse IDs | Denied consistently across read/save/reserve/scan/confirm | Integration |
| X03 | Read-only role invokes write directly | Denied, UI has appropriate disabled/hidden actions | Integration/UI |
| X04 | Network error during save | Values retained, actionable retry, no permanent loading state | UI |
| X05 | Mobile keyboard, modal, 3D controls and footer | Inputs usable, no overflow/hidden actions, touch targets usable | UI |
| X06 | Keyboard-only and focus return | Dialog trapped appropriately, Escape closes safe dialogs, errors reachable | UI |
| X07 | Navigation between list, pallet, location map | Stable route identities; no stale previous pallet/location | UI |
| X08 | Long list / geometry limit | Explicit limit or pagination; never silently omit blockers | Integration |
| X09 | Console/network | No hydration errors, React warnings, failed authenticated queries | UI |
| X10 | Final complete flow and refresh at each stage | Product → measure → adjust → reserve → verify → store → view position works | UI/video |

## Existing planner mutation hooks

Line numbers are from this audit and will move during implementation. All paths are relative to the project root.

| Entry point | Current behavior | Required occupancy integration |
|---|---|---|
| `convex/storageLayouts/writes.ts:250` `updateStorageBuilding` | Validates all floor zones against proposed width/depth/default height. Rejects archived/version conflicts. | Before any write, ensure held/stored destination envelopes remain valid. Default height changes affect floors without height overrides. Label-only rename may remain allowed. |
| `convex/storageLayouts/writes.ts:453` `saveStorageFloor` | Replaces floor geometry, height, offsets and reserved blocks after zone validation. | Guard footprint/height/support changes and added reserved blocks against held/stored placements. Changing floor offsets affects mapped building coordinates even if location-local coordinates stay identical. |
| `convex/storageLayouts/writes.ts:583` `changeStatus` → `archiveStorageBuilding` | Archives building and marks each active zone's `locationId` inactive. | Block archive while any descendant pallet is RESERVED/STORED. Include every child position, not just default zone location. Guard direct calls too. |
| `convex/storageLayouts/writes.ts:677` `activateStorageBuilding` | Requires at least one zone and validates layout. | Recommendations require ACTIVE building. Validate support compatibility after reactivation. Current status change only patches zone locations, not distinct child position locations. |
| `convex/storageLayouts/zones.ts:559` `updateStorageZone` | Allows move/resize/height/mode/base-elevation; validates nondefault positions; patches default position to new zone bounds. | Block geometry/mode/support edits with held/stored pallets unless unchanged or a dedicated safe relocation path exists. Label-only edit can be allowed. `confirmOccupiedChange` is accepted but currently unused: do not treat it as server protection. |
| `convex/storageLayouts/zones.ts:1033` `updateStoragePosition` | Validates position against area, then writes label and geometry. | Guard held/stored pallets at this position before geometry mutation. Also validate active zone/building: this path currently reads parent zone but does not reject archived building. |
| `convex/storageLayouts/zones.ts:1118` `archiveStoragePosition` | Requires another leaf position; archives position and its location. | Reject held/stored occupancy before touching either record; check parent editability. |
| `convex/storageLayouts/zones.ts:1361` `archiveStorageZone` | Archives zone location plus every active child position/location. | Reject any reserved or stored descendant before the first write. |
| `convex/storageLayouts/writes.ts:353` `changeStorageFloorCount` | Only increases floor count. | No occupancy block needed for pure addition; retain validation. There is no floor deletion path to retrofit. |

Suggested shared seam: one server helper querying active pallet reservations/placements by organization plus warehouse/building/zone/position, and one pure geometry validator used by recommendations, reserve, confirm, and planner edit guards. Do not rely on UI snapshots of occupancy. Bound scans safely: the existing planner permits 50 zones/floor and 100 positions/zone; a new pallet query must not silently truncate blockers with `.take(N)`.

## Specific risks found in current code

- **Coordinate convention:** `convex/model/storageLayout/storagePosition.ts:95` validates position X/Y against area X/Y, so existing position coordinates are floor-relative. The new UI calls its pallet X/Y location-local. Convert explicitly: floor X = zone X + local X; floor Y = zone Y + local Y. Include floor offsets when rendering building context. Test nonzero origins and rotated footprints.
- **Empty occupancy wire:** `convex/storageLayouts/catalogue.ts:116` and `:136` return `placements: []`. Existing impact confirmations and counts in `src/features/storageLayouts/StorageLayoutScreens.tsx` therefore always see no occupancy. Populate the new canonical occupancy or provide a separate typed field and update display; do not keep stale empty placeholders for operational records.
- **Archived destination QR still resolves:** `convex/storageLayouts/zones.ts:1264` `resolveStorageAddress` checks active zone/position but only checks that building exists. Archiving leaves zones ACTIVE. New reserve/confirm/verify paths must require building ACTIVE and current authorized location/position state. Consider fixing resolver itself.
- **Default/simple position compatibility:** catalogue creates an in-memory fallback position without `positionId` when an older SIMPLE zone has no stored leaf record. Avoid asserting every candidate has a persisted position ID unless the implementation explicitly backfills/ensures it first.
- **No meaningful generic confirmation override:** Existing UI has `confirmingImpact`, but backend no longer checks inventory. Backend safety must be rebuilt around the new pallet records.
- **Identity and QR:** Existing QR values are `ISAS:LOCATION:1:<locationId>` for both default zone and exact child positions. Resolve the ID and parent relationship; do not accept display labels such as FG-1 as globally unique identities.
- **Unknown conditions:** Storage zone schema currently encodes geometry/mode/support; storage-condition compatibility needs explicit metadata before UI can claim a match.
- **UI compatibility:** Current placement rendering includes legacy stack level/height assumptions. New side-by-side exact footprints must not be displayed as a vertical stack just because they share FG-1.

## Suggested integration tests for planner safety

For both RESERVED and STORED pallets:

1. Archive occupied building, zone, and exact position: rejected; statuses unchanged.
2. Move, shrink, lower max height, change mode, or change support elevation of occupied zone: rejected; pallet coordinates unchanged.
3. Move/shrink occupied explicit position: rejected; label-only rename permitted if it does not change identity.
4. Resize floor or change height so pallet/zone cannot fit: rejected; no partial reserved-block edits.
5. Add a floor or rename building/location with valid unchanged geometry: still works.
6. Cancel only hold, then repeat valid edit/archive: succeeds; STORED occupancy remains blocking.
7. Competing planner edit and reservation: serialization produces a valid final state, never an occupied invalid destination.
8. Archive then scan/reserve using stale IDs: rejected; no shortcut through direct API.

## Screen recording capability investigation

Read-only investigation only: no recording, browser interaction, settings change, or permission prompt started.

- No dedicated live screen-recording MCP capability was found in available tool metadata. Figma export-video is for a Figma timeline, not the running app.
- `ffmpeg` was not on PATH; common `/opt/homebrew/bin` and `/usr/local/bin` paths contained no ffmpeg/ffprobe match.
- macOS `/usr/sbin/screencapture` exists. Its usage output documents `-v` (video), `-V<seconds>` (bounded duration), `-R<x,y,w,h>` (region), `-D<display>` (display), and `-k` (show clicks).
- Proposed final capture command once the UI is stable and the desired screen is visible: `/usr/sbin/screencapture -v -V120 -k -R<x,y,w,h> <absolute-output-path>.mov`. Choose actual inspected region coordinates, execute in an ongoing shell session, perform the main browser flow, then check the file with native metadata and view/play it. Do not claim the recording succeeds until verified; host Screen Recording permission may affect capture.
- Save native `.mov` if no converter is present; do not spend money on conversion. A real screen recording is distinct from a slideshow of screenshots.

## Evidence file checklist

- Saved written plan, generated reference images, and this QA matrix.
- Implementation decisions and any intentionally unsupported states.
- Test command logs (`pnpm typecheck`, `pnpm lint`, `pnpm test`, production build when stable).
- Desktop screenshots of list, details, measurement, recommended placement, invalid placement, reservation, wrong QR, verified destination, stored result.
- Mobile screenshots of details, measurement, recommendations, reservation, and stored result.
- End-to-end real screen recording, plus clear README with output paths and any limitations.
