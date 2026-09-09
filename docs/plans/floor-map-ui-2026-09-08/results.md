# Floor map implementation results

## Shipped
- New full-width floor map, thin slab, physical tan pallet volumes and outlined location footprints.
- Selected-location height envelope, true saved unit coordinates, dashed reservation/move-hold rendering and collision-aware callout labels.
- Search by location name/code, position code or pallet; unmatched geometry remains visible and dimmed. Location chips provide full-name keyboard/touch access when callout space is limited.
- 2D/3D switch, quarter-turn camera rotation, zoom, fit, previous-floor reference toggle.
- Inspector on the right at 900px and above, below the map on mobile: dimensions, height limit, QR, stored-unit details, view/move actions.
- Explicit pencil action opens the existing location editor with its validation, locks and save behavior. Floor offset editing is a separate explicit mode, retaining previous drag/keyboard behavior.
- Existing card UI, business rules and backend state preserved. No new weight rules.

## Tests and manual inspection
- pnpm check: typecheck, lint and 683 tests across65 test files (including five new map interaction tests).
- Production build uses isolated .cache/floor-map-build to avoid disrupting dev server3100.
- Live Thai: select FG-1, show/hide QR, zoom/fit, switch2D/3D, open edit, enter X99m, see red invalid preview and disabled confirmation, Cancel, inspect unchanged X0.2/Y0.3/Z0 pallet coordinates.
- Mobile effective CSS viewport390×844: no horizontal overflow. Search P-000003 selects FG-1; English search by code selects empty Z02. Inspector renders below the map.
- English/Thai locale navigation and refresh checked. No runtime error overlay after refresh; transient HMR missing-message warning cleared after messages reloaded.
- Search/selection/camera interactions never mutate quantities or positions. Browser verification did not save test changes to user data.

## Evidence
Stored in artifacts/storage-spots-ui-2026-09-08:
- map-desktop-th.jpg: actual implemented3D UI.
- map-desktop-2d.jpg: actual2D UI.
- map-invalid-edit.jpg: validation refusal.
- map-mobile-th.jpg and map-mobile-en.jpg: mobile inspection captures; in-app screenshot export has excess blank canvas at viewport overrides, so the CSS viewport/overflow checks are recorded separately above.
- floor-map-check.log and floor-map-build.log: full check outputs.

## Limits
The mockup is a design direction, not scale geometry. Actual locations stay at saved positions. In crowded scenes labels that cannot fit are omitted from the canvas; all matching locations remain accessible in the scrollable name list, and selection prioritizes its callout. Camera controls do not edit geometry. Physical device testing was not performed; mobile checks use browser viewport emulation.
