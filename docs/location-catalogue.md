# Location catalogue

The building catalogue now offers building cards and a warehouse-wide location table. Search and status controls sit directly on the page without an outer background panel.

The table includes location name/code, building/floor, dimensions, effective status, QR preview and direct floor navigation. Expand a location to see configured sublocations and actual reserved/stored pallet coordinates. Sublocation X/Y coordinates use the floor origin; pallet X/Y coordinates use the location origin. Archived locations remain visible in the table. Edit links appear only for users with storage-layout management permission and open the corresponding location editor.

View, search, building, floor and status preferences persist per warehouse on the device. Empty and failed reads remain distinct; empty filtered results keep their filters and a clear action. Narrow screens keep the table in its own horizontal scroll region.

Validation on 2026-09-06: `pnpm check` passed TypeScript, ESLint and 384 tests across 51 files. New tests cover search, status/building filtering, persistence, read-only actions, QR, coordinates, accessibility, empty/error states, a catalogue with 53 locations and cross-tenant/warehouse/authentication refusal. Live browser checks confirmed all seven current warehouse locations, persisted table/search after reload, QR preview and the correct FG-1 editor; no browser console errors were captured.

Screenshots and check log: `artifacts/location-catalogue-2026-09-06/` (local evidence, not included in the feature commit).

The commit is scoped to this request. Existing storage-planner extraction and finished-goods work remain separate working-tree changes.
