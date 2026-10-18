# Design question

How can the existing Storage Planner UI on main be quieter, with fewer cards
and borders, while keeping its workflows and information?

The initial generic proposal was replaced after the user requested direct
codebase references and specified main. The current baseline is `278292a`,
including the compact-control changes in PR #39. This proposal requires no
production migration or backend change.

## Kiro Opus recommendation

Kiro CLI ran Claude Opus 5.5 at high effort to read the real shell, job scan,
records, catalogue, pallet and storage-layout components. Its recommendation:
retain the familiar shell, flatten repeated panels into open sections, and make
workflow warnings and required controls carry the emphasis.

The scan change directly responds to `JobScanScreen.tsx` and `TicketCard.tsx`:

- Print a location name only if it differs from the code.
- Replace the full-width outlined capture grid with a compact toolbar.
- Separate tickets with one divider; remove each ticket's enclosing card.
- Replace amber input fills with neutral fields and small AI-origin markers.
- Keep the review advisory and visible error text.
- Turn `CollapsibleSection` into a plain details disclosure with its filled count.
- Confine Save to the app's main column and align it with the content.

All nine field names and source values follow `ticketDraft.ts`. Barcode placement
uses its rule: classify `FO` plus digits as Job number, then fill the newest ready
ticket missing that identity; otherwise create a new ticket. Editing clears that
field's AI origin. Reading and missing identities prevent saving.

## Applying the direction across the app

`ProductScreens.tsx` supplies the four catalogue totals and the product form's
SKU/name/unit, storage requirements and optional references. The summary becomes
a row of unboxed numbers and the forms become headed sections.

`JobScanRecords.tsx` supplies Unmapped/Mapped/All, search, source, image and location
assignment. Records become divided rows with a main-column selection action.

`PalletScreens.tsx`, `PackingScreen.tsx`, `MoveScreen.tsx` and `StackScreen.tsx`
supply the measurement, packing, placement, verification and stacking vocabulary.
Their proposals avoid repeated summary and footer panels. The prototype does not
claim to reproduce geometric collision checks or a complete reservation engine.

`StorageLayoutScreens.tsx` and `FloorMap.tsx` supply building dimensions, floor
selection, position inspection, editing and impact review. The map keeps a single
canvas surface. The geometry, reserved areas and placements come directly from main’s isolated
`storageFloorDemoData.ts` fixture, identified as demo data. Building settings open
in a dialog, and floor/edit mode survive URL reloads. The catalogue retains the
all-locations view, status filter/toggle, occupancy breakdown and pagination
affordances with sample data.

`src/app/globals.css` supplies the theme values, copied and prefixed in
`app-tokens.css`. `messages/th.json` and `messages/en.json` supply the actual labels,
snapshotted in `reference-data.js`. The four primary destinations follow
`src/lib/navigation.ts`; no invented members/settings/move-queue destinations.

## Layout choices

A is the recommended everyday scan view, with small photos and inline identities.
B gives the source photo more space for checking extraction. C suits reviewing
several tickets without repeating every editor at once. The shell stays familiar
and draft values survive layout switches. No variant has been selected for
production implementation yet.
