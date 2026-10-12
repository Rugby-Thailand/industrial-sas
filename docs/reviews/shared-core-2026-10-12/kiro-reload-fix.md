# Last reload case: a view setter changed the buffer's query before a clean reload (Kiro)

Base: HEAD `25ae4ad8`. I changed only the two files in scope. I made no git, env, dependency or other edits, and committed nothing. The other dirty files (`src/hooks/useBrowserQuery.test.tsx` and the new files under `docs/reviews/…`) are not mine and are untouched.

## Red first

I added "takes the first Back past a clean reload buffer whose view setter replaced its query" to `src/hooks/useBrowserQuery.guard.test.tsx`. It reproduces Sol's audit case with the real `NavigationGuardProvider`, the real `useFloorWorkspaceView().setView` and the real history tracker:

1. The draft is dirty on floor 2 with `panel=list`.
2. "Show map" calls `setView("map")`. That replaces the buffer entry's URL with `?floor=2`; depth stays 1 and the guard marker is kept.
3. The editor unmounts, which stands in for a reload dropping the draft, and a clean provider mounts. No Back fires on mount.
4. The first `history.back()` must reach `?panel=map&floor=1`, in both the URL and the readers, with no dialog.

To drive the setter, the shared `Workspace` fixture gained one "Show map" button. No existing test uses it.

Before the fix the test failed: it got `?panel=list&floor=2` (1 failed, 10 passed). Log: `/tmp/shared-core-kiro-evidence/red-dirty-view-clean-reload.log`.

## Fix (`src/components/navigation/NavigationGuardProvider.tsx`)

`skipOrphanBase` used to require the base entry's full href to equal the orphan's. A query-only replacement on the buffer, such as the presentation panel, changes the buffer's search but not its base's. The base is now identified by:

- the orphan marker no longer being present on the current entry,
- the same document route, via a new module helper `samePage(a, b)` that compares only origin and pathname,
- the same committed `appNavigationIndex` as the orphan.

Everything else is unchanged:

- Unknown or external entries without a depth stamp are never skipped.
- A farther pick from the Back menu lands at a lower depth, so it is not skipped and keeps its destination.
- Abandoned markers stay excluded.
- Nothing traverses on mount, there are no timers, there is no new local guard, and no Next tree or payload is cached.

## Verification

Focused Vitest run with `--maxWorkers 2` passed 24 files and 206 tests. It covered:

- `useBrowserQuery.guard` (11/11) and the rest of `src/hooks`
- `src/components/navigation` and `src/components/providers`
- `NavigationProgress`, `src/lib/browser` and `src/i18n`
- `JobScanGuard`, `StorageLayoutScreens` and `PeriodCreateGuard`

Log: `/tmp/shared-core-kiro-evidence/green-dirty-view-clean-reload.log`.

On both files, `eslint` exits 0, `prettier --check` is clean and `git diff --check` is clean. The TS6 type check (`tsc --noEmit -p tsconfig.json`) exits 0. I ran no build, no full suite and no browser check.

## Source hashes (SHA-256)

- `src/components/navigation/NavigationGuardProvider.tsx`: `df1ac273c404c0324c208b9f495b44569e21492f601587d15730c4dbdfeeb061`
- `src/hooks/useBrowserQuery.guard.test.tsx`: `dd67126916f7c5ee545c5f97e1fd6395731a05af97f3e9f6fc2d413d91d0c7a1`

## Limitation

The skip still handles a single duplicate buffer directly above its base, which is what the provider creates. Real-browser confirmation of the first Back after a Scan or floor-view reload remains with the root.
