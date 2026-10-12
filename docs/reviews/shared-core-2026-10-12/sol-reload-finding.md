# Actual view replacement followed by clean reload

**1 confirmed P2 in the exact requested sequence.** No further hypotheses were explored, and no repository/source/git/environment edits were made.

The outside fixture uses the actual `useFloorWorkspaceView().setView`, real provider, committed query readers, tracker and native queued history traversal:

1. Committed floor 1 → committed floor 2 (`panel=list`) → dirty guard buffer at floor 2/depth 1.
2. Click the fixture button calling the actual `setView("map")`. The current guard entry is replaced with `/planner?floor=2#map`, still depth 1.
3. Unmount and mount a clean provider with no draft registration, representing reload that lost React-only unsaved state. Mounting makes no Back call.
4. Press Back once. **Expected** prior committed `?panel=map&floor=1`; **actual** old unmarked base `?panel=list&floor=2`. Both readers show the old floor-2/list view.

Cause: `NavigationGuardProvider.tsx:552` requires `window.location.href === left.href` when skipping an orphan's base. The presentation replacement updated only the buffer, so its original base and current buffer still represent the same app entry/depth but have different query strings. Exact href equality prevents skipping that internal base.

Minimal intended behavioral regression is preserved outside the repo at `/private/tmp/shared-core-sol-probe/dirty-view-clean-reload.test.tsx`: “takes the first Back past a clean reload buffer whose actual view setter replaced its query”. It verifies the actual setter, unchanged depth, no traversal on the clean mount, one user Back, final URL/readers and no guard dialog.

Evidence: **1 test / 1 failed**, `/tmp/shared-core-sol-dirty-view-clean-reload-red.log`.

```sh
pnpm exec vitest run --config /private/tmp/shared-core-sol-probe/vitest.config.mts dirty-view-clean-reload.test.tsx
```

The outside config sets `maxWorkers: 1`. Provider snapshot SHA-256: `249b5074f6ce8ff90192324f42a708299803469c1e2a2e3a6085a2351d4ac201`.

The earlier no-reload presentation/Back fixture remains a separate passing case; this report adds only the requested clean-reload continuation. Real document reload and browser timing remain root-owned.
