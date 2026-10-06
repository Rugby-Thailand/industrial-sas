# Storage Planner: compact workspace A

Implements the user-approved [compact design A](../plans/storage-compact-workspace.md).
Map remains the default. Icon controls choose Map, Table or Split on wide
workspaces; narrow workspaces expose Map/Table. The `panel` query parameter is
separate from the existing building `view`, `floor` and edit-state parameters.
Split temporarily falls back to Map when space is insufficient, preserving the
requested URL for a wider screen.

The toolbar uses one desktop row and two mobile rows. Floor navigation is a
small floating control inside the canvas and moves into the toolbar in Table.
Floor options show compact metadata rather than thumbnail cards. Search has
one clear action; secondary creation tools remain under More actions. Mobile
sorting uses a small menu and desktop sorting stays in column headers.

Table follows its data height, capped for long results, with pagination directly
after the scroll body. Mobile rows show code, distinct name, dimensions, status
and units in about 54px. Desktop retains inventory counts and hides a name column
only when every filtered name equals its code. Selected rows expand real
inventory/editor details inline. Map/Split retain the inspector or narrow sheet.
Table pagination/sorting stay mounted across view changes; search and status
filters apply to both panels. Existing floor/editor guards remain authoritative.

## Refactor and performance

- Separate scene rendering, geometry helpers, camera interaction, viewport
  measurement, view controls and floor navigation. The scene accepts only its
  geometry and interaction inputs, rather than workspace/editor slots.
- Cache pallet geometry, imported group bounds and floor summaries. Build
  imported groups in one pass. Memoize the scene and table with stable selection
  callbacks; Table view does not mount the SVG scene. Compact row presentation
  reuses the same search/sort/pagination model instead of duplicating it.
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

Real-component checks cover compact single/empty/many results, sticky headers,
page navigation, selected row to Map, hide/reopen Details, filters/search,
themes, 2D/3D, inline mobile details and floor changes. Integration regressions
exercise the existing editor from inline details, retained selection after
cancel, unsaved floor transitions and navigation guards.

Run the component preview and recordings using
[scripts/storage-workspace-preview/README.md](../../scripts/storage-workspace-preview/README.md).
It renders production components with isolated demo inventory. Authenticated
routes, live backend data, write permissions and production hardware latency
are separate integration checks. No backend schema or mutation behavior changed.
