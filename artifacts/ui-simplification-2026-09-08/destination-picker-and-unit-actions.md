# Shared destination picker and direct catalogue actions

Implemented 2026-09-08 in `codex/storage-planner`.

## Destination selection

- Recommendations and moves share `DestinationPicker`; existing queries, eligibility and ordering remain owned by their screens.
- Search matches location name/code, building name/code, English/Thai floor labels and support name/code, ignoring case and surrounding whitespace.
- Searching and clearing never change the selected destination or reserve space. The original recommended badge stays attached to its candidate, even when filtered out.
- Store retains its unavailable-area and stacking toggles. Move retains unavailable previews. Both now show the support footprint and base elevation.
- Optional actor/warehouse/unit-scoped `stateKey` restores the search after a correction round trip; the caller supplies the scope. No availability or lock state is stored.

## Catalogue next actions

| Unit state | Visible action | Destination |
| --- | --- | --- |
| Awaiting measurement, legacy unit | Measure | Existing measurement page |
| Awaiting measurement, preparation batch | Measure | Product editor focused on the exact unit |
| Awaiting placement | Choose storage | Recommendation page directly |
| Reserved placement | Continue placement | Existing identity and placement flow |
| Reserved/in-transit move | Continue move | Existing move flow directly |
| Stored, no active move | View details | Detail page checks support locks before offering a move |
| Read-only or retired record | View details | Inspection only |

Card code/name links and table code links always open details. An explicit text action opens the next step. Existing catalogue filtering/presentation state is unchanged.

The list response does not contain support-lock details, so a new move is intentionally offered by the existing detail screen after loading those rules. This UI change adds no backend mutations and bypasses no verification.

## Verification

- 91 tests passed across DestinationPicker, unitNextAction, ProductScreens and ProductScreens accessibility suites.
- TypeScript check passed after the shared optional recommendation prop was corrected.
- Scoped ESLint passed.
- Tests cover bilingual search, no-match/clear, stable selection, floor/shelf/pallet key separation, session-scoped search restoration, direct actions in both cards and tables, batch correction, active movement, read-only access, stored-unit fallback and retired records. Existing catalogue filter/privacy tests and Thai/English accessibility checks pass.
- Log: `destination-picker-and-unit-actions-tests.log`.
- Live browser recording/viewport inspection is recorded separately by the main implementation task. Component tests are not evidence of real camera/touch behavior.

## Code accounting

Compared with the captured baseline, Recommendations fell from 297 to 194 lines and MoveSelection from 220 to 122 before later session-draft wiring. The first shared picker was 168 lines: **33 fewer production lines** across those three boundaries, with `destinationKey` relocated rather than duplicated. Session-draft wiring adds a few lines afterward.

Direct catalogue actions and the summary simplification together: ProductScreens +2 lines, FinishedGoodsTable -17, shared unitNextAction +45, net **+30 production lines** versus the baseline for these files. The next-action feature adds functionality; overall accounting must include the main task's reservation and packing changes.

Both product cards and table rows now compute `productPalletSummary` once per product render, reusing its quantity/format/status result. Source inspection confirms **3 → 1 calls per product** in each view, removing two redundant unit-list scans per rendered product and 28 lines compared with the preceding direct-action version. Existing summary/quantity behavior tests pass. This is an operation-count improvement, not a measured wall-clock latency claim.
