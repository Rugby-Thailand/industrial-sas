# Consistent page back navigation

Implemented in `codex/storage-planner`.

- Added shared `PageBackLink`: compact left arrow, muted text, visible keyboard focus.
- Storage building/new/floor/review pages render it above the title through `PageHeader`.
- Finished-goods headings use the same component. Packing, measurement, storage recommendation and move pages retain their appropriate parent destinations.
- Removed duplicate page-back buttons from sidebars and footers. Dialog actions that return to editing remain inside their dialogs.
- Preserved save/confirm/cancel operations. Kept footer actions aligned to the right after removing duplicate navigation.
- Fixed mobile storage grid sizing exposed during verification.

Browser verification: building → review → building; building → floor → building at 390px; batch editor → product details. Screenshots saved as `building-desktop.png` and `floor-mobile.png`. Browser viewport reset afterward. No warehouse records modified.

Validation: typecheck, lint, 461 existing tests, production build. Logs saved alongside this note. Page-header tests now mock locale-aware routing, matching other component tests.
