# Correction improvement loop — 2026-09-07

Worktree: `/Users/macbook/Development/industrial-sas-storage-planner`  
Branch: `codex/storage-planner`  
Running app: http://localhost:3100

## Completed changes

1. **Direct unit correction.** Pending batch units now open their exact packing/dimensions editor from the unit details page, recommendation correction links, and awaiting-measurement batch rows. This removes the standalone-measurement notice/batch-page detour. Legacy units retain their existing measurement form. Protected/read-only units remain view-only.
2. **Protect work in progress.** Dirty packing edits prompt Keep editing/Discard when closing, pressing Escape, clicking outside, or following a Storage link. Switching editor tabs preserves inputs without a warning. Restoring the original values closes immediately. Saving blocks dismissal and navigation; failed saves retain inputs and retry state. Browser unload uses the existing unsaved-warning hook.
3. **Recover from stale links.** Missing/retired/locked targets never fall back to editing the whole batch. The unavailable-unit notice receives focus and scrolls into view once. Manual selection clears the error. URL, product, warehouse and permission transitions clear obsolete editors.
4. **Fix close timing.** Live Thai mobile testing exposed an editor reopening while Next's search-parameter hook caught up with the removed URL parameter. Consumed requests now remain marked during that gap and stale hook requests are ignored. Closing retains unrelated query parameters and hash.

5. **Isolate correction sessions.** Changing unit, warehouse, product, batch or requested editor mode mounts a fresh editor, preventing local dialog/draft state from leaking between targets. Three stateful regressions reproduced the problem before the fix.

## Browser verification

- Desktop English, 1728 × 996: details → Measure box → exact editor P-000023 in one click.
- Height 0.25 → 0.3 → Close → Keep editing: 0.3 retained.
- Storage tab → Unit details → Keep editing → editor: 0.3 retained.
- Storage tab → Unit details → Discard: opens the exact unit details route.
- Restore 0.25 → Close: closes immediately without a discard prompt.
- Thai mobile, 390 × 844: translated confirmation, no horizontal page/dialog overflow (390 page; 356 client/scroll width inside dialog).
- Thai mobile close race reproduced, fixed and retested: no dialog after closing or refreshing.
- Unavailable target: no editor; alert focused and visible at scrollY 504 on desktop.
- Final browser error log: empty.

No database mutations were saved in this round. QA product remains 210 pieces: 3 boxes + 2 pallets. P-000023 remains 10 pieces, 0.4 × 0.3 × 0.25 m. Existing stored positions are unchanged. Weight rules remain deferred.

## Recordings and screenshots

- `01-direct-correction-final.mp4`: direct correction, clean close and refresh.
- `02-protect-packing-edits.mp4`: keep edits, tab switch, guarded navigation and explicit discard.
- `direct-editor-desktop.png`, `direct-editor-mobile-th.png`
- `unsaved-warning-desktop.png`, `unsaved-warning-mobile-th.png`
- `unavailable-unit-recovery.png`
- `browser-checks.json`, `browser-errors.json`

Videos are actual browser screenshot recordings encoded as H.264, 10 fps, without audio. They show UI interactions; no warehouse movement was physically performed. Earlier intermediate recording files are retained for audit, but the gallery uses only final recordings.

## Validation

**Final result: 634 tests passed across 63 files; TypeScript, full lint plus final scoped lint, production build, and whitespace checks passed.**

Final verification is recorded in `tests-final.log`, `typecheck.log`, `lint.log`, `build-final.log`. Full suite includes quantity conservation, 4 → 2 repacking, retired units, placement locks, reservations, collisions and storage move rules. New component tests cover dirty/clean/pending/error states, retries, stale query timing, readonly scope, delayed data and unavailable targets. Browser refresh prompts and pending network timing are covered by component tests; the live browser exercised clean refresh, navigation, and dirty-dialog behavior.

## Remaining limitations

A forced browser termination can still lose an unsaved correction; this round adds warnings, not persistent draft recovery. The current authenticated QA account was used for live checks; read-only permission transitions were tested in components. This is a completed correction-focused pass, not a claim that every possible UI improvement is exhausted.
