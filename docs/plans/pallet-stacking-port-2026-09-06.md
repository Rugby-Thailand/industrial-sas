# Port plan: pallet stacking into the current storage planner

Status: completed in six tested stages on 2026-09-06. Final verification: 493 tests in 58 files, typecheck, lint, production build and desktop/mobile Thai/English UI checks passed. See [implementation report](../../artifacts/stacking-port-2026-09-06/README.md) for stage logs and screenshots.

**Latest scope override:** the user explicitly deferred weight rules. This port does not add stacking weight/load configuration, weight validation, weight correction, or `maxAboveLoadKg`. Existing optional measurement weight stays unchanged. Retain explicit stacking permission, maximum levels, calculated height, collision/clearance checks, support locks and batch compatibility. Any weight-related recommendation below is historical planning context, not part of this implementation.

Stage evidence is saved in `artifacts/stacking-port-2026-09-06/`. Each stage is tested before proceeding: (1) capture/baseline, (2) backend, (3) batch compatibility, (4) UI, (5) combined regression tests, (6) running app/browser/build.

## Worktrees and evidence

- Destination/current app: `/Users/macbook/Development/industrial-sas-storage-planner`, `codex/storage-planner`, HEAD `813f16998bf8f761a8ffbf7432ebf7c1656cbc8b`, plus the current uncommitted preparation-batch implementation.
- Source: `/Users/macbook/Development/industrial-sas-pallet-stacking`, `codex/pallet-stacking`, HEAD `ebf3b8a56d4259f471f87bf98e97bc16cfdc006b`, plus uncommitted stacking changes and new files.
- Source HEAD is an isolation snapshot covering 1,204 files. The stacking implementation is in its working-tree changes, not a standalone feature commit. A branch merge/cherry-pick alone would not bring in those changes and would include unrelated snapshot history.
- Reviewed source documentation: `docs/plans/pallet-stacking.md`. Re-ran the two source stacking test files: **19 tests passed in 2 files**. This verifies the source implementation independently, not the combined port.
- Destination baseline from completed preparation-batch work: **461 tests in 56 files**, typecheck, lint, and build passed. Run a fresh baseline immediately before implementing because both worktrees contain ongoing work.

## Recommended scope

Port pallet-on-pallet stacking: one upper pallet per supporting pallet, server-derived height, configured gross-weight/load/level limits, existing 2D/3D preview, explicit destination verification, and integration with the current move/return workflow.

Initially enable it only for units resolved as `PALLET`. Use the unit's saved format first, the existing legacy product-format fallback where available, and exclude unknown formats. Enforce eligibility in the backend as well as the button/picker. Boxes and other units keep their current storage flow; their stacking rules are outside this port.

Do not add another FG creation or packing flow. Stacking selects already-created, measured, active units from existing batches or individually identified legacy records. Draft batches create no candidates.

## What to port

| Source | Decision | Destination integration |
|---|---|---|
| `convex/schema.ts` stacking additions | Port additive fields/index only | Add optional `stackable`, `maxAboveLoadKg`, `maxStackLevels`; placement `supportPalletId`; index `by_orgId_supportPalletId`. Preserve batch tables, revision history, retirement fields, format, and all current indexes. |
| `convex/finishedGoods/workflow.ts`: `stackChildren`, `validateStack`, top support surfaces | Port rules and geometry with adaptation | Keep every current exported helper and retired-unit lookup guard. Validate every ancestor's accumulated load, levels, stationary stored status, and available capacity. Preserve root floor/rack ceiling and current geometry checks. |
| `stackOptions` | Port query with corrected candidate filtering | Exclude retired, unmeasured, wrong-format, active-move, and otherwise ineligible units; show a useful blocked reason where relevant. Filter the raw warehouse scan, not just `palletOf`. |
| `saveStackingLimits` | Adapt before port | Separate support limits from measurement correction; use the single saved actual gross weight and optimistic version checks. See weight decision below. |
| `reserve`, `validReserved`, `confirmStored`, destination resolution | Port stacking-specific changes | Preserve ordinary floor/rack flow. Match both fixed-support and pallet-support identities; derive Z on the server and revalidate at reserve/confirm. Stack placement requires support identity, upper identity, and physical-placement acknowledgement. |
| `recommendMove`, move reservation/validation/verification/return paths | Port as one coherent change | Keep a lower pallet locked while an upper reservation/placement or move source still depends on it. Release only after upper move completion or valid reservation cancellation; return retains the original stack. |
| `StackScreen.tsx` and `/pallets/[palletId]/stack/page.tsx` | Port new route/screen, adapt to current model | Select current units with product, batch, quantity and status context. Reuse the existing `PalletScene`; retain current format handling and retry scope. No duplicate quantity/dimensions editor. |
| `PalletScreens.tsx` | Port individual sections only | Add Stack on top action, support/upper links and lock explanations, plus stacked put-away identity controls. Keep current batch measurement routing, format-aware text, and Product and batches navigation. |
| `MoveScreen.tsx`, `DestinationScanner.tsx` | Port support-verification additions only | Add scanner `SUPPORT` purpose while preserving current `storageFormat`, unit labels, error handling and move controls. |
| `shared.tsx`, `finishedGoodsApi.ts` | Add entries only | Add stacking errors and two API refs; retain batch errors, `useUnitText`, format-aware `useOperation`, and batch refs. Regenerate generated API types locally. |
| `StackScreen.test.tsx`, stacking integration tests | Port and extend | Adapt fixtures to current detail/schema contracts, then add the batch/stack boundary cases below. |
| `tests/fixtures/finished-goods-ui.ts` | Merge only new fixture properties | Preserve current batch, format, measurement and move fixture data. |
| Source stacking plan/screenshots/test logs | Keep as source reference | Copy useful evidence to a separate port artifact directory, clearly distinguishing source evidence from destination verification. |

## Keep out of this port

- The isolation snapshot commit as a wholesale merge, older product/packing screens, older copies of the workflow/schema, and unrelated deleted files.
- `scripts/dev.mjs` change from port 3100 to 3102. Current app stays on 3100 and its existing backend configuration.
- Source `.env*`, local Convex database, test users/data, node_modules, `.next*`, and other environment-specific output. Never import the source's copied database into the current app.
- Source `PalletScene` or geometry files wholesale: stacking already reuses that control and has no feature diff there; the destination has newer format handling.
- Automatic regrouping/correction of TEST001 or other legacy data, box stacking, overhang, multiple supports per unit, and moving a whole stack at once.

## Required integration fixes

### 1. Retired units must never reappear

The source `stackOptions` scans warehouse units directly and does not filter `retiredAt`. In the destination, a 4-to-2 repack deliberately retains the old measured units for history. A direct copy would list those retired units as stacking candidates even though subsequent writes reject them. Exclude them in queries and retain rejection in every mutation.

### 2. Weight must stay consistent with preparation batches

The source limits form writes `finishedGoodsPallets.weightKg` directly. The current batch editor reads `batch.packages[*].weightKg`, so copying this behavior creates two divergent values and can restore an old weight during a later repack.

Recommended behavior:

- Reuse saved actual gross weight on the stacking page; don't require entering it again.
- Save stack permission/load/level settings separately.
- If weight is missing or wrong, provide an explicit **Record/correct actual gross weight** action, audited and guarded by `expectedUpdatedAt` (or equivalent measurement version).
- Treat live unit weight as canonical after creation. Current batch/unit views and the editable repack draft must read those live weights. Preserve past packing revision receipts as immutable historical snapshots; label them as history.
- This correction changes neither quantity nor outside dimensions nor unit count. It cannot operate while reserved, moving, stacked, or supporting another unit.
- Repacking creates new physical units: reset stacking permission/limits on replacements until verified again. Never transfer structural limits silently from retired units.

### 3. Preserve batch and movement protections

Keep the destination's `palletOf` retired guard, exported helpers used by `batches.ts`, metadata-only product save contract, `BATCH_MEASUREMENT_LOCKED`, revision checks, receipt recovery, and current physical-hold checks. Add support-child checks to batch edit/cancel validation as a defensive invariant so an inconsistent cached status cannot retire a support.

Support reservations, move sources and move targets must count as holds. Validate after stale previews, simultaneous reservations, changed settings, pickup, destination confirmation, cancellation and return. Do not unlock a lower pallet merely because its upper pallet has started moving.

### 4. Keep counts and area meaningful

Stacking moves an existing unit; it does not create another unit or change batch totals. Keep the current footprint-union calculation in `convex/model/storageLayout/occupancy.ts`: overlapping XY footprints at different heights should not double-count floor area. Verify 3D collision, rack clearance and footprint totals together.

## Intended UI flow

```text
FG details → preparation batch → measured unit → ordinary put-away
                                                  ↓
Stored supporting pallet → Stack on top
  → view saved gross weight / configure support limits
  → choose eligible upper pallet (product + batch + quantity visible)
  → preview exact XY / computed Z / rotation / loads / ceiling
  → reserve
      ├─ upper awaiting storage → verify support + upper → confirm placement
      └─ upper already stored → existing move pickup → verify support → confirm placement
  → upper shows support link; lower shows upper link + movement lock
  → move top unit away → complete move → lower becomes available
```

The ordinary recommendation screen continues to recommend floor/rack surfaces. Stacking stays an explicit action for this port.

## Implementation sequence

1. **Record exact source and destination state.** Save selected-file hashes and feature patch including untracked files. Check for edits since this review. Preserve the destination's uncommitted work; no whole-file overwrite.
2. **Add schema and contract changes.** Add optional fields/index and regenerate types. Existing records default to stacking disabled; no guessed load limits and no data migration/import.
3. **Integrate backend invariants.** Port support geometry, ancestor validation, reservation/put-away and move/return checks together. Add retired/format filters, support-aware batch guards and the weight-consistency correction.
4. **Integrate UI.** Add the stack route and current-model-aware screen; merge actions, locks, scanner purpose and error entries. Preserve all current preparation-batch and box/other flows.
5. **Run focused regression tests.** Adapt and run the source's 19 stacking tests, then the additional cases below. Review code against the saved feature patch and current batch invariants.
6. **Run full validation and UI QA on the destination.** `pnpm check`, production build, and normal/manual-error/mobile/desktop/Thai/English/refresh flows using dedicated QA records. Record destination screenshots and test logs. Keep the dev server on 3100.

## Acceptance tests for the combined port

- Normal two-level and three-level stacks; cumulative limits checked at every ancestor; original rack ceiling remains authoritative.
- Missing/zero/negative/nonfinite weight or limits, overhang, wrong rotation fit, unavailable area, overload, excess levels, self/ancestor cycle, wrong identity and missing physical acknowledgement rejected.
- Two users reserve the same support concurrently: at most one succeeds. Repeated request/retry/refresh produces no duplicate position or movement.
- Stored support with upper reservation cannot move, change limits or be retired. Cancelling the upper reservation unlocks it. Moving an upper away holds the source until completion; a return leaves the stack intact.
- Create batch 100/25 → 4; repack 100/50 → 2; only the two active units appear in stack selection. Draft rows, retired units, BOX/OTHER units, and cross-warehouse units are excluded/rejected.
- Stack one batch unit: product quantity/count stay unchanged and repacking its affected batch is blocked. Independent batches still behave independently.
- Correct weight: unit, current batch view/editor and stack validation agree; stale correction fails; immutable history remains unchanged; dimensions/count/quantity remain unchanged.
- Repacked replacement units have no inherited stacking permission. TEST001 remains individually identified legacy data and is not automatically altered.
- Stacking/moving does not double-count floor footprint; 2D/3D, list, batch detail and stored-position detail agree.
- Existing floor/rack placement, box/other wording, batch recovery, same-batch 4-to-2 replacement, source/destination verification and no-access flows still pass.
- Desktop and 390px mobile: reachable actions, readable locks/errors, no horizontal overflow, correct Thai/English labels and refresh/navigation behavior.

## Completion boundary

The source feature is suitable for reuse after these adaptations. Source tests passing is not evidence that a direct copy is safe. Treat the port as finished only when the combined destination tests and browser flows pass. Planning itself changes documentation only.
