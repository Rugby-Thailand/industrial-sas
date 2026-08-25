# Visual mezzanine building plan

## Outcome

Show a smaller upper floor beside a tall open ground-floor area. This is only a
visual improvement; storage calculations and saved layout data stay unchanged.

## Decision

- Keep the existing SVG renderer and current schema.
- Use the ground-floor footprint and `totalHeightMm` as one transparent building
  shell.
- Draw upper floors as thin internal plates at their current cumulative heights.
- Use each upper floor's existing width, depth, and offset to show where the
  mezzanine ends and the full-height open area begins.
- Do not add shell sections, roof profiles, migrations, or Three.js.

## Implementation

1. Update `buildIsometricBuilding` to return one outer shell and separate floor
   plates instead of rendering every floor as a solid box.
2. Render the shell as a cutaway/wireframe so the mezzanine and open high-bay
   side remain visible.
3. Keep the existing floor editor and all area, height, zone, and capacity rules.
4. Test a full-size ground floor with a smaller offset Floor 2 and verify that
   totals are unchanged.

## Done when

The preview clearly shows a partial mezzanine and a taller open side using only
the building and floor data already stored.
