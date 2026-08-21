# ADR-0014 — Storage building layout rendering

- ID: `ADR-0014`
- Status: **Accepted**
- Date: 2026-08-21
- Decision baseline: [storage planner requirements](../product/storage-building-planner/requirements.md) and [implementation specification](../product/storage-building-planner/implementation-spec.md)
- Implementation status: **Implemented**

## Context

The storage planner must communicate a multi-floor building at a glance while
also supporting exact edits to each floor. The existing reporting decision in
ADR-0011 excludes Three.js from the MVP because its bundle and accessibility
costs are not justified. A storage building still benefits from depth cues, but
operators must never depend on perspective to understand or edit capacity.

## Decision

1. The building overview is an isometric projection rendered as semantic SVG.
2. The floor editor is a top-down SVG plan paired with labelled numeric inputs.
3. Projection is pure geometry under `src/lib/storageLayouts`; stored dimensions
   remain integer millimetres and square millimetres.
4. Three.js, WebGL, free camera controls, and mesh editing remain out of scope.
5. Colour is reinforced by labels, borders, status text, and table summaries.

## Invariants

### Code-owned guarantees

- `INV-0014-01` The visual projection never becomes the source of stored geometry.
- `INV-0014-02` Every editable dimension has a labelled numeric control.
- `INV-0014-03` The renderer consumes validated floor summaries and performs no
  capacity arithmetic.
- `INV-0014-04` Reserved blocks render in plan coordinates and are validated for
  bounds and overlap before persistence.

### Operational assumptions

- Operators use the isometric view for orientation and the plan view for exact
  placement.
- The browser supports SVG, which is part of the supported web baseline.

## Consequences

- The product gets a clear 3D-style building view without a WebGL dependency.
- SVG stays zoomable, testable, themeable, and available to assistive technology.
- Arbitrary rotation, perspective editing, and photorealistic rendering are not
  provided.

## Rejected alternatives

- **Three.js/WebGL:** unnecessary bundle, interaction, and accessibility cost.
- **CSS-only perspective cards:** difficult to test and unable to share geometry
  with the plan renderer.
- **Image-only mockups:** attractive but not data-driven or interactive.

## Verification

- Unit tests cover isometric projection, slab ordering, and domain calculations.
- Type checking proves the renderer receives explicit millimetre dimensions.
- Page-level accessibility checks cover SVG labels and numeric form labels.

## Release gates

No new external release gate is introduced. Existing accessibility, tenant
isolation, schema-policy, and performance gates apply.

## References

- [ADR-0011](./0011-async-jobs-reporting-and-observability.md)
- [Storage planner implementation specification](../product/storage-building-planner/implementation-spec.md)
