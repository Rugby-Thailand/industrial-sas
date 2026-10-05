# Storage Planner: canvas first workspace

Implements the approved first UI option. Map is the default. Icon controls choose
Map, Table or Split on a wide workspace; narrow workspaces expose Map/Table.
The `panel` query parameter is separate from the existing building `view`,
`floor` and edit-state parameters. Split temporarily falls back to Map when
space is insufficient, preserving the requested URL for a wider screen.

Floor navigation sits inside the canvas as a collapsible floating control and
remains available in Table view. Details appear only after selection. Hiding
Details retains selection. Narrow workspaces use the existing modal sheet and
editor/focus-return flow. Table pagination and sorting remain mounted across
panel changes. The table body scrolls separately, with a sticky header; Split
shows the code and principal inventory counts. Full Table retains all fields.
Search and status filters apply to both panels.

## Refactor and performance

- Separate scene rendering, geometry helpers, camera interaction, viewport
  measurement, view controls and floor navigation. The scene accepts only its
  geometry and interaction inputs, rather than workspace/editor slots.
- Cache pallet geometry, imported group bounds and floor summaries. Build
  imported groups in one pass. Memoize the scene and table with stable selection
  callbacks; Table view does not mount the SVG scene.
- Pointer moves update the camera transform through requestAnimationFrame.
  React receives the final camera once on release/cancellation. Pending frames
  are flushed on release, canceled on unmount, and a drag does not select the
  location beneath its release point.
- Fit uses the actual drawing bounds. Workspace width determines Split and
  inspector availability, including space consumed by application navigation.

A development React Profiler measurement used 198 empty approved PD positions,
960 SVG descendants, 150% zoom and 50 synthetic pointer moves:

| Measurement                          |   Before | After |
| ------------------------------------ | -------: | ----: |
| React update commits during one drag |       50 |     1 |
| Sum of React render work             | 1,934 ms | 27 ms |

The baseline moved once per animation frame; the optimized run used 50 separate
browser tasks because background preview tabs throttle animation frames. The
canvas also changed its fit calculation. These timings describe observed React
work, not a controlled production latency, frame-rate or INP measurement. The
commit reduction is additionally verified by deterministic camera tests.

## Verification

- Full Vitest suite: 1,063 tests passed; focused storage workspace suite: 188.
- TypeScript, ESLint, formatting and `next build --webpack` passed.
- Real component browser checks: sticky header, page navigation, selected row
  to Map, hide/reopen Details, status/search/empty results, themes, 2D/3D,
  mobile sheet/Escape and changing floors.
- Responsive checks: 320, 768, 880, 1024, 1440 and 1920 CSS pixels. No page
  horizontal overflow; 880 px additionally verifies the container-width
  inspector threshold. Axe checks run on Table/selected Details.

Run the component preview and recordings using
[scripts/storage-workspace-preview/README.md](../../scripts/storage-workspace-preview/README.md).
It renders production components with isolated demo inventory. Authenticated
routes, live backend data, write permissions and production hardware latency
were not exercised. No backend schema or mutation behavior changed.
