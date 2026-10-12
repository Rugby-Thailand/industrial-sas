# Final URL core audit

Result: **No confirmed remaining issues in the audited URL core.**

Reviewed the worktree `/Users/macbook/Development/industrial-sas-shared-core-20261012` against accepted plan revision 2 and commit `2ed6bfd3`. The eight production URL-core files listed below have no uncommitted differences from that commit at the audit snapshot. Pending frontend workflow edits and the planned main rebase are outside this result.

## Scope

- `src/hooks/useCatalogueUrlState.ts`
- `src/lib/browser/history.ts`
- `src/hooks/useBrowserQuery.ts`
- `src/hooks/useQueryHistoryWriter.ts`
- Finished-goods and location catalogue adapters
- Workspace query and floor presentation readers
- Existing behavior tests, the two real caller scope constructions, browser storage, and the guard bridge's final-commit event contract

## Assessment

The shared catalogue hook removes actual duplicated caller behavior: snapshot selection, scope fallback, baseline pinning, no-op comparison, preference writes, and typing history. Feature adapters retain their validators and existing query/preference formats. Finished goods keeps compact optional `fg` JSON and legacy single-status migration; locations keeps complete validated `locations` JSON. Neither storage keys nor cursor-pagination behavior was rewritten.

Updates decode the latest committed snapshot rather than a render's stale state, preserving sequential updates. Scope changes select fresh preferences before rendering the new scope; they do not depend on a passive effect. The server/hydration snapshot explicitly decodes defaults, then applies browser preferences after the external-store snapshot changes. The reviewed hydration test uses real `renderToString` and `hydrateRoot` with nondefault persisted preferences.

Query writes retain unrelated parameters, hash, and browser metadata. Semantically unchanged queries use metadata-only `replaceState` without a URL, so they keep exact query encoding, Next markers, and Back depth. Changed writes let Next's patched History API synchronize the URL.

The committed store caches only the latest URL and scalar entry markers, compares marker values for stable snapshots, and leaves router trees/cursor objects in actual browser history. Internal guard traversal freezes both query and scope through unrelated renders. Common final-commit events refresh readers after the guard clears its signal. Feature/common notifications are deduplicated; permitted real `popstate` still always notifies, including identical query or metadata-only scope changes.

Typing preserves the 1000ms grouping window, separates scope changes, and ends on permitted Back/Forward. Own writes install their new typing marker after synchronous notifications, while internal restoration is suppressed by the shared subscription.

## Limits

This was a read-only source/test audit; no tests or browser session were run, and no repository, test, git, dependency, or environment files were changed. Only this report was written. Root owns final checks and real browser verification, including the separate provider's history-menu and asynchronous remount handling. Earlier provider defects are not reported as current URL-core defects here, and this report does not claim those pending frontend flows are already verified. Recheck integration after the planned rebase if it changes the audited files or event contract.
