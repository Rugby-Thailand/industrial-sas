# Storage Planner compact workspace — approved design A

The user selected A on 2026-10-06 and authorized implementation, audit and merge
of PR #39. The production change must replace the spacious first implementation
with a compact layout, retaining its camera optimization and existing safeguards.

Design source: [compact prototype A at e2ade40](https://github.com/Rugby-Thailand/industrial-sas/tree/e2ade40/src/components/storageLayouts/_prototype/compact-workspace).
The prototype is design evidence; rewrite it in real application components.
Do not ship its synthetic inventory or standalone HTML implementation.

- One compact toolbar on desktop, two rows on mobile. Show icon Map/Table
  controls at all widths; offer Split only when the workspace has room. Keep
  keyboard navigation, accessible names and visible focus.
- Floor selection is a small floating control in the canvas in Map/Split and
  part of the toolbar in Table. Use compact floor choices rather than thumbnail
  cards; retain selected floor identity, area, location count and Edit floor.
  Unique floor dimensions/height remain in the scene and editor.
- One clear-search action. Search/filter apply to map and list. Secondary create
  actions remain reachable through More actions. Sorting belongs to column
  headers on desktop and a small menu on mobile, without a separate control row.
- Flat mobile rows approximately 54px high; show the code once, dimensions,
  status and units. Retain distinct names and honest incomplete/unknown counts.
  Desktop keeps inventory columns; hide the redundant name column only when
  every filtered name equals its code, keeping columns stable across pages.
- Table height follows the data, with a maximum scroll area for long results.
  Pagination directly follows the content; no fixed-height gap below a single
  result. Hide unnecessary page controls when only one page exists. The 390px
  single-result workspace should remain below 260px before expanding details.
- Selecting a Table row expands real details immediately below it, with a Show
  on map action. Preserve existing inventory links, zone editors, permissions,
  unsaved-draft guards and editor lifetime. Map/Split retain the desktop inspector
  and mobile sheet with focus return. Clear/collapse selections deliberately.
- Preserve page size, sorting, search, selected location and camera between
  panel changes. Keep URL floor/building mode/editor context and history metadata.
  No backend schemas, geometry or mutation semantics change.
- Reuse the app palette, fonts, translations and shared primitives. The approved
  dense layout overrides the earlier 48px secondary-control standard only inside
  this workspace: 36px desktop controls, 44px mobile view/filter/page controls.
  Ordinary forms and editors retain their existing control sizing.

Verify the real components at 320, 390, 768 and 1440px in Thai/English and both
appearance modes. Check overflow, empty/single/many results, pagination, sort,
floor selection, editing and view changes. Record real-component interactions
with Playwright as explicitly authorized; fixture runs are not live backend QA.
