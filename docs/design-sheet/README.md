# Storage Planner design sheet

The approved original **no-inner-rail** composition, refined after a source-backed Kiro audit on 2026-10-11. Build the local shadcn controls, then serve [index.html](index.html):

```sh
pnpm build:design-sheet
python3 -m http.server 3211 --bind 127.0.0.1 --directory docs/design-sheet
```

Preview: <http://localhost:3211/>. Language, theme and Print sheet controls are available. The compact **Review state** selector changes the current specimen's state. All records and interactions are synthetic; there is no backend, camera, authorization or attendance persistence.

## Interactive controls · 2026-10-14, revised 2026-10-15

Selects, dates and times are React islands built on real Radix Select/Popover and react-day-picker, with no browser-native picker UI. `ui/` holds sheet-owned adaptations of the application's `select.tsx`/`SelectControl` and the official shadcn `radix-nova` Popover/Calendar (MIT license in `ui/`). They keep the shadcn structure and `data-slot` names but carry no Tailwind classes, because the sheet compiles no Tailwind; `controls.css` styles their state attributes. [DESIGN.md](DESIGN.md#preview-and-application-differences) lists the intentional preview/application differences and the token/state parity. Hidden form sources only connect the islands to the existing synthetic draft handlers; they are hidden after a successful mount, or replaced by labelled read-only values when the bundle fails.

After the [reviewed 2026-10-15 audit](../reviews/design-sheet-kiro-audit-2026-10-15/reviewed-audit.md) (see [audit fixes](evidence/audit-fixes-2026-10-15.md)):

- Confirming the selected date keeps it; only the explicit Clear date action (optional dates) empties a date.
- Time is a popup draft: Done commits a complete `HH:mm`, Escape or an outside click discards it, empty stays empty and optional times offer Clear time.
- Thai trigger, caption, grid and day names all use Buddhist years with Latin digits; values stay Gregorian `YYYY-MM-DD`. Weeks start on Monday; English uses en-GB.
- **Field states** (Controls chapter) shows invalid, example-range, empty, pending, read-only and disabled specimens. Requirements and the 5–23 October range are examples, not business rules; the Reading state keeps its disabled ticket controls.
- Pressed toggles, disabled text inputs, pending actions, calendar styling, print from dark mode, popup height, accessible names, Thai labels and loading totals were corrected. If the island script fails, a localized notice explains the failure and current values remain readable in read-only fields. Native picker popups are never exposed.

In-field scanner icons have no hover fill, transition or press translation. All field icons remain centered; keyboard focus and disabled states remain visible. Try the controls under **Field hierarchy** and **Field states**, or expand the scan ticket's optional details to use its dates.

`pnpm build:design-sheet` generates the ignored `dist/` assets locally (only `controls.js` and `controls.css`; the application's `public/` is not copied). Source: `controls.tsx`, `controls.css`, `ui/`, `vite.config.mjs`. No runtime CDN is required. Rebuild after editing these sources. Functional checks: `node docs/design-sheet/evidence/check-controls.cjs` runs the built islands with the sheet scripts in jsdom and writes [controls-checks.json](evidence/controls-checks.json), with regression cases for each audit finding. jsdom does not prove browser geometry, rendered print, pixels, screen readers or physical-device behavior.

References: [shadcn Select](https://ui.shadcn.com/docs/components/radix/select), [Date Picker composition](https://ui.shadcn.com/docs/components/radix/date-picker), [Calendar](https://ui.shadcn.com/docs/components/radix/calendar).

## What is approved

On 2026-10-15, text-only quiet buttons were refined to change only ink color on hover/press, with no background or movement. Keyboard focus stays visible; disabled text actions stay transparent and muted. The same rule is included in the current application adoption plan. Field icons remain unchanged on hover/press.

Close 2px labels, 8px field gaps, quiet focus edges, unboxed totals and shared task surfaces. Fields use 32px height at ≥768px with a fine pointer, otherwise 40px with 16px input text. Scanner and select icons are centered in matching trailing slots; standalone buttons keep 36px/48px targets. Layout still stacks at 800/520px. Stronger status inks are already present in the application's uncommitted working tree; the sheet's token snapshot remains a separate historical palette.

The palette strip is the **2026-10-09 snapshot**, not current production tokens. The application uses light primary `#1d4ed8` and owns its palette. Apply the composition using current shared components rather than restoring this snapshot.

The revised English and Thai copy stays concise without removing domain meaning. A single ticket retains its source and Remove action. Two related quantities share “Sheets per pallet,” with complete accessible names; generic Quantity stays separate. Attendance uses factual Clocked in/out labels and distinct receipts, planned times and uncertainty. Required field units and recovery instructions remain visible.

## Implementation reference

- [Complete system adoption plan · 2026-10-14](system-implementation-plan.md) — Kiro's source-based inventory of 40 pages and 43 navigation entries, reviewed by Codex; ten ordered slices with component owners, acceptance criteria and caller regression coverage. Served mirror of `docs/plans/design-system-complete-adoption-2026-10-14.md`, the current application implementation plan.
- [Earlier plan · 2026-10-11](implementation-plan.md) — historical served mirror of `docs/plans/design-sheet-system-adoption-2026-10-11.md`.
- [Kiro audit](kiro-audit.md) — served mirror of the unchanged independent report in `docs/reviews/design-sheet-system-adoption-2026-10-11/`.
- [Design context](DESIGN.md) — scope, layout, density, component rules and palette provenance for this sheet.

| Area                 | Application sources                                                                                                  | Source status / next step                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density/focus        | `src/app/globals.css`, `input.tsx`, `FormField.tsx`, `SelectControl.tsx`                                             | App fields remain 48/36px; adopt separate 40/32px field tokens and centered icon slots. Input/Select invalid rings are already removed in the working tree. Verify compiled focus behavior. |
| Task surfaces/status | `Panel.tsx`, `StatusBadge.tsx`                                                                                       | Flat surfaces and stronger badge ink are present in the working tree. Verify state coverage.                                                                                                |
| Shell                | `c-sidebar-2.tsx`, `src/lib/navigation.ts`                                                                           | Preserve application navigation/context; sheet navigation is documentation only.                                                                                                            |
| Scan                 | `JobScanScreen.tsx`, `TicketCard.tsx`, `ticketDraft.ts`                                                              | Mostly present. Corrected specimen restores Unit type, source/Remove, field scanners, Change, stock note and disabled Save. Verify real multi-ticket/capture/duplicate/retry behavior.      |
| Catalogue            | `FinishedGoodsCatalogue.tsx`, `FinishedGoodsTable.tsx`, `CatalogueFilterControls.tsx`, `FinishedGoodsMobileList.tsx` | Right-aligned tabular quantities are present in the working tree. Verify global unit totals, continuation/reset, cursor paging, layout controls and phone list.                             |
| Floor                | `FloorMap.tsx`, `FloorWorkspaceToolbar.tsx`, `useFloorWorkspaceView.ts`                                              | Verify only unless a proven gap appears. Preserve geometry/area colors and compact sheet details.                                                                                           |
| Attendance           | `TodayScreen.tsx`, `HrShared.tsx`, `HrUi.tsx`, `useHrWrite.ts`                                                       | Verify/handoff only; separate HR self-service plan owns screen edits.                                                                                                                       |
| HR date/time/month   | `HistoryScreen.tsx`, `EmployeeForm.tsx`, `SettingsScreen.tsx`, `TimeSideField.tsx`                                   | Nine native picker sites remain. DS-5/DS-6 in the current plan add shared shadcn compositions and migrate callers while preserving write contracts.                                         |
| States               | `DataGate.tsx`, `QueryGate.tsx`, `Notice.tsx`, `EmptyState.tsx`                                                      | Preserve unavailable vs zero, permissions and distinct write outcome models.                                                                                                                |

Finished-goods failure and HR uncertainty are different contracts. An unchanged scan retry reuses the request ID for its payload; an edited payload gets a new ID. HR uncertain retries the exact pinned command. A demo receipt in this sheet is not evidence of a successful application write.

Catalogue fixtures show 128 products and storage-unit workflow totals 6/14/342, independently of three displayed rows. Product rows use Ready/Draft; the separate Storage units view uses workflow statuses. The paging example has a 20-record size and disabled Previous/Next because all three fixture rows fit on one page. Real cursor behavior and the phone list are verified in the application, not reproduced here.

## Evidence and limits

Before the shadcn controls were added, the [2026-10-14 field alignment pass](evidence/field-ui-checks-2026-10-14.json) checked 48 browser combinations at 320/390/768/1280px in English/Thai and light/dark. Scanner, dropdown and search icons had zero measured vertical offset from their field centers, with no page-wide overflow. Desktop fields measured 32px and small-screen fields 40px. These are scoped preview checks, not full application or device verification.

[adoption-checks.json](evidence/adoption-checks.json) records 68 language/theme/state combinations, 16 selected-rule structural axe runs and the DOM/event/source assertions of `node docs/design-sheet/evidence/check-adoption.cjs` (run from the repository root). It exercises only the vanilla `sheet.js`/`review.js` handlers: selects, dates and times are checked as their hidden native sources, not as the mounted Radix controls. The mounted controls, including structural axe with popups open, are covered by `check-controls.cjs`. Proposed badge pairs calculate to 7.96:1–9.72:1 from their hex colors. These do not measure browser layout, computed pointer density, contrast or full accessibility. The sampled application baseline passed 39 tests across eight files before sheet edits.

For the shadcn refinement, T3 DOM inspection confirmed rendered app-owned select, date and time popups, 32px desktop / 40px small-screen fields, and no page-wide overflow in the sampled layouts. Screenshot capture repeatedly failed, so a fresh visual sign-off is still open. Full browser axe, physical devices, screen readers and production application verification remain separate checks. No application component was changed or deployed in this preview revision.

All earlier screenshot/JSON reports in `evidence/` describe the sheet at `8b0ef538`; see [evidence/README.md](evidence/README.md). Their 64 browser combinations, 144 copy checks and 32 later overflow checks are historical results, not current revision results. The [comparison variants](variants/README.md) now load frozen assets and retain their earlier wording/layout.

## Impeccable installation

Official source: [pbakaus/impeccable](https://github.com/pbakaus/impeccable). Skill version: **4.5.2**, pinned engine version **0.1.14**. Installed with the Codex skill-installer helper into `.agents/skills/impeccable`. The official launcher’s executable permission was restored after ZIP extraction, and `engine-probe` succeeded. Context loading initially failed because the ZIP did not preserve the executable bit, so the project context was read directly. No automatic edit hook was installed.

The skill is available to the harness on the next turn. This sheet applies its quieter, read/operate, and craft-floor guidance immediately from the installed reference files.

## Font assets

Geist and Geist Mono Latin subsets are copied from the running application’s Next font assets. Noto Sans Thai is the official variable font from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosansthai). Each font’s SIL Open Font License is included in `fonts/`. No font service or third-party script runs in the sheet.

## Audit fix verification · 15 October 2026

Kiro addressed all 21 reviewed observations; the parent review also fixed Enter reopening the Review state menu after its trigger remounts and kept failure handling free of native picker popups. The final control suite passes 159 assertions; the vanilla specimen suite passes 4,684 assertions across 68 states. Build, TypeScript and full ESLint pass.

The T3 browser pass covered 56 English/Thai, light/dark and desktop/mobile combinations with no axe violations or page overflow. Fields measured 32px/40px and scanner/select icons had zero vertical offset. Native keyboard checks confirm date preservation, time cancellation and dropdown closure; a 640×320 check confirms calendar scrolling. Final script-failure handling was tested with an intentionally unavailable controls bundle. [Resolution report](evidence/audit-fixes-2026-10-15.md) · [Browser evidence](evidence/audit-fixes-browser-2026-10-15.json). Physical devices, actual screen readers and rendered print remain untested.
