# HR correction 1 — History date editing (P2)

Worktree: `/Users/macbook/Development/industrial-sas-ux-flow-20261015-hr` (uncommitted, not pushed). All earlier HR implementation changes are preserved.

Read before changing code: `AGENTS.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`, `docs/contracts/back-navigation.md` and the History/`useHrListCriteria` entries in `docs/contracts/back-navigation.json`.

## Cause

`HistoryContent` derived the displayed From/To directly from the URL criteria. Clearing a bound wrote `from=` to the URL, the ISO check failed, and the current-month fallback was rendered into both fields (`2026-10-01`/`2026-10-15`). This both lost the edit and replaced its counterpart.

## Fix (`src/features/hr/HistoryScreen.tsx`)

The URL holds the last complete range; the date inputs hold the field edit in progress. No global or architecture change.

- `fields` uses the existing `useUrlBackedState` helper and is keyed to `${entry}|${from}|${to}`, where `entry` is the history-entry marker that `useHrListCriteria` already returns.
- `editRange` (From/To inputs) always updates `fields`. It writes the URL (as a typing entry) only when both bounds are `YYYY-MM-DD`. A cleared or incomplete bound stays local, so the URL and the query keep the last complete range and the counterpart is never replaced.
- `setRange` (month picker) sets `fields` explicitly and writes the URL. Picking the month the URL already holds therefore still clears a partial edit.
- Any URL change (a complete edit, a month pick, Back/Forward to another entry, a remount) changes the key, and `fields` is restored from the URL. An unfinished edit cannot survive traversal.
- Validation is unchanged. The month value comes from the displayed fields. Malformed or partial direct links still fall back to the current month. Any complete range, including reversed or over-long ranges, still goes to the server, which validates it as before. The status filter is untouched.

## Tests (`src/features/hr/HrListReturn.test.tsx`)

- I kept Codex's regression `retains a cleared History date while editing without replacing the other bound` and made it stronger. While From is empty, it now also checks that the URL search and query arguments stay on September. After completion, it checks the URL `{source: "audit", from: "2026-09-05", to: "2026-09-30"}` and `#days`.
- New `it.each` (en/th): `%s History keeps a cleared To bound local; a month pick, native Back and remount restore the URL range`. It covers:
  - clearing the opposite (To) bound while From is kept and the URL/query are unchanged;
  - re-picking the same month to restore To;
  - a complete To pushing its own entry while query and hash are preserved;
  - a partial From edit being discarded by native Back, which restores the previous entry's fields;
  - Forward restoring the edited entry;
  - a remount reading only the complete URL range.
- The new cases fail when the fix is removed. I temporarily rendered the URL `range` and wrote it straight to the URL again: 3 failed, 4 passed. With the fix restored, 7/7 pass.

## Inventory (`docs/contracts/back-navigation.json`)

- The navigation checker flagged the new state. I added an exact presentation entry, `src/features/hr/HistoryScreen.tsx#HistoryContent:fields` (`uses: ["url-state"]`, no render branches). Its expectation describes the behaviour above, and its evidence is the two literal case titles.
- The `hr/time` route policy now also lists those two cases, and its expectation now describes the local partial-edit behaviour.

## Verification

- `pnpm exec vitest run src/features/hr/HrListReturn.test.tsx -t 'retains a cleared'`: 1 passed.
- `pnpm exec vitest run src/features/hr/HrListReturn.test.tsx`: 7 passed.
- `pnpm exec vitest run src/features/hr`: 34 files, 352 tests passed.
- `pnpm check:navigation`: 68 fixtures passed. Contract OK (58 route/error policies, 294 state/overlay owners, 26 action intents).
- `pnpm lint` (`eslint . --max-warnings=0`): exit 0.
- `pnpm typecheck:ts6`: exit 0.
- `prettier --check` on all changed and untracked files: clean.

Not run: the full Vitest suite, `pnpm typecheck` (Bun checker) and the browser build. These are left for the parent's final integration checks.

Limit: clearing a bound on a URL with no range (the current-month fallback) uses the same path but has no dedicated case.
