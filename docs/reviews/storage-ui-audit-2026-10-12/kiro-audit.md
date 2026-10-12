# Storage UI audit and refinement (Kiro, 2026-10-12)

Base: `origin/main` a050a851, isolated worktree. Nothing was committed, pushed,
deployed or run against shared services. No browser, dev server or production
build was started; T3 capture and the final build belong to the primary agent.

## Implementation-integrity verdict

**Sound with constraints.** The five confirmed defects and four smaller verified
defects are fixed at their owning components, with regression tests. The
provided navigation fix and history refactor are unchanged. The constraint: all
visual results come from source reasoning plus jsdom geometry. None of them has
been checked in a real browser after the change.

## Evidence used

- Screenshots in `screenshots/before/`: `fg1-th-desktop`, `fg1-inspector-th-desktop`,
  `fg1-more-th-desktop`, `scan-en-desktop`, plus three loading-state captures
  (`finished-goods-th-dark`, `records-th-dark`, `scan-th-dark`) as they were at
  the initial review. These have since been replaced; see below.
- The user's three attachments: FG1 R02–R07 at 200 %, F1-F2-SB L1–L3 at 500 % with
  the duplicated inspector header, and the two adjacent `…` buttons.
- Source reading of every file listed below. At the initial review, the
  finished-goods and records captures showed only the route skeleton, so those
  screens were audited from source alone.
- Later baseline change (by the primary agent, after the initial review): the
  three loading-state captures (records, finished-goods, scan) were replaced
  with fully ready baseline captures (`*-th-dark-desktop` and `*-th-dark-mobile`;
  the manifest records their headings). F6 was found on the original loading
  captures, and the current files no longer show that state. An F1/F2 floor 1
  fixture now exists at `screenshots/before/f1-f2-floor1-th-dark-mobile.png`
  (F1-F2-SB, floor 1, 2D · 100 %, mobile, before the change). I viewed these
  files as images only. They are not browser verification of this work.

## Findings

| ID  | Sev | Where                                       | Impact                                                                                                                                                                                                                                                                                                                | Status       |
| --- | --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| F1  | P1  | `FloorMapDrawing.tsx` simple plan cells     | Code and status font sizes and the 18-unit line offset were in frame units inside the zoomed group, so they scaled with zoom. Fit checks used frame-units×zoom rather than CSS pixels. At 200–500 % the codes grew past their cells. The status line drifted into the next cell (R02–R07, L1–L3) or outside the zone. | Fixed        |
| F2  | P1  | `FloorWorkspaceToolbar.tsx`                 | Two identical `…` triggers sat side by side. The second opened a popover whose only content was an unlabelled-looking icon button (Add storage stack).                                                                                                                                                                | Fixed        |
| F3  | P2  | `StorageZonesPanel.tsx` (compact, hosted)   | Inside the inspector the panel stacked "Location details ✕" above "Selected location ✕". In the sheet it added a second ✕ next to the sheet's own. The two ✕ buttons did different things (hide vs. clear) and looked identical.                                                                                      | Fixed        |
| F4  | P2  | `FloorWorkspaceToolbar.tsx`                 | Clear search unmounted the focused button. Focus fell to `<body>`, so keyboard and screen-reader users lost their place.                                                                                                                                                                                              | Fixed        |
| F5  | P2  | `LocationPicker.tsx`                        | The search icon was painted under the input. `ScanCodeInput`'s positioned wrapper comes later in the DOM and `bg-surface` covers the icon, which left an empty 36 px gap (`scan-en-desktop.png`).                                                                                                                     | Fixed        |
| F6  | P2  | `c-sidebar-2.tsx` (shared nav)              | While navigation loads, the collapsed 4 rem rail wraps "กำลังโหลดงานที่ใช้งานได้…" into five clipped lines (all three original loading captures, since replaced).                                                                                                                                                     | Fixed        |
| F7  | P2  | `c-sidebar-2.tsx` skip link                 | `href="#main-content"` created a state-less native history entry. Back onto it leaves RouteLoading stuck (navigation audit D4).                                                                                                                                                                                       | Fixed        |
| F8  | P3  | `LocationPicker.tsx` result rows            | `focus-visible:outline-none` left only a faint background change as the focus indicator. Long building · floor · zone names were truncated to a single line on narrow screens.                                                                                                                                        | Fixed        |
| F9  | P3  | `useWorkspaceNavigationGuard.tsx`           | The guard key string was duplicated in `appHistory.ts`, and the two copies could drift.                                                                                                                                                                                                                               | Fixed        |
| N1  | —   | `LocationPicker.tsx` input name             | Reported as unnamed in the browser semantic inventory. It is not: `FormField` renders `<label for={id}>` (sr-only) and `ScanCodeInput` spreads that `id` onto the input. Existing tests query `getByRole("textbox", { name: "Search location" })`. That inventory entry is a tool artifact; nothing changed.          | Not a defect |
| R1  | P3  | `FloorMap.tsx` built-in inspector (no host) | The generic inspector, which the F1/F2 screenshot harness uses, showed "Location details ✕ (hide)" above an inner "Clear selection ✕" for both selected locations and selected areas. The sheet showed that inner ✕ beside its own close button.                                                                      | Fixed        |
| R2  | P3  | `FloorMapDrawing.tsx` PD cell labels        | PD labels divide by zoom but not by `screenUnit`, so they still vary with panel width. This is deferred: it is a source observation outside the original simple-cell bug. The F1 diff changes only simple-cell label text, so no PD geometry regression was found.                                                    | Deferred     |

Audited with no further confirmed defects: Scanned records (search label,
select-all, bulk delete), Buildings catalogue (labelled search, status selects,
icon actions), finished-goods filters (`Field` → `FormField` association). The
Buildings search icon has no explicit `aria-hidden`, but lucide-react 1.31
hides icons by default.

## Five dimensions

- **Accessibility:** focus returns to search after Clear (F4). The skip link
  focuses `main` and keeps link semantics (F7). Each inspector and sheet has one
  heading and one close action (F3). Picker rows have a real focus outline (F8).
  The collapsed loading status remains announced through a `role="status"`
  sr-only sentence (F6). Plan-cell labels keep their accessible names in
  `aria-label` and `<title>`, so hiding a label never hides the name.
- **Performance:** the label helper is O(characters) per cell and adds no state
  or effects. The toolbar has one less popover and one less `useState`. Not
  measured: no timing or profiling was run.
- **Theming:** only existing tokens and colours are used (`--plan-*`,
  `outline-accent`, `text-muted`). Fonts are unchanged: the status still
  inherits the plan's mono face. The light/dark identity is untouched.
- **Responsive:** the toolbar action takes the old `.more` grid slot. It is
  36 px on desktop and 44 px in the ≤850 px container, matching the other
  toolbar icons. Labels are now constrained by the projected CSS-pixel cell, so
  the narrow 294 × 476 viewport drops the status instead of overflowing.
- **Integrity:** map geometry, selection, keyboard arrows, physical pallet
  boxes, PD cells and group chips are unchanged. Add-zone permissions and its
  four disabled conditions are unchanged, and IconButton defaults to
  `type="button"` inside the floor `<form>`. The standalone compact panel keeps
  its header and Clear selection.

## What changed

- `planCellLabelLayout.ts` (new, pure): this is the label layout. It takes the
  projected cell size in CSS px and returns code and status font sizes and
  offsets.
  - The code is capped at 14 px with an 8 px minimum. The status is capped at
    11 px with a 9 px minimum.
  - Padding is 4/3 px. Line boxes are 1.15 em for the code and 1.4 em for Thai
    status.
  - Width uses a mono em estimate; Thai combining marks count as zero width.
  - Both lines shrink together before the status is dropped. The status is
    hidden only when that two-line layout cannot fit.
- `FloorMapDrawing.tsx`: simple cells call the helper and convert its result
  with `screenUnit / zoom`. The tspan uses absolute `y` instead of a scaled
  `dy`.
- `FloorWorkspaceToolbar.tsx`: the actions popover, its state and the
  `MoreHorizontal` import are gone, and actions render directly. The search
  input gets a ref, and Clear refocuses it. The `.more` CSS class became
  `.actions`, with sizing for the passed button.
- `StorageLayoutScreens.tsx`: Add storage stack is now an `IconButton` with a
  tooltip. Its label, Plus icon and disabled conditions are unchanged.
- `StorageZonesPanel.tsx`: the compact header (Selected location + Clear
  selection) renders only without a `LocationDetailsHost`.
- `FloorMap.tsx`: the list-view inline drawer has no other close, so it shows a
  Clear selection button next to its heading. This applies to hosted and
  built-in details.
- `FloorMap.tsx` (R1): the inner ✕ is removed from the built-in selected
  location and selected area details. The desktop aside keeps Hide details. The
  compact sheet keeps Close dialog. Hiding or closing keeps the selection, and
  `<code> · Location details` reopens it. Selection is cleared by Escape on the
  canvas, by clicking the selected location or area again on desktop, or by the
  inline drawer's button.
- `tests/e2e/workspace/workspace.spec.ts` and
  `scripts/storage-workspace-preview/verify.mjs` clicked the removed inner
  Clear selection. They now assert it is absent and clear with a canvas Escape.
  Neither was run: no browser was used.
- `SkipToContentLink.tsx` (new): `preventDefault` then focus the target. If the
  target is missing, the native fragment still works.
- `c-sidebar-2.tsx`: uses `SkipToContentLink`. The collapsed loading state is a
  spinner plus sr-only text (`motion-reduce` respected).
- `LocationPicker.tsx`: `z-10` on the search icon, a focus outline on result
  rows, and `line-clamp-2` for row context.
- `useWorkspaceNavigationGuard.tsx`: `HISTORY_KEY = GUARD_HISTORY_KEY` from
  `appHistory.ts`.

## Measured vs. inferred

Measured (jsdom/Vitest; layout values come from SVG attributes, not pixels on
screen):

- FG1 approved plan in a 1100 × 560 viewport, at 100/200/500 % in Thai and
  English. Every code and status line is 8–14 CSS px and its line box sits
  inside its cell rect. From 200 %, all 15 cells show their status (10 or more
  asserted). The R05 code size is identical at 200 % and 500 %.
- In a 294 × 476 portrait viewport, the R04 status is hidden.
- Unit cases: the FG1 R-row at 43 × 29, 86 × 58 and 215 × 145 px; a narrow
  30 × 110 L3 cell; degenerate cells.

Inferred, not verified: real glyph widths (the em estimate is conservative), the
on-screen result in Chrome/Safari, icon stacking (F5), the collapsed-rail
appearance (F6), outline visibility in both themes (F8), and the toolbar at
map/table/split and mobile widths. These need the primary agent's T3 capture.

## Checks run (one batch, plus an ESLint re-run without the CSS path)

- `prettier --write` on the touched files; `prettier --check` on the provided
  navigation files: clean.
- ESLint `--max-warnings=0` on all touched TS/TSX and the navigation files:
  clean. The first run included the CSS module, which ESLint does not
  configure, and printed only an "ignored file" warning.
- `pnpm typecheck:ts6` (`next typegen` + `tsc --noEmit`): clean.
- `vitest run` over `src/components/storageLayouts`, `src/features/storageLayouts`,
  `src/features/finishedGoods/jobScan`, `src/components/shell`,
  `src/components/system`, `src/lib/browser` and `src/i18n`: 57 files and 434
  tests passed.

## R1 correction batch (checks run)

- `FloorMap.workspace.test.tsx` has three new tests:
  - Built-in desktop aside, location and area: exactly one close (Hide details)
    and no Clear selection. After hiding, the selection stays pressed and
    reopen works.
  - Compact sheet (`max-width: 850px` mocked): one Close dialog and no Clear
    selection. After closing, the selection stays pressed and reopen shows the
    sheet again.
  - Built-in inline drawer: one Clear selection, the only button in the drawer
    header. It clears the drawer and the selected row.
- Against `HEAD`'s `FloorMap.tsx`, all three fail. With the change, all pass.
- `prettier --write` and ESLint `--max-warnings=0` on the four touched files:
  clean.
- `vitest run src/components/storageLayouts src/features/storageLayouts`:
  25 files and 219 tests passed.
- Not run: typecheck, full build, Playwright and browser checks.

## Remaining constraints

- No browser verification after the change, including after the R1 batch.
  The F1/F2 floor 1 fixture (`before/f1-f2-floor1-th-dark-mobile.png`) is a
  before capture at 100 %. It is not a 500 % after capture. The unit test
  models the 500 % case.
- R2 above (deferred).
- The em estimate cannot see font fallback. A Thai face much wider than 0.62 em
  could still let a status line run past the cell's side padding. The
  vertical fit does not depend on the estimate.
