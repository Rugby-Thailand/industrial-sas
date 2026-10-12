# Shared write lifecycle audit

Base: `/Users/macbook/Development/industrial-sas-shared-core-20261012`, origin/main `a050a851`. Read-only production inspection; no repo files changed or environment files read. The temporary harness imports production hooks and mocks only HR access. Four focused reproduction tests passed in 877 ms: **passing means the defect reproduced**. Harness: `/tmp/shared-core-lifecycle-audit/audit.test.tsx`.

## Confirmed defects that belong in the plan

1. **Finished-goods operation success remains actionable after scope change.** `src/hooks/useAsyncOperation.ts:66` returns `await action()` without checking the scope generation or mounted state. The existing test at `useAsyncOperation.test.tsx:28` checks busy/error isolation but never checks the returned result. Packing then persists a batch and navigates at `PackingScreen.tsx:573–604`; scan/record callers likewise clear current UI from a returned success. Reproduction: start scoped A, render B, resolve A; result is still `saved-record-a`. Public seam test should expect `null` and no completion callback/navigation.

2. **Post-await effects inside the action bypass any return-value fix.** Product (`ProductScreen.tsx:277–312`), measurement/release (`PalletScreens.tsx:350–380`, `900–910`), placement (`PlacementEditor.tsx:280–328`), stacking (`StackScreen.tsx:188–220`) and building creation (`StorageLayoutScreens.tsx:381–394`) navigate or persist inside `run(async () => ...)`. Reproduction: unmount while an action is awaiting its mutation, settle it, and its navigation still runs. Move these effects to a current-success callback seam or after a current-only result; merely returning `null` after `action()` is insufficient. Domain validation and the server call remain in the action.

3. **HR's equality-only current-scope check permits A → B → A stale success.** `useHrWrite.ts:150` and clock `:377` compare current scope text only. Both reproduced a `SAVED` result and receipt after a committed intervening intent/organization switch and return to A. Use a committed scope generation as well as equality, while preserving request ID settlement and pinned uncertain commands for their original scopes. Existing HR tests cover A → B; add A → B → A. Clock recovery tests already require uncertainty to be cleared on account/org/employee switch; this late receipt is a separate missing case.

## Small shared seam with real callers

Introduce a private `useOperationLifecycle(scope)` used by `useAsyncOperation` and `useHrWrite`. It should own mounted/committed-scope generation and per-intent duplicate acquisition. An acquired ticket exposes `isCurrent()` and `finish()`; release must not clear a newer ticket. `useAsyncOperation` maps stale completion to `null`, HR to `IDLE`. Keep each domain's busy/outcome state and retry policy outside this primitive. The clock hook can use the same current-completion generation while retaining its stricter serial lock and durable descriptor.

Add optional `run(action, onSuccess)` to `useAsyncOperation`, with `onSuccess` invoked only after a current success and release. Migrate actual internal side-effect callers. The callback remains sync (or its synchrony is documented) so no hidden async gap reintroduces stale side effects. For save → navigate, coordinate the callback with the navigation owner's explicit release/continue interface; do not guess with timers. An alternative after-`run` migration is safe only if every caller consistently checks `null` and the shared guard solves cleanup ordering.

Regression checks: duplicate same intent; separate hooks/scopes remain independent; rejected/stale results do not change current error state; no late callback after unmount or A → B → A; stale `finish` leaves new busy state intact; StrictMode replay; two actual screen callers' mutation → draft clear → navigation order.

## Request IDs and persistence scope

`useRequestIdentity` and HR `requestId()` duplicate memory fallback, validated restoration, UUID allocation and persistence. Share a narrowly scoped identity registry with persistence adapters, retaining the exact existing formats: FG local-storage bag `fg-requests:<scope>` with per-payload UUID entries; HR session-storage scalar `hr-request:<identity>|<intent>` with its ID validator. FG keeps explicit `clearRequests()`. HR clears after a definite result except DENIED and pins the exact command after UNCERTAIN. No automatic retries; do not persist generic HR form payloads. Clock `hr-clock-command:v1` stays domain-owned with its strict six-field decoder and tab fallback.

`useDraftKey.ts:11` yields only `feature:userId`. Most FG callers append warehouse/record IDs, which already prevents collisions between globally unique warehouses; therefore do not claim demonstrated wholesale cross-org draft leakage. The hook itself does not carry org identity and can stay unchanged while ownership is agreed. If changing it, add org scope without migrating ambiguous actor-only legacy keys, and test explicit logout/org/actor transitions. Do not use frontend storage as server authorization.

## Backend conclusion

Storage writes already use `mutationWithOrg`, `writeContextOf`, `createMasterDataRow`/`updateMasterDataRow` and shared replay checking. Scan uses `mutationWithOrg` plus finished-goods `command`; HR uses `hrCommand` and shared idempotency. Those domain envelopes differ in replay reconstruction, response extras, actor fingerprints and auditing; unifying them would widen this PR and risk behavior. No backend rewrite is needed for the confirmed navigation/lifecycle defects.

One follow-up observation, not a confirmed navigation bug: `workflow.ts:136–138` fingerprints actor identity for operation prefixes `finishedGoods.move.` and `finishedGoods.scan.`, while job-scan mutations use `finishedGoods.jobScan.*`. Replaying a deliberately reused request ID across actors needs a dedicated contract test before changing that policy. Keep it outside this scoped implementation unless separately justified.
