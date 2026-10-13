# Coordinator audit against production main 59fb1d13

- ROOT-03 partly fixed upstream: current operations use committed tickets and onSuccess, guarding pending replies. However a callback retained from scope A revived after A→B→A: capture/acquire compared scope text and sampled the new generation. Added a deterministic regression (red: stale run returned stale-document instead of null). useOperationLifecycle now binds callbacks to a memoized scope-visit owner committed through the existing insertion effect, preserving abandoned-render and StrictMode behavior. Guarded stale request clearing; regression checks stale run, navigation, errors and request IDs. Initial 21 hook/request tests passed; final extended 18-hook run below.
- ROOT-03 real caller: new-building draft was retained when its warehouse changed externally. Keyed NewBuildingContent by warehouse; test explicitly replaces warehouse during pending A write, creates a B draft and verifies A cannot navigate or clear it. Shared + actual storage caller suite: 3 files / 53 tests passed.
- ROOT-04 already fixed upstream by shared useSheetHandoff and current FloorMap; preserve source and all delayed native traversal/exit-focus tests.
- Public compatibility: ported sound ID-to-string argument widening comparator and narrowing/return safety regression; updated registered recovery API example and tenant denial coverage: 203 tests pass. Snapshot refresh refuses breaking changes; 10 compatibility tests pass without override.
- Existing production build and browser pipeline retained. Origin/main is 63 commits beyond initial source; only missing fixes are adapted on a clean current-main worktree. Original dirty workspace untouched. Repo STAGING_ENABLED=false is preserved; automatic production pipeline still requires quality/security checks, snapshot backup, candidate and live read-only smoke.

## Final coordinator follow-ups

The extended workflow callback regression passes 18/18 hook cases. ROOT-05 now preserves later query/hash edits while an invalidated foreground consumes its native entry. Its real Records caller and related navigation suites passed 64 tests; a held-native-Back regression separately verifies every typed character, locale, source query and hash. The prior retry test waits for its successful native history consumption before the next test starts.

The staging storage flow now reads the newly created pallet and submits its loaded updatedAt as the measurement precondition. Its 20 registered integration cases pass. This is local fixture verification, not an authenticated staging deployment claim.

## Browser fixture hydration follow-up

The first CI attempt on `972d93c2` passed all quality checks except one WebKit Close → refresh → native Back case. The unchanged source passed 20 repeated local WebKit cases and the bounded CI re-run. A controlled fresh-document React scheduler hold reproduced the exact failure and identified the cause: Close consumed the editor's history index 2 → 1 correctly; Back before hydration reached the previous page at index 0; Next's initial canonical-URL replacement then rewrote that entry to the storage URL. The server-rendered heading was visible before the router's history listeners were ready.

The isolated navigation fixture now publishes an explicit readiness marker from a commit scheduled after its initial passive effects. The storage browser test waits for that marker after reload before native Back. Every existing Close/Cancel, query/hash, selected location, no-replayed dialog and exact previous-page assertion remains intact. No production navigation code, arbitrary delay, retry policy or timeout changed. The controlled scheduler probe is retained outside the repository as diagnosis evidence; it is not part of the production app or ordinary test suite.

This correction verifies hydrated application history. Native Back before the framework finishes hydration remains a documented framework limitation, not a claimed production fix.
