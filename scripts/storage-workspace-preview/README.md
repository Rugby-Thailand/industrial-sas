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
