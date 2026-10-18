# HR UI audit: presentation, layout and primitive consistency (Kiro, 2026-10-10)

This is an audit only. It made no source, test, git, DB or manual-guide changes. The baseline is `origin/main` `c64a882` plus the uncommitted HR/Search work. The SHA-256 of every file cited below matches `output/hr-kiro-improvement-20261010/post-rebase-manifest.json`. Measurements, hashes and contrast maths are in `output/hr-kiro-improvement-20261010/ui/kiro-ui-audit-evidence.json`.

## Evidence and limits

- Source: `src/features/hr/*.tsx` and the shared primitives they use (`ui/button`, `ui/input`, `ui/select`, `ui/SelectControl`, `ui/FormField`, `ui/CheckboxControl`, `ui/table`, `ui/TableScroller`, `ui/StatusBadge`, `ui/Panel`, `ui/PageHeader`), plus the `globals.css` tokens.
- Screenshots: I viewed the existing manual-guide captures as images: `docs/manuals/hr-user-guide-th/assets/source/{01-today,03-correction,05-review-queue,06-review-decision,09-employees,10-employee-edit,12-period-create,13-period-close,14-period-export,16-holidays,18-policy}.png` and `annotated/11-schedule.png`.
  - `source/11-schedule.png` is byte-identical to `10-employee-edit.png`, and `source/17-access.png` is byte-identical to `16-holidays.png`.
  - I recorded the dimensions and hashes of the other `annotated/` files but did not view each overlay.
  - Pixel heights come from single-column border scans (±1 px), assuming DPR 1. All captures are 1280×800, light theme, desktop only.
- What these files are: existing captures. They are not fresh, and their capture build is unknown. Their file mtime is checkout time, not capture time. They give no evidence for mobile, tablet, dark theme, zoom, keyboard or focus states.
- Not run: browser, servers, tests and the Impeccable detector. Before any code change, the implementer must read the installed Next guides in `node_modules/next/dist/docs/`. None of the fixes below touch Next APIs.

## Top three UI fixes

### 1. Form controls change height within the same row (P2, confirmed in source and screenshots)

There are two causes:

- **Primitive mismatch.** At ≥768 px, `Input` and `Button` shrink to 36 px (`ui/input.tsx:16` `md:min-h-9`, `ui/button.tsx:29`). `SelectTrigger` stays at 48 px (`ui/select.tsx:30` `min-h-touch`, no `md:` step).
  - `12-period-create`: site select 284–331 (48 px) sits directly above date inputs at 370–405 (36 px).
  - `16-holidays`: site select 285–332 (48 px) against date and name inputs at 371–406 (36 px).
- **Grid stretch in EmployeeForm.** The parent grids `EmployeeForm.tsx:237` (`grid gap-4 sm:grid-cols-2`) and `:410` (`sm:grid-cols-3`) use the default `align-items: stretch`. The field wrappers are themselves grids (`FormField.tsx:38`, `EmployeeForm.tsx:531`). So a field without a hint stretches to match a sibling that has one, and the extra height goes into the control. Measured in `10-employee-edit.png` / `11-schedule.png`:

  | Row                  | Field                       | Height    |
  | -------------------- | --------------------------- | --------- |
  | Account / supervisor | Account select (has hint)   | 48 px     |
  |                      | Supervisor select (no hint) | **62 px** |
  | Employment dates     | Start date (no hint)        | **49 px** |
  |                      | End date (has hint)         | 36 px     |
  | Shift                | Shift start / end (no hint) | **50 px** |
  |                      | Break (has hint)            | 36 px     |

- **User impact.** The HR admin's main editing form looks unbuilt: the controls in one row have three different heights, so the eye loses the row baseline. The period and holiday forms show the same select/input mismatch.
- **Minimal change (HR-scoped):**
  - Add `items-start` to `EmployeeForm.tsx:237` and `:410`.
  - Give the HR `SelectControl` call sites the Input's desktop sizing (`className="md:min-h-9 md:py-1.5"`): `EmployeeForm.tsx:533`, `PeriodsScreen.tsx:245`, `ReviewScreen.tsx:180`, `ReviewDetail.tsx:580`, `SettingsScreen.tsx:137`, `PeriodDetailScreen.tsx:383`. Mobile keeps the 48 px `min-h-touch`.
  - Alternative: add `md:min-h-9 md:py-1.5` once in `ui/select.tsx:30`. That is the cleaner primitive fix, but it is app-wide and outside the HR baseline, so it needs root approval and a storage-layouts visual check.
- **Owned files:** `src/features/hr/EmployeeForm.tsx`, `PeriodsScreen.tsx`, `ReviewScreen.tsx`, `ReviewDetail.tsx`, `SettingsScreen.tsx`, `PeriodDetailScreen.tsx`.

### 2. The date-range hint misaligns the Review toolbar and collapses spacing in Create Period (P2, confirmed)

- **Source.**
  - `DateRangeFields` puts its "ไม่เกิน 31 วัน" hint inside the fieldset (`HistoryScreen.tsx:66,94`).
  - `HrToolbar` uses `items-end` (`HrUi.tsx:48`). Its siblings therefore align to the bottom of the hint, not of the inputs. This affects the tab group (`ReviewScreen.tsx:197-200`) and the site select, which appears only for multi-site users (`ReviewScreen.tsx:178`).
  - In Create Period, `<fieldset … className="contents">` (`PeriodsScreen.tsx:271`) wraps the range. `display: contents` drops the `space-y-4` margin, so the hint runs into the buttons.
- **Screenshots.**
  - `source/05-review-queue.png` and `06-review-decision.png`: date inputs span y 204–239, but the Open/Certified tabs span 219–254. The tabs sit 15 px lower than the fields they filter.
  - `source/12-period-create.png`: the hint sits about 4–9 px above "สร้างฉบับร่าง". Every other group in the form has 16 px.
- **User impact.** The review queue's main filter bar reads as misaligned on every visit. In Create Period, the 31-day rule visually attaches to the submit buttons instead of the dates.
- **Minimal change:**
  - In `HrToolbar`, change `items-end` to `items-start`. Its only callers are Review and History, where the History toolbar holds just the date range.
  - Add `sm:self-center` to the Review tab group. The fieldset is about 78 px tall, so the tabs' centre then lands within about 1 px of the inputs' centre.
  - In `PeriodsScreen.tsx:271`, replace `className="contents"` with `className="min-w-0"`. Preflight already removes the fieldset border and padding.
  - Moving the hint is not needed.
- **Owned files:** `src/features/hr/HrUi.tsx`, `ReviewScreen.tsx`, `PeriodsScreen.tsx`.

### 3. Thai names render badly in identity marks and the employee table (P2, confirmed)

- **Initials.** `HrInitials` takes the first code point of the first two words (`HrUi.tsx:186-195`). For Thai names that start with a leading vowel (เ แ โ ใ ไ, U+0E40–0E44), it outputs the vowel, not the consonant. Mixed-script names produce Thai+Latin pairs. Observed:
  - "สใ" for "สมชาย ใจดี" in `source/01-today.png` and `09-employees.png`.
  - "วไ" in `05-review-queue.png`, `06-review-decision.png` and `09-employees.png`.
  - "พH" and "พU" in `09-employees.png`.
- **Desktop table truncation.** The employee table truncates names and codes with no other way to see them (`EmployeesScreen.tsx:347,350` `truncate`). `09-employees.png` shows "HR-QA-URL-20261010 · LOCAL-DEM…". Codes may be up to 32 characters (`EmployeeForm.tsx` validator), so the code operators identify people by can be cut off. The mobile cards already wrap (`EmployeesScreen.tsx:196` `break-words`).
- **User impact.** Thai readers see non-word initials on Today, Review and Employees, the three most-used HR screens. Desktop admins can lose part of the identifying code.
- **Minimal change:**
  - In `HrInitials`, skip leading Thai vowels when picking a word's character.
  - Use only the words in the first word's script, so "พH" becomes "พ".
  - Keep the mark `aria-hidden`.
  - In the two `EmployeesScreen` spans, replace `truncate` with `break-words`, matching the cards.
  - Add a unit test for the four observed names.
- **Owned files:** `src/features/hr/HrUi.tsx`, `src/features/hr/EmployeesScreen.tsx`, and a new `src/features/hr/HrUi.test.tsx`.

## Other findings (lower priority)

- **Holiday name field squeezed (screenshot, P2).** At `xl:grid-cols-2` the holiday form's `sm:grid-cols-[12rem_minmax(0,1fr)_auto]` (`SettingsScreen.tsx:211`) leaves the name input about 139 px wide (`16-holidays.png`). That is too narrow for names like "วันหยุดชดเชย (Substitute holiday)". A small fix is to stack the button below the fields, or put a `@container` on the panel.
- **Schedule legend gap (source + screenshot, P3).** `space-y-4` on the fieldset (`EmployeeForm.tsx:357`) adds a bottom margin to the legend on top of `p-4`. That leaves about 50 px between "ตารางงาน" and the first checkbox, versus 16 px elsewhere (`10-employee-edit.png`).
- **Shared time error placement (source, P2 hypothesis).** The combined time error is attached only to the clock-out field (`CorrectionForm.tsx:186`, `ReviewDetail.tsx:607`), even when the problem is "neither side entered" or an invalid start. So `aria-invalid` and the message land on one input. This is not a proven 3.3.1 failure, because native `type=time` rarely produces an unparsable value. Worth confirming with the UX agent before changing anything.
- **Holiday row density (P3).** Holiday rows use `py-1` (`SettingsScreen.tsx:306`) while access rows use `py-2`. Minor list inconsistency within one screen.

## What already works (keep)

- **Focus visibility.** Global `:focus-visible` gives a 3 px ring with offset (`globals.css:245`). Inputs and buttons add `ring-3` with offset. Queue cards and list links have explicit outlines. The `TableScroller` region is focusable and labelled. Deep-link targets get a visible outline, which shows on the holidays panel in `16-holidays.png`.
- **Explicit labels.**
  - Every `FormField` and `SelectControl` has a `Label htmlFor`.
  - Checkboxes are wrapped in their labels.
  - Role toggles, the holiday delete button and the employee edit buttons carry aria-labels that include the person or holiday name.
  - Tabs use `aria-pressed`, and disclosures use `aria-expanded`/`aria-controls`.
  - HR opens no dialogs of its own. The unsaved-work dialog comes from the shared guard (`useWorkspaceNavigationGuard`).
- **Contrast** (computed from tokens).
  - Text pairs all exceed AA 4.5:1: muted/surface 7.58, muted/raised 7.07, warning, pending, success and link on their surfaces 6.16–6.29.
  - The input border (`#808080`) is 3.95:1, which passes 1.4.11.
  - The faint `--border` (about 1.2:1) is used only on containers whose text identifies them, so it is not a proven failure.
- **Touch sizing.** Below 768 px every input, select, button and list link is 48 px (`--spacing-touch: 3rem`). At ≥768 px, desktop controls are 36 px. That is below the 44 px guideline (Apple HIG and WCAG 2.5.5 AAA) but above the AA criterion, 2.5.8 Target Size (Minimum), which requires 24×24 px. No AA target failure is proven.
- **Long text and tables.**
  - `break-words` is used consistently on names, reasons and evidence.
  - The Periods table and period breakdown use `TableScroller` with `min-w-[40rem]` and a scroll hint.
  - Employees switches to cards below `lg`.
  - Times use `tabular-nums` and mono.
- **Motion and structure.** Reduced motion is respected. The simplified structure (focal time cells, a single next action, disclosures for secondary detail) reads clearly in `01`, `06`, `13` and `14`, and these fixes preserve it.

## Needs native-browser verification (root)

1. **Fix 1 at three widths (375, 768, 1280).** After the change, every control in a row is the same height, and mobile stays at 48 px.
2. **Review toolbar after fix 2.** Check 1280 with one site and with several sites (the select appears), and at 375 where the tabs wrap full-width.
3. **Container breakpoint.** At 1024–1279 with the sidebar open, check whether the Review `@3xl` split appears and whether the Employees table (fixed column widths at `lg`) squeezes the 11% edit column or the 10% status column into overflow.
4. **Thai labels at 360–375 px.** Check `HrStatStrip` `dt` truncation (`HrUi.tsx:96`) on period totals, and Today's `truncate` name/code line (`TodayScreen.tsx:163`).
5. **Keyboard pass.** Tab order in the Review split (queue, then detail), and focus landing on the deep-link targets in day, review, period and settings. Also check the shared unsaved-work dialog's focus trap and that focus returns afterwards.
6. **Dark theme, 200% zoom and text-spacing override.** None of these are in the captures.
7. **Touch-capable tablets at ≥768 px.** These get 36 px controls. Guideline only, but confirm usability.

## Proposed implementation ownership (for root lock)

- `src/features/hr/EmployeeForm.tsx`: fix 1 (`items-start` at :237 and :410, select sizing at :533). The schedule legend gap is optional.
- `src/features/hr/HrUi.tsx`: fix 2 (`HrToolbar` :48) and fix 3 (`HrInitials` :186-195).
- `src/features/hr/ReviewScreen.tsx`: fix 1 (:180) and fix 2 (tab group :199).
- `src/features/hr/PeriodsScreen.tsx`: fix 1 (:245) and fix 2 (:271).
- `src/features/hr/EmployeesScreen.tsx`: fix 3 (:347, :350).
- `src/features/hr/ReviewDetail.tsx`, `src/features/hr/SettingsScreen.tsx`, `src/features/hr/PeriodDetailScreen.tsx`: fix 1 select sizing only (:580, :137, :383).
- New: `src/features/hr/HrUi.test.tsx` (initials cases).
- Not claimed: `src/components/ui/select.tsx`. Use it only if root chooses the app-wide primitive alignment; it then needs a storage-layouts visual check.
- No changes to `messages/*.json`, Convex, the manual guide or global design docs.

## Codex synthesis after root native verification

Kiro completed successfully using the actual `/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat` executable, `chat --model claude-opus-5.5 --effort high --trust-all-tools --no-interactive` (exit 0). The prompt and complete transcript are preserved under `output/hr-kiro-improvement-20261010/ui/`. Kiro's independent findings above are retained verbatim. This addendum incorporates new evidence supplied by the root agent after Kiro's screenshot inspection, and narrows the implementation to changes with clear operator impact.

### Selected three fixes

1. **P2: Employee table clips the Edit action at a 1024px CSS viewport, confirmed in the current app.** `EmployeesScreen.tsx:180,187` chooses table/cards by window `lg`; the fixed table at `:319` has no minimum width and the action/status percentages at `:325-326` cannot retain their content once the expanded sidebar consumes the page. Root exclusively used the native T3 browser at 1024×800 with the sidebar settled at 207px. Table width was 766px; action cell width84.28125px; Edit width88.4453125px plus padding. Edit right1011.1640625 exceeds cell/table right999 by12.164px. The full image visibly clips the right side of Edit, and inactive status chips crowd the action. Evidence: `output/hr-kiro-improvement-20261010/root/employees-1024-before.json`; original native image `/Users/macbook/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mv2lf35v-d5352156.png`; unchanged image copy `output/hr-kiro-improvement-20261010/ui/employees-1024-before-native.png` and measured JSON in the same directory. Use the existing cards until the actual content container can fit the table, or a minimum table width with the existing accessible scroller. Keep the established wide table and card design. Also allow employee name/code to wrap rather than hiding identifying text. **Proposed owner/file: UI, `src/features/hr/EmployeesScreen.tsx`.**

2. **P2: Employee form grouping and row consistency.** Add `items-start` on the two parent grids at `EmployeeForm.tsx:237,410` as confirmed independently above. Restore a spacing-bearing disabled fieldset at `:236` with its own intentional sibling gap: the current `contents` wrapper cannot carry the parent `space-y-5` spacing, and the Save row touches the schedule border in `source/10-employee-edit.png` and `annotated/11-schedule.png`. Preserve disabled semantics, all fields, validation and navigation behavior. **Proposed owner/file: UX sole ownership of `src/features/hr/EmployeeForm.tsx`, bundled with its validated field-error fixes to avoid concurrent edits.**

3. **P2: Create Period spacing.** At `PeriodsScreen.tsx:271`, replace the boxless disabled fieldset with a normal `min-w-0` fieldset so the parent `space-y-4` spacing separates the site, date range and action row. `source/12-period-create.png` confirms the range hint crowds the submit row. Keep the range controls and disabled behavior intact. **Proposed owner/file: UI, `src/features/hr/PeriodsScreen.tsx`.**

### Scope decisions

The final UI implementation lock should contain exactly `src/features/hr/EmployeesScreen.tsx` and `src/features/hr/PeriodsScreen.tsx`. EmployeeForm is assigned to the UX owner. Kiro's additional select-density, toolbar alignment and decorative initials suggestions are deferred from this narrow pass: the first two require coordinated shared/cross-screen changes; changing the initials convention has no demonstrated task impact. No new initials unit test is needed for the selected work. No shared primitive, global stylesheet, translation, backend, manual guide or design-context edits are proposed.

Current-app verification confirms the tablet clipping only. Existing manual screenshots remain the evidence for form spacing/alignment; a fresh after-change desktop/narrow screenshot pass is required. Root still owns all browser operations and the final detector. This audit performed no app or test edits.
