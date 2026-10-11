# Layout variant previews

Working previews of Kiro's two composition proposals in
[`../kiro-variants.md`](../kiro-variants.md), completed on 2026-10-10
(Asia/Bangkok). The baseline design sheet remains the reference. These are
comparison artefacts, not an approved replacement or application implementation.

## URLs

With the existing static server for `docs/design-sheet`:

- Side Rail: <http://localhost:3211/variants/?variant=side-rail#workspace>
- Margin Labels: <http://localhost:3211/variants/?variant=margin-labels#workspace>
- Baseline: <http://localhost:3211/#workspace>

A missing or unknown `variant` is normalised to `side-rail` with
`history.replaceState`. The Side Rail and Margin Labels buttons above the
workspace use `pushState`, so Back and Forward switch variants. The hash is kept.

## Implementation

- `index.html` is a copy of `../index.html` with `../` resource paths, the
  chooser and a baseline link. It loads `../tokens.css`, `../styles.css` and
  `../sheet.js`, followed by `variants.css` and `variants.js`.
- `variants.js` wraps the global `renderWorkflow` from `sheet.js`. Every tab
  switch, language switch and sample action re-renders through the wrapper. After
  the baseline markup renders, it moves the existing content nodes into new
  layout containers inside `#workflow-panel`. IDs, sample state, translations and
  delegated events from `sheet.js` are reused.
- `variants.css` targets only `#workflow-panel[data-variant]` and the chooser.
  Base rules define the stacked phone layout. The side-by-side layouts apply
  only above 800px and when the panel is wide enough (container query: 640px for
  Side Rail, 520px for Margin Labels).
- Both variants hide the location pin and repeat the location code in the Save
  scope. All two required and seven optional scan fields, the review advisory,
  and the "sample" and "no records written" messages are preserved.

| Workflow  | Side Rail (200px rail, 24px gap)                                 | Margin Labels (112px margin, 16px gap)                             |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Job scan  | Rail: Location, Capture. Main: advisory, ticket, Save            | Location, Capture, Ticket 1 bands; Save at end                     |
| Catalogue | Rail: totals list, filter. Main: search, table, pages            | Totals and Find bands; table full width                            |
| Floor     | Rail: floor summary, legend, inspector. Main: map                | Floor summary band; existing map and adjacent inspector full width |
| My day    | Rail: date, planned shift, site, policy. Main: clocks and action | Recorded, Planned and Policy bands                                 |

On the Side Rail floor plan, the map comes before the rail in the DOM. CSS
places the rail on the left on desktop, so phones show the map first and the
inspector below it. As a result, desktop keyboard order reaches the map before
the inspector.

## Inherited system and comparison

Both previews load the accepted sheet's tokens and styles. They retain compact
36px desktop controls and 48px touch controls at 800px and below, 2px gaps between
field labels and inputs, 8px field gaps, the 16px/24px task rhythm, stronger status
inks with text and icons, and the restrained 2px focus outline. Geist, Noto Sans
Thai and Geist Mono, both themes, control edges and shared task surfaces are
inherited from the baseline. Variant section labels use its 12px/16px operating
scale at medium weight; variant groups use 24px gaps and related content uses
8px gaps.

Side Rail collects context into one unboxed region and reduces horizontal
context rows. Compared with the baseline, it spends 224px on rail and gap,
narrows the ticket and catalogue work, and separates planned attendance from
recorded times. Margin Labels removes heading rows while preserving a linear
sequence, spending 128px on label margin and gap for form bands while leaving
tables and the floor layout full width. Its tradeoffs are label wrapping and the
alignment of margin bands with full-width regions.

At 800px and below, Side Rail stacks context before work (map before inspector
for Floor); Margin Labels places each label 8px above its section. Save fills
the width in both. Above 800px, each arrangement also requires enough panel
width: 640px for Side Rail and 520px for Margin Labels. A narrow desktop panel
therefore keeps the stacked arrangement rather than squeezing the fields.

The selected chooser uses an outlined, underlined treatment and has a localized
description of the current composition. It remains visually secondary to the
workflow's primary action. These preview-only additions do not create new
canonical tokens or rules in [`../DESIGN.md`](../DESIGN.md) or its sidecar.

Kiro's original advisory recommendation favoured Margin Labels for the request
for quieter composition. The implementation makes both options available for
comparison; it does not adopt that recommendation. A fresh comparison review
passed all five sections with no material fixes and a disposition to ship at
prototype comparison scope. This verdict does not approve an application
migration. Detailed findings are recorded in
[`evidence/review.md`](evidence/review.md).

## Provenance

Both proposals were written by Kiro CLI (`claude-opus-5.5`, high effort) on
2026-10-09 as advisory suggestions. Kiro CLI, using the same model and effort,
built the working previews from that document and the baseline sheet; the build
completed on 2026-10-10 (Asia/Bangkok). The proposal document is preserved as the
original advisory record, including its pre-implementation caveats.

After Kiro's implementation, Codex made the selected chooser lighter and added
the localized composition description, then performed native browser validation
and captured evidence. Baseline `index.html`, `styles.css`, `tokens.css` and
`sheet.js`, the incumbent `DESIGN.md` and its sidecar were not changed for this
extension.

## Verification and evidence

Kiro's JavaScript syntax, ESLint, Prettier and jsdom smoke checks passed. Native
browser results are recorded in
[`evidence/browser-checks.json`](evidence/browser-checks.json):

- 160 combinations: five viewport widths (390, 768, 1159, 1280 and 1440px), two
  variants, English/Thai, light/dark, and four workflows. The checks found no
  horizontal page overflow, duplicate IDs or axe issues under WCAG 2 A/AA,
  WCAG 2.1 AA and WCAG 2.2 AA tags.
- All 17 native browser action checks passed: draft preservation and AI-origin
  clearing, required-field validation and focus, synthetic save, catalogue
  filtering and search preservation, keyboard map selection, clock-out, browser
  Back and workflow arrow navigation.
- 16 PNG viewport crops document both variants: four desktop workflows in
  English/light, Floor in English/dark, and the chooser plus scan context and
  fields at 390px in Thai/dark. Desktop crops were captured at 1159px. These
  captures support the visual review; automated checks alone are not a visual
  acceptance verdict.

| Capture                       | Side Rail                                                     | Margin Labels                                                     |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Job scan, English/light       | [Preview](evidence/side-rail-scan-en-light.png)               | [Preview](evidence/margin-labels-scan-en-light.png)               |
| Catalogue, English/light      | [Preview](evidence/side-rail-catalogue-en-light.png)          | [Preview](evidence/margin-labels-catalogue-en-light.png)          |
| Floor, English/light          | [Preview](evidence/side-rail-floor-en-light.png)              | [Preview](evidence/margin-labels-floor-en-light.png)              |
| My day, English/light         | [Preview](evidence/side-rail-hr-en-light.png)                 | [Preview](evidence/margin-labels-hr-en-light.png)                 |
| Floor, English/dark           | [Preview](evidence/side-rail-floor-en-dark.png)               | [Preview](evidence/margin-labels-floor-en-dark.png)               |
| Phone chooser, Thai/dark      | [Preview](evidence/side-rail-chooser-th-dark-mobile.png)      | [Preview](evidence/margin-labels-chooser-th-dark-mobile.png)      |
| Phone scan context, Thai/dark | [Preview](evidence/side-rail-scan-th-dark-mobile-context.png) | [Preview](evidence/margin-labels-scan-th-dark-mobile-context.png) |
| Phone scan fields, Thai/dark  | [Preview](evidence/side-rail-scan-th-dark-mobile-fields.png)  | [Preview](evidence/margin-labels-scan-th-dark-mobile-fields.png)  |

## Limitations

- The baseline floor specimen has no floor selector or 2D/3D toggle. The Floor
  band and rail therefore hold the existing floor summary (and legend in Side
  Rail) instead of inventing controls.
- Copy for the new labels and chooser is local to `variants.js`. The Thai
  strings are draft translations.
- Workflows use synthetic local state. There is no live camera capture,
  barcode scanning, warehouse data mutation or authorization integration.
- Print/PDF pagination has not been visually checked.
- The incumbent design notes already distinguish the sheet's session palette
  snapshot from the application's working-tree tokens. This extension inherits
  the sheet snapshot; it does not resolve or canonize that pre-existing drift.
