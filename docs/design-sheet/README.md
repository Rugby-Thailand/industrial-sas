# Storage Planner design sheet

A visual proposal for a quieter Storage Planner interface, requested on 2026-10-09. Open [index.html](index.html) or serve this directory locally:

```sh
python3 -m http.server 3211 --bind 127.0.0.1 --directory docs/design-sheet
```

Then open <http://localhost:3211>. The sheet works without a build or remote assets. Use the language and theme controls to inspect Thai/English and light/dark. The Print sheet action exports the selected workflow through the browser’s print dialog; use Save as PDF if needed.

## Direction

Keep the existing vivid blue, neutral palette, semantic colors, Geist typography, Thai support, visible control borders, and 48px touch targets. Reduce repeated containers: group by heading, spacing and occasional dividers; use one surface for a task. This is a proposal, not an application migration. No production components, data, permissions or workflows were edited.

The four interactive workflow specimens use explicitly synthetic records. They demonstrate presentation and local interactions; they do not reproduce the backend, camera, OCR, physical layout validation, authorization or attendance persistence. Save and clock actions clearly report that no application records were written.

Field labels sit 2px above their inputs, as requested in the preview review. Desktop fields and buttons are 36px tall, touch controls remain 48px, field gaps are 8px, and quantities use compact fields. Task sections use 16px spacing, task groups 24px, and documentation chapters 40px. Status labels use stronger proposed foregrounds and 600 weight on the existing pale semantic surfaces. The catalogue’s three-record sample has a static page indicator; production cursor pagination remains an implementation requirement.

Focus uses a 2px outline. Fields pull that outline into their border with a -1px offset, giving one close blue edge instead of a separated halo. Other controls retain a 2px offset for keyboard visibility.

## UX writing

The original sheet at `/` has the refined English and Thai copy. Short actions use their nearby heading for context, the single ticket no longer repeats its heading, and attendance has one demo notice and one completion status. Full accessible names remain on shortened controls. The two pallet quantities share a “Sheets per pallet” label; “Leaving factory” and “At customer” retain the meanings defined in `convex/model/finishedGoods/jobScans.ts`. The generic quantity remains separate.

The comparison layouts at `/variants/` retain their previous wording. These copy changes passed 144 DOM and local interaction checks across both languages and all three layouts, covering field meanings, validation, draft retention, search recovery, map keyboard selection, and sample clocking. See [copy-checks.json](evidence/copy-checks.json). These checks do not measure visual layout or contrast.

The native preview also passed 32 overflow checks at 390px and 1280px across the four workflows, both languages, and both themes. Inputs remain 36px on desktop and 48px on phones. The refined English desktop and Thai phone form screenshots were inspected; see [desktop](evidence/copy-desktop-en.png) and [phone](evidence/copy-mobile-th.png). The shared pallet unit label keeps the desktop input bottoms aligned.

## Source map

| Sheet area         | Current source                                                                                                                                                  | Proposed change                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme              | `src/app/globals.css`, `src/components/ui/theme-toggle.tsx`                                                                                                     | Preserve both palettes. Use neutral surfaces more consistently.                                                                                                                                                                |
| Type               | `src/app/[locale]/layout.tsx`, `src/components/ui/PageHeader.tsx`                                                                                               | Preserve Geist and Geist Mono, the 24/32 heading and 14/20 body scale. Load the declared Noto Sans Thai fallback locally in the sheet.                                                                                         |
| Shell              | `src/components/examples/c-sidebar-2.tsx`, `src/lib/navigation.ts`                                                                                              | Retain warehouse context, search, locale/theme controls, role-based destinations, and mobile navigation. The sheet’s own navigation is documentation navigation.                                                               |
| Actions and fields | `src/components/ui/button.tsx`, `input.tsx`, `FormField.tsx`                                                                                                    | Use 36px desktop controls and 48px touch controls, preserving 6.4px corners and visible focus. Keep secondary actions neutral. Use inline labels for AI origin rather than tinted fields.                                      |
| Job scan           | `src/features/finishedGoods/jobScan/JobScanScreen.tsx`, `TicketCard.tsx`, `ticketDraft.ts`                                                                      | Flatten ticket framing and capture toolbar; retain location-first order, the two required identities, seven optional fields, review notice, source information and Save scope.                                                 |
| Finished goods     | `src/features/finishedGoods/FinishedGoodsCatalogue.tsx`, `FinishedGoodsTable.tsx`, `CatalogueFilterControls.tsx`                                                | Replace boxed totals with a statistic strip. Keep search, view selection, filters, scoped totals, numeric alignment and real pagination.                                                                                       |
| Floor planning     | `src/components/storageLayouts/FloorMap.tsx`, `FloorWorkspaceToolbar.tsx`, `src/components/storageScene/sceneColors.ts`, `src/lib/storageLayouts/areaColors.ts` | One map surface and an adjacent inspector. Preserve real geometry, floor selection, 2D/3D modes, editing guards, inventory and independent persisted area colors. The sheet’s map is a schematic, not a production floor plan. |
| HR                 | `src/features/hr/TodayScreen.tsx`, `HrUi.tsx`, `ReviewScreen.tsx`, `PeriodDetailScreen.tsx`                                                                     | Flatten receipt and summary boxes. Keep actual/planned times distinct, one next clock action, server receipts, correction review and immutable period certification.                                                           |
| States             | `src/components/system/DataGate.tsx`, `QueryGate.tsx`, `LedgerPanelStatus.tsx`, `src/components/ui/Notice.tsx`, `EmptyState.tsx`                                | Preserve loading/empty/error distinctions, actionable recovery, read-only explanations and draft retention.                                                                                                                    |

Existing design context: `docs/plans/design-system.md` and `src/components/shell/_prototype/minimal-app/design-notes.md`. The earlier prototype informed the quieter direction; it has not been treated as an implemented production design.

`tokens.css` freezes the palette read from `src/app/globals.css` at the beginning of this session. The application stylesheet changed concurrently while the sheet was being authored, including a light primary of `#1d4ed8` and a white canvas. This proposal retains the original snapshot so its references stay reproducible. Confirm the latest application tokens when implementing the composition; the sheet does not override them.

## Implementation order

1. Adjust shared page, panel and toolbar composition first. Keep public component APIs and variant meanings intact, especially legacy `bg-accent` and `text-muted`.
2. Flatten job scan and scanned-record rows. Preserve all fields, AI-origin clearing on edit, blocking validation, error notices, photo inspection, QR and barcode behavior.
3. Adopt the statistic strip and shared list surface for finished goods and buildings. Preserve filters, view modes and pagination; do not derive global totals from a page.
4. Apply quieter grouping to HR receipts and review screens. Preserve permission differences, factual clock policy, correction status and period versioning.
5. Review floor planner chrome independently from geometry and scene colors. Never substitute area identity colors for occupancy/status colors.

Validate implementation at 390px, 768px, 1280px and 1440px, both languages and themes, keyboard, long names, empty/loading/failed/read-only states. Text and placeholders must meet 4.5:1 contrast; large text and meaningful non-text controls must meet 3:1. Preserve reduced motion and browser zoom. Application changes should run the repository’s appropriate checks; this standalone documentation sheet uses browser and formatting verification.

The sheet passed 64 viewport/language/theme/workflow combinations with no document overflow or violations in the tested axe WCAG A/AA rules, plus eight focused interaction checks. See [browser-checks.json](evidence/browser-checks.json) and the screenshots in `evidence/`. These checks do not establish complete accessibility conformance. Print CSS is supplied; physical printing and PDF pagination were not tested.

## Impeccable installation

Official source: [pbakaus/impeccable](https://github.com/pbakaus/impeccable). Skill version: **4.5.2**, pinned engine version **0.1.14**. Installed with the Codex skill-installer helper into `.agents/skills/impeccable`. The official launcher’s executable permission was restored after ZIP extraction, and `engine-probe` succeeded. Context loading initially failed because the ZIP did not preserve the executable bit, so the project context was read directly. No automatic edit hook was installed.

The skill is available to the harness on the next turn. This sheet applies its quieter, read/operate, and craft-floor guidance immediately from the installed reference files.

## Font assets

Geist and Geist Mono Latin subsets are copied from the running application’s Next font assets. Noto Sans Thai is the official variable font from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosansthai). Each font’s SIL Open Font License is included in `fonts/`. No font service or third-party script runs in the sheet.
