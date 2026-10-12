# Initial picker browser check

2026-10-13, T3 collaborative preview, real in-progress LocationPicker component from the isolated locations worktree. Synthetic query transport with 121 locations/3 buildings, 180ms list delay and 80ms resolver delay. These are interaction checks, not hosted performance measurements.

- Blank input requested searchPage with pageSize20 and rendered20 rows.
- Next requested cursor20 and rendered rows21–40.
- Icon-only building selector independently requested buildingOptions.
- Escape closed the popover and restored focus to Filter by building.
- Choosing building2 reset the location request to page1 with buildingId; entering F1-L30-16 retained that filter and showed the outside-building explanation without an Add prompt.
- With catalogue transport deliberately held in scanning, F1-L30-16 appeared as an enabled exact choice; it was not automatically selected. Progress remained explicit.
- No desktop horizontal overflow.
- Finding: filter trigger measured36×36px on desktop; requested44px correction from Kiro.

Preview DOM inspection and interactions worked. Screenshot calls repeatedly failed, then the T3 desktop automation host disconnected during a mobile resize; no screenshot or mobile result is claimed. Final integrated checks remain required.
