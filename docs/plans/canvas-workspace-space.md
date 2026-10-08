# Storage canvas space and refactor

Review base: `88f5aa61dfb4fa20b5c158058eecffae38350d46` (`main`).
Source: the user supplied an F1/F2 floor screenshot, requested implementation,
screenshots and zoom/drag video, then requested fixes, a code/performance audit,
refactoring and merge.

- In 2D Map, size the canvas to the floor footprint within viewport bounds;
  preserve physical proportions and keep the complete floor visible at Fit.
- Combine floor selection, dimensions, search/view controls and camera controls
  in one compact desktop toolbar. On small screens retain accessible controls.
- Keep floor identity, zoom, legend and position summary legible without
  overlapping the fitted floor. Mobile camera targets are at least 44 × 44 px.
- Preserve selection, actual inventory/edit actions, keyboard access, panel
  navigation and the physical camera center across Map/Table/Split.
- Preserve the bounded 3D/Split workspace and existing zoom/rotation behavior.
- Refactor the changed code for clearer ownership and remove superseded CSS;
  audit measured rendering behavior rather than claim unmeasured speedups.
- No backend schemas, saved dimensions, location geometry, inventory or unrelated
  pending work changes. Optional local preview fixtures are presentation-only.
- Validate Thai/English, light/dark, narrow/wide viewports, details, zoom, pan,
  Fit, rotation, relevant regressions, repository checks and production build.
- Run separate Standards and Spec reviews; resolve actionable findings, create
  a PR, wait for required checks, and merge the reviewed change.
