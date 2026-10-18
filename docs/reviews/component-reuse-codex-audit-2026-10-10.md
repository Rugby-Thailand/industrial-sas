# Component reuse: Codex audit and delivery

Kiro implemented all five adoption phases of the [approved plan](../plans/component-reuse-and-ux-consistency-2026-10-10.md), then opened and audited all 81 initial desktop/mobile screenshots and eight original design-sheet references. One bounded Kiro improvement batch addressed its concrete findings. Tailwind v4, the existing component directories, themes and original `docs/design-sheet/sheet.js:417` remain the foundation.

## Shared ownership

`globals.css` owns the 48px touch / 36px dense scale, field/control focus and spacing. The only dense condition is at least 48rem with a fine pointer. Button/Input/Select, FormField/FieldGroup, SectionHeader/Panel, SearchField/SegmentedControl, StatusBadge/Notice, CollapsibleSection/ConfirmDialog, DescriptionList/EmptyState and TableScroller/DataTable provide shared presentation. Shared catalogue copy and locale-aware measurement formatting each have one owner.

Production import-graph inventory counts direct JSX uses, including shared consumers; adapters and indirect uses are not inflated:

| Component          | Consumer files | Uses |
| ------------------ | -------------: | ---: |
| FormField          |             16 |   34 |
| FormSelect         |              9 |   13 |
| FieldGroup         |             13 |   19 |
| Panel              |             27 |   68 |
| SectionHeader      |             28 |   55 |
| SearchField        |              7 |    7 |
| SegmentedControl   |              6 |    7 |
| StatusBadge        |             13 |   15 |
| CollapsibleSection |              5 |    7 |
| DescriptionList    |             17 |   19 |
| EmptyState         |             16 |   16 |
| ConfirmDialog      |              4 |    4 |
| TableScroller      |              8 |    8 |
| DataTable          |              3 |    3 |
| Button             |             65 |  262 |

Feature modules retain permissions, writes, retries/request IDs, date rules, camera operations and scene geometry. Specialist SVG handles, native colour wells, camera shutters, table footers/comparison tables and unit-entry labels remain intentional exceptions. Unrelated bilingual feature terminology has not been rewritten.

## Codex audit and corrections

Independent Standards and Spec reviewers checked the exact starting bytes, implementation and concurrent root changes. The final behavior review found no new concrete regression. The final Standards review found one planner sort action fixed to 36px; removing its CSS height restored shared 48/36 sizing, confirmed on reread.

Codex corrected the server/client Button split and static variants, blocked slotted pending/disabled activation, retained selected-option side effects through `onOptionActivate`, preserved navigation focus and disclosure mounting policies, and replaced remaining ordinary control size overrides. Field scanning, photo removal and theme-toggle hit areas now follow shared sizing. AccountButton composes static variants without padding/borders expanding its dense avatar target. SceneToolbar lets shared Button own control presentation.

The final UI pass keeps neutral scan fields until their first group blur, accessible hidden table captions, truthful pending/unsaved dialog copy, one native summary indicator, shared HEX errors, full names and monospaced codes. The planner keeps its original scale-bar and zoom calculations; only the floor-width annotation moves to avoid the scale box. Zero-argument `Intl.NumberFormat` now also fails the locale drift rule.

The Impeccable detector ran once against all 142 changed markup/style files after source fixes: exit 0, no findings. Its JSON is in `output/cr-logs/codex-final-detector.json`.

## Integration

The task was isolated with the starting dirty/untracked files preserved as exact-byte baseline. Concurrent root HR validation, focus, search-loader, compact locale, disclosure and responsive table work was reconciled before delivery. Fifteen overlapping conflicts received reviewed exact-hash resolutions; five clean three-way merges retained both sets of edits. All 163 task paths were applied with per-file checks and private exact-byte backups. No commit, push, deployment, schema change, seeding or real application write was performed.

The merged dependencies passed 75 guard/HR tests, 37 search-loader tests and 11 locale tests before integration. Kiro's final UI batch passed 113 files / 1,052 tests, typecheck, lint and scoped formatting.

## Final verification (merged application, 2026-10-11)

| Check                                | Result                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                         | **Pass**: repository formatting, TypeScript, ESLint, 241 files / **2,876 tests**                                          |
| `NEXT_DIST_DIR=.next-e2e pnpm build` | **Pass**, default Turbopack, 45/45 static pages                                                                           |
| Source detector                      | **Pass**, 142 changed markup/style files, no findings                                                                     |
| Final production screenshots         | **91 PNGs**: 32 desktop/mobile route pairs plus 27 form, search, guard, planner, theme, English and density confirmations |
| Initial Kiro pixel audit             | All 81 initial images and eight sheet references opened; one improvement batch completed                                  |

The earlier isolated-tree format/test/build limitations were historical. Concurrent root fixes resolved the inherited formatting/fixture failures; the merged deliverable passes the complete check. A separately started duplicate test invocation was stopped when `pnpm check` reached its own full suite. The production build uses an isolated ignored output directory, preserving the existing development/backend servers.

[Final screenshot gallery](../../output/component-reuse-ux-2026-10-10/final/index.html) · [Kiro's per-UI audit and improvements](component-reuse-kiro-ui-audit-2026-10-10.md).

All 91 captures have measured root horizontal overflow = false; all route captures report loading = false and fatal = false. Titles measure 24px/32px at both widths. Employee, product and building fields, and all ten expanded ticket fields, measure 36px at 1440px and 48px at 390px with 2px label gaps. The 767px capture retains 48px fields; 768px and 800px fine-pointer captures measure 36px. These are resized desktop-browser viewports, not physical coarse-pointer hardware.

Physical clicks confirmed the draft prompt remains exposed after 390 → 1440 → 390 resizing, with mobile dialog actions hit-testable at 48px. Keep editing retained the own unsaved edit and returned focus to its name field. Discard reached Today. Browser Back and global search also opened the guard; cancellation retained the edit and accepted search navigation reached Today with no dialog remaining. All own employee edits were discarded. The own blank scan ticket was removed, leaving zero tickets. No Save or application mutation was submitted.

Mobile search transfers focus from the drawer into the shared Input. The loaded account trigger measures 36×36 desktop / 48×48 mobile with zero border/padding. Planner sort measures 48px mobile; focused toolbar search has a 2px outline with -1px offset. Representative final PNGs were opened to confirm forms, neutral scan fields, search, guard and planner annotations.

Verification limits: signed-in `/sign-in` redirects to storage, so those captures verify the authenticated redirect, not the signed-out Clerk widget. Legacy `/floors/1` preview navigation did not complete; final floor-editor captures use the canonical `?floor=1&editing=1` workspace URL. Camera hardware, real writes, uploads, AI submission and every permission/pending state were not exercised through the browser; retained component/feature tests cover their existing contracts.
