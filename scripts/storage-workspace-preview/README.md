# Storage workspace verification

Run `pnpm preview:storage-workspace`, then open <http://127.0.0.1:3190>.
This development-only Vite harness renders the production `FloorMap`, table and
floor selector with the app's styles, translations and providers. It does not
start Convex, use authentication, or write inventory. Floor 2 uses the approved
PD geometry with 198 positions; two demo pallets exercise stored/reserved
filters. Floor 1 uses the existing four-location demo. `?fixture=empty` removes
PD demo inventory for profiling.

With the server running, run
`node scripts/storage-workspace-preview/verify.mjs` to assert the desktop and
mobile workflows and record WebM videos/screenshots in ignored
`output/workspace-qa`. Playwright Chromium must be installed. The script checks
view switching, sticky headers, paging, selection, shared search/status filters,
empty results, 2D/3D, themes, mobile details and floor changes. The React Profiler
is available as `window.__storageWorkspaceProfile` in this harness only.

This verifies real UI components with isolated fixtures. Authenticated routes,
live data, permission-dependent mutations and production performance need a
separate integration check.

The approved compact A regression checks are also repeatable:

- `node scripts/storage-workspace-preview/responsive.mjs` checks 16 combinations
  of 320/390/768/1440px, Thai/English and light/dark, including single-result
  height, pagination, inline details, floor changes, overflow and axe.
- `node scripts/storage-workspace-preview/camera.mjs` checks the physical camera
  center across Map/Split/Table, and verifies one React update for a 50-move drag.

`?locale=th` switches component translations. Browser artifacts use isolated
fixtures; the unit/integration suites separately exercise the editor controllers
and navigation guards with mocked backend calls.

The optional `?fixture=f1-f2&locale=th` preview reads
`output/workspace-qa/f1-f2-fixture.json` when Vite starts. This ignored file is an
array of `FloorMapProps`, containing only presentation geometry, location codes
and empty inventory. Without the file the harness keeps its usual PD fixture.
The 2026-10-08 screenshots use the local F1/F2 readback geometry, with the floor
boundary and floor height matched to the supplied screenshot (60 × 13 × 3.2 m).
This does not modify the saved building or inventory.

`?fixture=portrait` keeps those scene contents inside a 120 m deep preview floor
to check fitted-floor containment when a narrow footer wraps. It uses the usual
demo layouts if the optional F1/F2 geometry file is absent.

Canvas space checks in this thread use the T3 collaborative preview and its native
PNG/MP4 capture. They cover viewport containment, responsive camera targets,
theme contrast, mobile details and the physical camera center across panels.
Drag demonstrations dispatch pointer events to the real SVG handlers; pointer
capture and drag-click suppression are separately covered by the pan unit tests.
