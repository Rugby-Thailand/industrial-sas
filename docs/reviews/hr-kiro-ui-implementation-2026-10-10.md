# HR UI implementation — 2026-10-10

Implements the two root-approved fixes from `hr-kiro-ui-audit-2026-10-10.md`.
Modified source: `src/features/hr/EmployeesScreen.tsx`,
`src/features/hr/PeriodsScreen.tsx`. No other source, test, shared primitive or
message file was changed.

## Fix 1: Employees table clipping at 1024 px

Changes:

- The table and card list now sit in a new `@container` wrapper. The table shows
  at `@min-[62rem]:block`, and the cards hide at `@min-[62rem]:hidden`. These
  replace `lg:block` and `lg:hidden`. No resize hooks or new primitives were
  added. The existing `TableScroller` and `table-fixed` colgroup are unchanged.
- Employee cell: `TableCell` gets `whitespace-normal`, overriding the inherited
  `whitespace-nowrap`. The name and the code · site line change from `truncate`
  to `break-words`, and the text column gets `flex-1`.
- Card code · site line: `break-words` added. The card name already wrapped.

Reason for the 62rem threshold, based on the native capture
(`employees-1024-before-native.json`):

- At 1024 px with the sidebar expanded, the content is 766 px wide, so cards
  are used and nothing clips.
- At 1280 px with the sidebar expanded, the content is about 1280 − 207 − 51 =
  1022 px (`PageContainer` caps at `max-w-7xl`, which is wider). That is above
  62rem (992 px), so the table stays. 64rem (1024 px) would have switched
  1280 px to cards.
- The Edit column is 11% of the table. The Thai button (88.45 px) plus `px-2`
  needs about 104.5 px. At 992 px the column gets about 109 px. At 60rem it
  would get about 105.4 px, which leaves too little margin.

Unchanged: all table and card content, button labels, `aria-label`, `onEdit`
handlers, the `disabled={editing !== undefined}` state, URL-backed editing and
the navigation guard.

## Fix 2: CreatePeriod form spacing

`<fieldset disabled={write.locked} className="contents">` became
`className="min-w-0"`. The fieldset now generates a box, so the form's
`space-y-4` separates the site, date-range and action groups. `min-w-0`
overrides the fieldset's intrinsic `min-inline-size`. `DateRangeFields` renders
a single root, so no inner spacing was needed. `disabled`, the handlers, the
query, mutation, guard and retry behaviour, and the select density are
unchanged.

## Targeted checks

Commands and outputs are in `output/hr-kiro-improvement-20261010/ui/`.

| Check                                                                                 | File                            | Exit |
| ------------------------------------------------------------------------------------- | ------------------------------- | ---- |
| `prettier --check` (before `--write`, EmployeesScreen reindent)                       | `impl-prettier-precheck.txt`    | 1    |
| `prettier --write` (only these two files)                                             | `impl-prettier-write.txt`       | 0    |
| `prettier --check`                                                                    | `impl-prettier-check.txt`       | 0    |
| `eslint … --max-warnings=0`                                                           | `impl-eslint.txt`               | 0    |
| `vitest run --project unit src/features/hr/PeriodsScreen.guard.test.tsx` (3/3 passed) | `impl-vitest-periods-guard.txt` | 0    |

Tailwind 4.3.3 was confirmed to emit `@container (width >= 62rem)` rules for
the new variants. The diff against the backup is in `implementation-diff.patch`,
and the hashes are in `implementation-after-hashes.json`. The test file was not
modified.

## Not verified here

No visual verification was performed, and no visual pass is claimed. The root
owns the native checks:

- 1280 px, sidebar expanded: the table is shown and the Edit button is not
  clipped.
- 1024 px, sidebar expanded: cards are shown and fully usable.
- Mobile: the existing cards are unchanged, and long names, codes and sites
  wrap.
- Periods create form: the site, date-range and action groups are spaced.

The two `before-implementation/` snapshots now use `.tsx.baseline` filenames so TypeScript excludes them. Their bytes and hashes are unchanged, and `implementation-before-hashes.json` records their current `snapshot_path`. The nine-file rename proof is `output/hr-kiro-improvement-20261010/ui/evidence-snapshot-rename-proof.json`.
