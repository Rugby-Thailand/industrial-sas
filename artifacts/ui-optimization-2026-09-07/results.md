# UI optimization — 7 September 2026

Implemented in `codex/storage-planner` at `/Users/macbook/Development/industrial-sas-storage-planner`. App and its existing local backend are running on ports **3100 / 3320**. The app was initially stopped, so the existing combined `pnpm dev` runner was started.

## What improved

- **Searchable storage locations:** filter by building, location, floor number or rack name/code, with result count and one-click clear. Empty search results explain that the current preview is retained. Filtering does not alter the selected position or incorrectly relabel an alternative as the recommended result.
- **Shorter location list:** desktop options scroll in a bounded 512 px region; mobile retains a horizontal options strip. Both are keyboard-accessible with visible focus.
- **More compact screens:** reduced shared FG heading spacing and summary padding. Removed the redundant outer frame around the placement scene and tightened the coordinate panel. The scene starts approximately 72 px higher in the observed desktop comparison. The complete recommendation page with 15 locations measured 1,034 px high at the tested 1,728 px width.
- **Viewer zoom:** labelled Zoom in/out from 100% to 250%, visible scale, and Reset returning to 100% / original camera / 3D. Slightly smaller camera padding makes the initial scene larger. Zoom is visual only; pointer mapping still uses the SVG screen transform and physical coordinates remain unchanged.
- **Better viewer controls:** compact familiar camera icons with tooltips and accessible names, responsive grouping and larger 2D/3D controls. Actual mobile buttons measured **48 px** tall.

Changes are in `PalletScreens.tsx`, `shared.tsx`, `PalletScene.tsx` and their behavioural tests. No backend, quantity, packing, weight or reservation rule was changed.

## Verification

- Focused screen/scene/catalogue/accessibility run: **122 tests / 4 files passed**.
- Final regression run `pnpm test --maxWorkers=2`: **579 tests / 62 files passed** (`tests.log`).
- Typecheck and ESLint passed (`quality.log`).
- Production build passed using separate `.next-build` output (`build.log`).
- `git diff --check` passed.
- Added coverage for location/building/rack search, selection preservation, correct recommendation badges, empty-search recovery, bounded zoom/reset, transformed pointer drag and stable zoomed stacking camera.
- Browser tested Thai/English desktop and 390 × 844 mobile viewport, search → select → clear/no match → recover, zoom in/out/reset, 2D/3D, keyboard movement, invalid X disabling confirmation, and review dialog/back navigation.
- Mobile document width = viewport width = **390 px**; no horizontal page overflow. Viewer controls measured **48 px** tall.
- Captured error-level console log is empty (`console-errors.json`).

Used existing QA BOX **P-000021**, quantity 50, dimensions 0.4 × 0.3 × 0.2 m. This round previewed and reviewed only; no reservation, physical placement, product quantity or batch was changed. All existing stacking/batch/identity tests remain passing.

## Evidence

- `before-desktop.png`: original spacing and long location list.
- `after-desktop-th.png`, `result-desktop-en.png`: optimized full desktop page.
- `after-mobile-th.png`: mobile viewer controls.
- `mobile-review-th.png`, `mobile-review-en.png`: bilingual mobile review.
- `after-default-desktop-en.png`: unfiltered default view.
- `ui-demo.mp4`: approximately 8-second real browser capture of search → select → zoom → 2D → reset → review; raw frames and timestamps in `recording/` and `recording.json`.

## Limits

Mobile verification used a responsive viewport, not physical touch hardware or a camera scanner. Zoom crops the view at higher scales; Reset restores the full scene. This remains an isometric placement diagram with highlighted proposed objects, not a photorealistic renderer. No performance benchmark or universal accessibility certification is claimed. Existing graph metadata was used only for navigation; its CLI/skill mismatch and old node IDs were not relied upon for correctness.
