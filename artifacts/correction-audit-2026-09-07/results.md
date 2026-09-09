# Correction-flow UI audit

Worktree: `/Users/macbook/Development/industrial-sas-storage-planner`, branch `codex/storage-planner`. App: http://localhost:3100.

## Audit loops and outcome

1. **Find corrections:** moved Move / Change storage position beside the actual destination, and added direct per-unit packing actions. Move destinations are searchable by building, floor, location and support/rack identifiers. Search does not discard the chosen position or coordinate edits.
2. **Remove secondary friction:** compacted the source address above the move editor; targeted and focused the exact location card after asynchronous loading. Correcting one unit now replaces only that unit, using the existing backend subset operation. Neighboring units keep their IDs, quantities, dimensions and positions. Whole-batch editing still supports 4 → 2.
3. **Review the combined flow:** added a one-click Edit location details shortcut to the existing location editor. Direct editor scope is explicitly named and stays stable when previewing other units. Missing, locked or retired selected IDs never fall back to editing other units.
4. **Final permission audit:** discovered pre-existing layout mutation controls visible to view-only users. Fixed the UI too: add/edit/archive, dimensions, dragging, unavailable-area changes and saving are disabled until manage permission is ready. Open editors close if permission is revoked. Targeted tests cover read-only/loading/revocation; a live read-only account was not used.
5. **Mobile refinement:** fixed intrinsic grid sizing on floor cards. At 390px the page initially measured 396px wide; explicit zero-minimum grid tracks and wrapping reduced it to exactly 390px without hiding overflow. The dialog and underlying page were both rechecked.

## Click reduction

| Correction | Before | After |
|---|---|---|
| Edit a location's details from a stored unit | Find footer link, open floor, find location card, click Edit | **One click** beside the destination opens the correct editor |
| Correct one unit's dimensions | Open batch editor, identify the row, recheck all available units and replace them together | **One click** on that unit; only its replacement is reviewed/saved |
| Find a move destination | Browse a long horizontal strip | Search then select; no scrolling through unrelated destinations |
| Start a move | Find action below scene and QR sections | Action next to the displayed destination |

Physical pickup, identity verification, reservation and confirmation remain explicit. No weight/load enforcement added.

## Browser checks and QA data

- Desktop English and Thai; mobile 390 × 844 Thai. Mobile document width stayed 390px; packing dialog width/scrollWidth both 356px.
- Wrong/empty search preserves the current preview and coordinate edits. Clearing restores destination choices.
- Negative move X and zero location width block review/save. Wrong pallet/destination codes cannot advance the move.
- Move reservation survives refresh. Cancel before pickup releases the new reservation and preserves the original stored position.
- Completed simulated physical QA move for **P-000019**, X 1.2 → 1.3 m, Y 1.2 m, Z 0, at DEMO-BLDG floor 1. Final position **POS-000018**, no active move remains. Quantity stays 50.
- Corrected only **P-000022** (10 pieces), height .20 → .25 m. Existing replacement semantics create **P-000023** (`n178561kwk1d427xg1yanhdgkx8dza8c`) and retire P-000022. **P-000020 and P-000021 stay unchanged**, QA-BOX stays 110 pieces / 3 active boxes; product stays **210 pieces / 3 boxes / 2 pallets**.
- Wrong mobile allocation 11/10 stays blocked. Correct 10/10 can review. Escape returns focus to the same unit edit action.
- Exact location shortcut focused `storage-zone-s970ppcb9eyz90nskhd6nz871s8d7mrv`, 80px below viewport top. Edit opens correct location; invalid width blocks save; Cancel preserves it.
- No camera/hardware scanner used; videos demonstrate manual code verification in the local QA warehouse. Physical acknowledgements are test simulations.

## Verification

Final combined gate: **602 tests / 62 files passed**, typecheck, lint, production build (`NEXT_DIST_DIR=.next-build`) and `git diff --check` passed. Full tests include simultaneous reservations/revisions, collisions, support locks, return/cancel, stale changes, retired-unit filtering, and 4 → 2 repacking with exactly two active units.

Focused tests added for search retention, compact source coordinates in both languages, contextual permission guards, per-unit edit eligibility, single-unit scope, missing/locked scope, focus, delayed hash navigation and stable selection across tabs.

After the final CSS-only mobile refinement, the layout suite was rerun and the production build repeated. Earlier full-gate output (598 tests) is retained in `tests.log`; final combined output is in `tests-final.log`.

Browser error log: `console-errors.json` contains no errors. Initial focused test failure was an old expected floor URL missing the new anchor; expectation was updated and 50 contextual/pallet tests passed. Keep the initial log as audit evidence.

## Videos

All are actual browser screen captures encoded to H.264, no audio, at 10fps. Pauses between recording segments are removed; frames are not generated mockups.

- **01-move-location.mp4** — 21.14s: contextual Move, destination search/empty recovery, coordinate correction, 2D/3D, review/reserve, pallet verification/pickup, wrong destination then correct code, completed placement.
- **02-packing-correction.mp4** — 9.90s: direct P-000022 edit, invalid height, corrected height, measurement acknowledgement, review/save, unchanged batch/product totals and neighboring units.
- **03-direct-location-edit.mp4** — 10.82s: final one-click shortcut, correct location editor, invalid width, 2D preview and cancellation. The earlier `03-location-details.mp4` records the intermediate two-click iteration and is retained for comparison.

Key screenshots: `stored-actions-final.png`, `move-desktop-en.png`, `move-desktop-th.png`, `packing-single-unit-desktop.png`, `packing-correction-result.png`, `packing-mobile-th.png`, `packing-review-mobile-th.png`, `move-search-mobile-th.png`, `move-preview-mobile-th.png`, `move-review-mobile-th.png`, `location-editor.png`.

## Remaining limits

The existing replacement model issues a new code for the corrected unit; the old code remains in history. This is disclosed before saving. Hardware camera scanning and actual warehouse movement were not tested. The 3D scene remains a schematic preview, and high zoom has no panning. These are outside the correction-path changes.

## Completion

All planned correction flows are implemented. Five audit/refinement loops completed; independent code review found no remaining blocking issue in these changes. Final browser checks confirmed saved packing values survive navigation, protected units have no direct edit action, and authorized location editing still works after permission changes. The app remains running on port 3100. The next possible improvements are broader workflow redesign or scene camera controls, rather than defects found in the corrected flows.
