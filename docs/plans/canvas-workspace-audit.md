# Canvas workspace audit — 2026-10-08

Scope: `88f5aa6` through `60703e0`, following
[the canvas requirements](./canvas-workspace-space.md). The implementation and
refactor were isolated from unrelated pending work.

## Standards

Independent final review passed at `60703e0`, with no actionable findings.
Resolved findings:

- Desktop camera controls are 36px; mobile controls remain 44px.
- Changed metadata follows 12px/16px typography, including narrow screens.
- Removed orphaned toolbar styles and consolidated overridden canvas/SVG rules.
- `floorPlanBounds` gives adaptive height and plan Fit the same reference bounds,
  including negative offsets.
- Measured footer clearance applies to ordinary plans with labels, dense plans,
  and 3D; the earlier label-only branch could overlap wrapping metadata.

## Spec

Independent final review passed at `60703e0`, with no actionable findings.
Resolved findings:

- Committed pan coordinates are not reclamped when switching panels.
- Before a pan, a zoomed camera targets a physical scene or selected-location
  point, keeping its center stable across Map/Split/Table.
- Fit reserves the actual footer height; portrait floors retain clearance when
  translated metadata wraps. Browser verification found an 8px floor/footer gap.
- Floor dimensions, including height, remain visible on narrow screens.

The review checked low zoom both before and after a boundary drag, and portrait
containment at narrow/wide widths. Production inventory and saved geometry are
not modified by preview fixtures.

## Code ownership and performance

`useFloorMapCamera` owns camera state and transitions. `FloorMapCameraControls`
owns its controls and display disclosure; the workspace retains domain-specific
legend content. The drawing owns measurement of its SVG and footer. Footer JSX
is memoized so unrelated detail-panel state does not invalidate the memoized
scene. Resize notifications with identical dimensions reuse the previous state;
same-aspect size changes are still measured because fit padding uses screen pixels.

The existing pan path writes one SVG transform per animation frame and commits
React state at drag end. The regression suite verifies coalescing, cancellation,
pointer identity, cleanup, and drag-click suppression. Repeated identical resize
notifications produce no profiler commits after React's initial state bailout.

A 157-location empty F1/F2 development fixture initially measured 15 zoom updates
with a 28.1ms median React render and one update for a 50-move drag. Subsequent
preview profiling had large session-to-session variance and automation timing
failures; those samples do not establish a speedup or a production latency result.
No quantitative performance improvement is claimed. The deliberate optimization
is eliminating redundant resize state updates while preserving the pan path.

## Validation

- `pnpm check`: typecheck, zero-warning repository lint, 132 test files and
  1,103 tests passed.
- `pnpm build`: optimized Next.js production build passed.
- `pnpm audit:prod`: no known vulnerabilities.
- New regressions cover labels on/off, portrait footer containment, inferred and
  committed camera centers across viewport changes, observer cleanup, identical
  versus proportional resizes, and reference bounds with both offset signs.
- Native collaborative-browser verification uses the real production components
  and isolated geometry. It does not exercise authenticated backend mutations.
