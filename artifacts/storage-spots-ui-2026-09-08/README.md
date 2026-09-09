# Storage spots UI improvement — 2026-09-08

Branch: codex/storage-planner. App: http://localhost:3100.

## Implemented
- Search names, location codes, QR payloads, exact-position codes and pallet numbers; normalize case, Unicode and whitespace.
- Clear action, result counts, separate empty-floor and no-match states.
- Compact cards: name first, fixed 96px square QR with white padding, accessible edit/archive icons.
- Remove duplicate default QR; retain distinct position labels in an expandable section.
- Keep pallet links, occupancy, reservation/move statuses, coordinates and existing mutation rules.
- Compact Quick Change hint and responsive Add action.
- Search Enter cannot submit the enclosing floor form; zone hash navigation clears a hiding filter.

## Verification
- pnpm check: typecheck, lint and all 675 tests pass (65 files). See check.log.
- Live authenticated UI: pallet search selects FG-1; nonexistent term shows no results; clear restores both locations; edit FG-1 opens existing editor; cancel returns without writing.
- Live mobile: Thai name and English location-code search select the expected location. Effective CSS viewport 390×844 (browser zoom compensated), document width 390: no horizontal overflow.
- Desktop: effective width1600, document width1600. Both primary QR wrappers measured 96×96.
- Thai/English locale navigation and anchored refresh checked. Temporary viewport override restored.
- Existing data was not modified in browser verification.

## Evidence
- design-concept.png: generated design direction, NOT a screenshot of the app.
- desktop-th.jpg: actual updated app.
- mobile-th.jpg / mobile-en.jpg: responsive inspection captures. The in-app browser screenshot exporter scales these with excess blank canvas; DOM measurements and live inspection verified the 390px layout, but these are not clean mobile presentation images.
- search-pallet.jpg / empty-search.jpg / edit-location.jpg: interaction evidence.
- before.jpg: original app; before.tsx.txt: source snapshot before this task.
- build.log: isolated production build passed. Temporary generated tsconfig includes removed afterwards.

Image generation was used for design exploration; the actual UI is implemented in React and CSS with real QR codes.

## Follow-up: transparent edit and pallet shortcuts
- Edit icon uses transparent background, outline border and transparent hover. Live computed background rgba(0,0,0,0).
- Added outlined view and move shortcuts with translated accessible names/tooltips. Move is offered for stored units or to continue an active move; view-only users retain the view shortcut.
- Live clicks verified P-000003 details and the existing move destination screen, then returned to the floor without reserving or changing storage.
- At the user’s 986px viewport, document width remains986px; actions fit their pallet row.
- pnpm check passed: typecheck, lint, 678 tests across65 files. See quick-actions-check.log and quick-actions.jpg.
