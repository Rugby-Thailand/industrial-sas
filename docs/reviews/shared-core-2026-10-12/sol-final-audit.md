# GPT-6.1-Sol final delivery source audit

**Approved for the reviewed source scope: 0 confirmed remaining defects.** No further hypotheses were explored. This pass made no repository/source/git/environment edits.

Snapshot: HEAD `25ae4ad8` plus only the inspected provider and guard-regression change. Exact source fingerprints:

- `NavigationGuardProvider.tsx`: `df1ac273c404c0324c208b9f495b44569e21492f601587d15730c4dbdfeeb061`.
- `useBrowserQuery.guard.test.tsx`: `dd67126916f7c5ee545c5f97e1fd6395731a05af97f3e9f6fc2d413d91d0c7a1`.

## Final confirmed result

Independently reran the original outside-repository actual-provider fixture: dirty floor-2 list view → actual `useFloorWorkspaceView().setView("map")` replaces the buffer query → unmount and mount clean → first native Back. It now reaches prior committed floor 1 in the URL and both readers, with no dialog and no Back during mount.

**1 test / 1 passed.** Log: `/tmp/shared-core-sol-dirty-view-clean-reload-green.log`. Original red evidence remains `/tmp/shared-core-sol-dirty-view-clean-reload-red.log`; unchanged independent fixture is `/private/tmp/shared-core-sol-probe/dirty-view-clean-reload.test.tsx`.

```sh
pnpm exec vitest run --config /private/tmp/shared-core-sol-probe/vitest.config.mts dirty-view-clean-reload.test.tsx
```

The outside config sets `maxWorkers: 1`. Kiro also ported the meaningful actual-setter regression to `src/hooks/useBrowserQuery.guard.test.tsx:259`.

## Narrow change review

`samePage()` compares origin and pathname, allowing the orphan and its base to differ in presentation query/hash. The other orphan checks remain: the previous entry was a known orphan, the landed entry is unmarked, its marker differs from the orphan and its committed app depth matches. Normal earlier query entries have different tracked depths and therefore are not mistaken for this internal base; different routes/origins also do not match.

No mount traversal or timeout was introduced. The existing history-menu destination capture, buffer restoration and permitted target-depth traversal are unchanged. The test-only helper now exposes the actual Map setter; all earlier fixture behaviors are retained.

The previously reported packing, refusal-field, remount, dirty/clean reload, index-zero, farther-history-menu and object-link findings are resolved in the reviewed source and existing regression evidence. The earlier `/tmp/shared-core-sol-post-rebase-audit.md` is preserved as historical review state, including its subsequently superseded finding.

No heavy suite, build or browser was run in this focused pass. Real browser reload/navigation behavior and final full-check evidence remain root-owned for delivery.
