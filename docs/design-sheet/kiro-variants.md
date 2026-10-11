# Kiro design variants

Advisory suggestions requested on 2026-10-09, generated with Kiro CLI using `claude-opus-5.5` at high effort. Kiro read the completed design sheet and existing design-system notes. These are unimplemented composition proposals; widths and Thai wrapping need visual verification before adopting either option.

Both preserve the user-approved compact controls, close labels, readable statuses and restrained focus outline. The current design sheet remains the baseline. The content below is Kiro's returned comparison.

Two variants follow: Side Rail and Margin Labels. Both change only the workflow panel. That panel stands in for the application workspace. The sheet's documentation framing stays as it is: the 200px direction-notes column, the `DEMO-WH` specimen bar, workflow tabs and caption. In the app, warehouse context stays in the shell header. Field sizes and spacing, status badges, focus treatment, type, palette and themes are unchanged.

## Variant A: Side Rail

**Visual direction:** a fixed left column holds the task's context, and the right column holds the work and its Save action.

```
DEMO-WH  (app header)
Scan job tickets
Pick the location first, then scan each pallet's job ticket.

Location                │ ⓘ Review the extracted values before saving.
FG1-L01  ✓ Mapped       │ Ticket 1
Left side · Floor 1     │ Job number * AI filled   Product barcode *
                        │ [FO26090042        ]     [8850000000042     ]
Capture                 │ ▸ More details · 7
[📷 Add photo]          │
▦ Scan barcode          │ ─────────────────────────────────────────
⌨ Type manually         │ 1 ticket ready · FG1-L01    [Save tickets →]
```

- **Layout:** the rail is about 200px wide, with no fill or border. A 24px gap separates it from the work column. Reading order stays location first: rail content, then the ticket, then Save.
- **Catalogue:** the four totals become a vertical list in the rail, with the stored filter below them. Search, table and pagination fill the main column.
- **Floor:** floor selection, 2D/3D and the legend sit at the top of the rail, with the inspector below them. The map gets the full remaining width.
- **HR:** the rail holds the date, employee, planned shift, site and policy. The main column shows the actual clock-in and clock-out times and the one next clock action. Planned and actual times end up in separate columns.
- **What gets quieter:** the location strip, toolbar row, statistic strip and shift strip are no longer separate horizontal rows. The page is shorter, with fewer stacked 16px gaps.
- **Main tradeoff:** about 200px of width goes to context. The catalogue table and optional fields get narrower, which needs checking at 1280px with the app sidebar. The eye also has two columns to scan. Long Thai location names wrap within the rail.
- **Mobile (≤800px):** the rail stacks above the work in DOM order. Capture actions become a wrapping row of 48px buttons, and Save fills the width. On the floor plan, the inspector should come after the map in DOM order so it appears below the map on phones without CSS reordering.

## Variant B: Margin Labels

**Visual direction:** a single reading column where section names sit in a narrow left margin, so each section loses its heading row.

```
Scan job tickets
Pick the location first, then scan each pallet's job ticket.

Location    FG1-L01  ✓ Mapped   Left side · Floor 1

Capture     [📷 Add photo]  ▦ Scan barcode  ⌨ Type manually
            ⓘ Review the extracted values before saving.

Ticket 1    Job number * AI filled      Product barcode *
            [FO26090042           ]     [8850000000042        ]
            ▸ More details · 7
────────────────────────────────────────────────────────────────
            1 ticket ready · FG1-L01               [Save tickets →]
```

- **Layout:** the margin is about 112px. Its labels use the 12/16 operating text color at medium weight. Sections are separated by the 24px group gap, not dividers. The existing rule above Save is the only line.
- **Catalogue:** the Totals band (the statistic strip) and the Find band (search and filter) use the margin. The table spans the full width, following the existing rule that lists use available width.
- **Floor:** a Floor band holds floor selection and 2D/3D. The map and its adjacent inspector span the full width.
- **HR:** the margin labels read Recorded, Planned and Policy. Actual and planned times are kept apart by labelled position, without boxes.
- **What gets quieter:** the ticket heading and pin icon go, and section headings stop stacking above content. That removes about three rows of vertical gaps while keeping one order: location, capture, ticket, Save.
- **Main tradeoff:** the margin takes about 112px from fields. Thai labels such as ตำแหน่งจัดเก็บ may wrap onto two lines. Mixing margin bands with full-width table and map bands needs consistent rules, or the page looks uneven.
- **Mobile (≤800px):** margin labels move above their bands with 8px spacing, which is effectively the currently accepted sheet. Fields stack and Save fills the width.

## Comparison

|               | Side Rail                                 | Margin Labels                                              |
| ------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Composition   | Two columns: context and work             | One column with a label margin                             |
| Main removal  | Location, toolbar, totals and shift rows  | Section heading rows and the ticket heading                |
| Reading order | Rail first, then work; two places to scan | One linear path                                            |
| Save scope    | End of work column, location repeated     | End of column, location repeated                           |
| Width cost    | About 200px, including on tables          | About 112px on form bands only; tables and maps full width |
| Floor plan    | Inspector moves into the left rail        | Map and inspector unchanged                                |
| Mobile        | Stacks with one DOM-order caveat          | Becomes the accepted sheet                                 |
| Main risk     | Narrower tables, split attention          | Thai label wrapping, mixed band rules                      |

## Recommendation

Margin Labels fits this feedback better. You rejected large section gaps, and it removes heading rows rather than adding a new region. It needs no new containers or dividers, keeps the location-first order and the Save scope at the end, and becomes the mobile density you already accepted. Side Rail suits users who want context visible all the time. But it adds a second column for the eye to track, narrows the catalogue table, and moves the floor inspector. Those are bigger compositional changes than "quieter" calls for.

I only read the design-sheet files and `docs/plans/design-system.md`; nothing was edited or rendered. The width and Thai-wrapping concerns are estimates and would need a check at 1280px in both languages.
