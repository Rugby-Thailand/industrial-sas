# Automatic pallet stacking port — verification

Implemented in `codex/storage-planner` at `/Users/macbook/Development/industrial-sas-storage-planner`. Development server remains on port **3100**. Source: `codex/pallet-stacking`, including its uncommitted automatic-drag changes. No branch-wide merge, schema migration, environment copy, or weight/load enforcement was introduced.

## Six stages

1. **Capture:** source/destination hashes matched the reviewed plan; captured both file sets before editing. Baseline passed 493 tests, typecheck and lint. See `before-hashes.json`, `source-before.tar.gz`, `destination-before.tar.gz`, `baseline.log`.
2. **Backend:** added root support identity and rejected preview surfaces. Valid recommendations remain separately validated. Added `previewCandidates` so a location with no fitting destination can still be inspected; invalid previews cannot bypass server reserve/confirm checks. Focused integration run: 67 tests passed.
3. **Geometry:** positive overlap automatically chooses the highest intersecting pallet top on the same original floor/rack. Overhang and low ceiling retain elevated Z with an error. Edge-touching and moving clear return to the original fixed support. Camera bounds remain stable when the support changes.
4. **UI:** shared storage/move editor resolves drag, keyboard, rotation and X/Y through the same rules. Removed Z selection/input; computed Z and support identity remain visible. Invalid placement disables use/review/reserve. Requests send support identity, X/Y and rotation, not trusted client Z. BOX/OTHER stay on fixed supports; their help text now correctly describes floor/rack placement.
5. **Compatibility:** retained retirement filtering, PALLET eligibility, batch ownership, reservation/move support locks and physical identity checks. Existing integration coverage verifies 4 → 2 repacking, replacement limit resets, unchanged quantities/weights, concurrent reservations, idempotent retry, cancellation, interrupted return and changed limits before confirmation.
6. **App verification:** checked actual desktop 2D/3D dragging, completed stacking and unstacking in the running app, checked Thai/English at desktop and 390 × 844 responsive viewport, saved screenshots and a real browser capture video. Temporary viewport override reset.

## Final automated results

- `pnpm check`: **538 tests passed in 60 files**, typecheck and lint passed (`full-check-final.log`). This includes batch-management work added concurrently in the shared worktree; the stacking port preserves those changes.
- `NEXT_DIST_DIR=.next-build pnpm build`: passed (`build-final.log`). Separate build directory preserves the running dev app.
- `git diff --check`: passed.
- During combined verification, updated an old ProductScreens test expecting an Edit packing link to the current Edit available units button. A transient type error in concurrently edited BatchManager tests was resolved before the final passing run.
- Reviewed changed geometry, preview generation, support identity clearing, action guards and payloads. No stacking weight/load rule appears in ported implementation.

## Browser evidence and data outcome

Used dedicated QA product **BATCH-QA-0906**, lower **P-000018**, upper **P-000019** (50 pieces each). No user TEST001 data was modified.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Real 2D pointer drag onto lower | X 3, Y 0, Z 1.4; use enabled | `01-auto-top-en.png` |
| Overhang by 0.1 m | Z stays 1.4; red reason; use disabled | `02-overhang-red-en.png`, `14-desktop-th-overhang.png` |
| Drag clear | X 1.2, Y 1.2, Z 0; lower identity cleared | `03-drag-clear-floor-en.png` |
| Real 3D pointer drag | Automatically reaches P-000018 at Z 1.4 | `04-auto-stack-3d-en.png`, `automatic-stacking-demo.mp4` |
| Refresh after reserve | Resumes prepared move to POS-000014; no extra reservation | Verified in running browser |
| Wrong upper code | Rejected; Start move disabled | `05-wrong-identity-en.png` |
| Verify upper + lower, confirm placement | P-000019 stored on P-000018 at POS-000014 | `07-stack-confirmed-en.png` |
| Lower support lock | Move locked; upper link shown | `06-support-locked-en.png` |
| Move upper back to floor | Completed to POS-000015, X 1.2/Y 1.2/Z 0; lower Move/Stack links restored | `08-support-unlocked-en.png` |
| Thai mobile | Automatic Z, invalid overhang, disabled action; document width 390, no horizontal page overflow | `09-mobile-th-full.png`, `10-mobile-th-stack.png`, `11-mobile-th-overhang.png` |
| English mobile | Language switch preserves route; editor works | `12-mobile-en-stack.png` |
| Thai desktop | Valid and invalid 3D previews | `13-desktop-th-stack.png`, `14-desktop-th-overhang.png` |
| BOX ordinary storage | Overlapping a pallet stays at Z 0 and is rejected, does not auto-stack | `15-box-remains-floor-th.png` |

P-000018 ends at its original floor location, unlocked. P-000019 ends on the floor at its original coordinates, with a new audited placement POS-000015. Each still contains 50 pieces; no units were created or retired by these moves. P-000021 was previewed only and remains unplaced.

## Evidence limitations

- Mobile checks use a browser viewport and UI controls, not physical touchscreen hardware. Actual pointer dragging was verified on desktop; physical touch gestures and camera QR scanning were not exercised. Manual code verification, wrong-code handling, and automated QR rules were exercised.
- `automatic-stacking-demo.mp4` is a short **2.63-second real browser capture**, 10 captured frames, encoded H.264; it shows the 3D preview interaction, not the entire end-to-end movement. Full movement evidence is in the screenshots and results above. Raw frames and timestamps are retained in `recording/` and `drag-recording.json`.
- Captured error-level browser console log is empty (`console-errors.json`). This is evidence for the observed QA session, not a guarantee about every deployment/browser.

## Review files

`ported-changes.patch` compares the selected destination snapshot against the resulting files; `after-hashes.json` records those files. Auxiliary test changes outside the selected snapshot are described above. Existing batch and unrelated worktree changes are retained.
