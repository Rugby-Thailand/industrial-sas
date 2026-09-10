# Compact scene controls — 2026-09-10

## Delivered
- Shared scene toolbar used by pallet scenes (measurement, storage, movement, stacking and detail) and the interactive floor map.
- Single visible 2D / 3D selector across pallet, floor, floor-offset and area preview scenes. Localized full names remain as accessible labels and native tooltips.
- Pallet title, mode and camera controls share one desktop header. Secondary tools move into a keyboard-accessible popover under 540 px scene width.
- Very narrow scenes give the title its own small line and allow controls to wrap. Direct pallet rotation remains available during placement.
- Area preview header padding reduced; form/data/geometry logic unchanged.

## Validation
- Isolated staged snapshot: 67 test files / 704 tests passed; TypeScript and changed-file ESLint passed.
- Combined workspace before concurrent camera refactoring: 69 files / 712 tests passed.
- Browser: Thai pallet 2D/3D switching, zoom (100 → 125%), reset, mobile secondary rotate (90°), Escape dismissal.
- Browser: desktop Thai floor switch, zoom, fit; area dialog switch and cancel without saving; English floor labels and mobile menu.
- CSS viewport 390 px: no document horizontal overflow. Desktop pallet header measured approximately 54 px including browser scaling, replacing separate heading and toolbar rows.
- Mobile viewport emulation rendered screenshots at an inconsistent scale; mobile layout checks used DOM dimensions and actual control actions.
- No inventory or storage records were modified by these checks.

## Scope of commit
Only the compact toolbar changes are committed. Existing area editing and QR-text work stays uncommitted. A concurrent task began a separate SceneCameraControls refactor during verification; that work is deliberately excluded. The staged snapshot was tested independently so it does not depend on those new files or translations.

Desktop preview: ../../../artifacts/compact-scene-toolbar-2026-09-10/pallet-desktop.png
