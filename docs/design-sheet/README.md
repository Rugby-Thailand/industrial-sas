# Storage Planner design sheet

The approved original **no-inner-rail** composition, refined after a source-backed Kiro audit on 2026-10-11. Open [index.html](index.html), or serve it locally:

```sh
python3 -m http.server 3211 --bind 127.0.0.1 --directory docs/design-sheet
```

Preview: <http://localhost:3211/>. Language, theme and Print sheet controls are available. The compact **Review state** selector changes the current specimen's state. All records and interactions are synthetic; there is no backend, camera, authorization or attendance persistence.

## What is approved

Close 2px labels, 8px field gaps, quiet focus edges, unboxed totals and shared task surfaces. Controls use 36px targets only at ≥768px with a fine pointer; otherwise 48px with 16px input text. Layout still stacks at 800/520px. Status inks are stronger proposed additions, explicitly labelled as not yet in the app.

The palette strip is the **2026-10-09 snapshot**, not current production tokens. The application uses light primary `#1d4ed8` and owns its palette. Apply the composition using current shared components rather than restoring this snapshot.

The revised English and Thai copy stays concise without removing domain meaning. A single ticket retains its source and Remove action. Two related quantities share “Sheets per pallet,” with complete accessible names; generic Quantity stays separate. Attendance uses factual Clocked in/out labels and distinct receipts, planned times and uncertainty. Required field units and recovery instructions remain visible.

## Implementation reference

- [Revised plan](implementation-plan.md) — served mirror of `docs/plans/design-sheet-system-adoption-2026-10-11.md`.
- [Kiro audit](kiro-audit.md) — served mirror of the unchanged independent report in `docs/reviews/design-sheet-system-adoption-2026-10-11/`.
- [Design context](DESIGN.md) — scope, layout, density, component rules and palette provenance for this sheet.

| Area                 | Application sources                                                                                                  | Source status / next step                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density/focus        | `src/app/globals.css`, `input.tsx`, `FormField.tsx`, `SelectControl.tsx`                                             | Present. Review the 3px invalid ring and compiled focused-invalid edge.                                                                                                                |
| Task surfaces/status | `Panel.tsx`, `StatusBadge.tsx`                                                                                       | Flat surfaces present. Stronger badge ink is a planned shared slice.                                                                                                                   |
| Shell                | `c-sidebar-2.tsx`, `src/lib/navigation.ts`                                                                           | Preserve application navigation/context; sheet navigation is documentation only.                                                                                                       |
| Scan                 | `JobScanScreen.tsx`, `TicketCard.tsx`, `ticketDraft.ts`                                                              | Mostly present. Corrected specimen restores Unit type, source/Remove, field scanners, Change, stock note and disabled Save. Verify real multi-ticket/capture/duplicate/retry behavior. |
| Catalogue            | `FinishedGoodsCatalogue.tsx`, `FinishedGoodsTable.tsx`, `CatalogueFilterControls.tsx`, `FinishedGoodsMobileList.tsx` | Mostly present. Quantity alignment/tabular numerals remain. Verify global unit totals, continuation/reset, cursor paging, layout controls and phone list.                              |
| Floor                | `FloorMap.tsx`, `FloorWorkspaceToolbar.tsx`, `useFloorWorkspaceView.ts`                                              | Verify only unless a proven gap appears. Preserve geometry/area colors and compact sheet details.                                                                                      |
| Attendance           | `TodayScreen.tsx`, `HrShared.tsx`, `HrUi.tsx`, `useHrWrite.ts`                                                       | Verify/handoff only; separate HR self-service plan owns screen edits.                                                                                                                  |
| States               | `DataGate.tsx`, `QueryGate.tsx`, `Notice.tsx`, `EmptyState.tsx`                                                      | Preserve unavailable vs zero, permissions and distinct write outcome models.                                                                                                           |

Finished-goods failure and HR uncertainty are different contracts. An unchanged scan retry reuses the request ID for its payload; an edited payload gets a new ID. HR uncertain retries the exact pinned command. A demo receipt in this sheet is not evidence of a successful application write.

Catalogue fixtures show 128 products and storage-unit workflow totals 6/14/342, independently of three displayed rows. Product rows use Ready/Draft; the separate Storage units view uses workflow statuses. The paging example has a 20-record size and disabled Previous/Next because all three fixture rows fit on one page. Real cursor behavior and the phone list are verified in the application, not reproduced here.

## Evidence and limits

[adoption-checks.json](evidence/adoption-checks.json) records 68 language/theme/state combinations, 16 selected-rule structural axe runs and 1,480 DOM/event/source assertions. Run `node docs/design-sheet/evidence/check-adoption.cjs` from the repository root to reproduce them. Proposed badge pairs calculate to 7.96:1–9.72:1 from their hex colors. These do not measure browser layout, computed pointer density, contrast or full accessibility. The sampled application baseline passed 39 tests across eight files before sheet edits.

The T3 collaborative preview returned metadata, but the automation host was disconnected. Fresh visual review, browser axe, production build/CSS, physical devices and screen-reader checks remain open. No application files were changed or deployed in this revision.

All earlier screenshot/JSON reports in `evidence/` describe the sheet at `8b0ef538`; see [evidence/README.md](evidence/README.md). Their 64 browser combinations, 144 copy checks and 32 later overflow checks are historical results, not current revision results. The [comparison variants](variants/README.md) now load frozen assets and retain their earlier wording/layout.

## Impeccable installation

Official source: [pbakaus/impeccable](https://github.com/pbakaus/impeccable). Skill version: **4.5.2**, pinned engine version **0.1.14**. Installed with the Codex skill-installer helper into `.agents/skills/impeccable`. The official launcher’s executable permission was restored after ZIP extraction, and `engine-probe` succeeded. Context loading initially failed because the ZIP did not preserve the executable bit, so the project context was read directly. No automatic edit hook was installed.

The skill is available to the harness on the next turn. This sheet applies its quieter, read/operate, and craft-floor guidance immediately from the installed reference files.

## Font assets

Geist and Geist Mono Latin subsets are copied from the running application’s Next font assets. Noto Sans Thai is the official variable font from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosansthai). Each font’s SIL Open Font License is included in `fonts/`. No font service or third-party script runs in the sheet.
