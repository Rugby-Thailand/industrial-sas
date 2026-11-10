# Structural dispositions: A02–A08, A10–A12

Base: `origin/main` `de79d7ad`. Source audit (read only): `docs/reviews/architecture-scalability-2026-11-09/report-data.json` in the parent checkout. Each claim was rechecked against current code before any change. A01, A09 and A13 belong to other workers. This file reflects the first pass plus the review-correction pass; command logs are under `logs/correction-*.log` in this worktree.

| ID  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A02 | **CONFIRMED / FIXED for every proved-uncalled endpoint.** Six compatibility or uncalled public functions are deleted. **Residual, CONFIRMED and kept on purpose:** `hr/periods:close` (documented later contract step) and the production-schema compatibility test (production data exists; no reset is authorized). **UNRESOLVED:** whether production still holds legacy placements without coordinates (`storagePlacementGeometry.ts` fallback). |
| A03 | **CONFIRMED / FIXED.** HR tables and validators now live in `convex/hr/schema`, `convex/model` is pure, and a test enforces it.                                                                                                                                                                                                                                                                                                                      |
| A04 | **CONFIRMED / pilot only.** Two functions now have explicit results; 230 of 233 public results still contain `any`. **UNRESOLVED:** `Id` brand erasure in `clientRef` and the shared refusal envelope.                                                                                                                                                                                                                                               |
| A05 | **CONFIRMED / partly fixed.** The backend finished-goods command envelope and record lookups were extracted. **UNRESOLVED:** the storage UI seams below, and HR `shared.ts`.                                                                                                                                                                                                                                                                         |
| A06 | **CONFIRMED / FIXED for shared mechanics.** The receipt digest and replay identity are unified. The differing policies are kept on purpose and documented.                                                                                                                                                                                                                                                                                           |
| A07 | **CONFIRMED / partly fixed.** Four uncalled whole-warehouse readers were deleted. Remaining bounded readers were not re-planned, and no benchmarks were run.                                                                                                                                                                                                                                                                                         |
| A08 | **CONFIRMED / FIXED.** Projection ownership moved from `tenantFunctions` to a declared feature writer, guarded at runtime and by import tests. **UNRESOLVED subclaim:** contention and partitioning were not measured.                                                                                                                                                                                                                               |
| A10 | **CONFIRMED / FIXED.** The runtime navigation import cycle is gone, and the inventory is unchanged.                                                                                                                                                                                                                                                                                                                                                  |
| A11 | **ALREADY RESOLVED (staged close) / FIXED (missing over-limit test).** The limits are documented. **UNRESOLVED:** production measurements.                                                                                                                                                                                                                                                                                                           |
| A12 | **CONFIRMED / docs only.** A module map was added. **UNRESOLVED (hypotheses, not measured):** checker-lane value, provider query cost and telemetry delivery.                                                                                                                                                                                                                                                                                        |

## A02 and A07: compatibility and uncalled readers

Evidence: every public function in the base snapshot was compared with generated `api.*` references and literal `"module:function"` strings in `src/`, `scripts/` and `convex/` (tests excluded). Each candidate was then traced with `git log -S`/`-G` over `src/` and `scripts/` history, and test, preview-stub and operator-doc references were checked.

| Function                                   | Evidence                                                                                                                                                                                                                | Action                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finishedGoods/jobScans:searchLocations`   | Frontend caller removed in #55 (2026-10-10). Only one test still used it.                                                                                                                                               | Deleted                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `finishedGoods/workflow:stackOptions`      | `useQuery` removed in #86 (2026-10-13). A dead ref remained, and three tests used it as an oracle.                                                                                                                      | Deleted; tests now use `stackChoices` and an independent DB oracle                                                                                                                                                                                                                                                                                                                                                                    |
| `hr/access:current`                        | Frontend moved to `display` in #89 (2026-10-13).                                                                                                                                                                        | Deleted. Tests now use `display`. The AI-usage preview stub key was renamed to `hr/access:display` with the `display` shape (`offsetMinutes` replaces `today`). Before this, `?hr=ready` in that preview was silently refused, because the provider queried `display`, which the stub did not answer.                                                                                                                                 |
| `storageLayouts/locationCatalogue:list`    | Never queried. The dead ref was removed in #133.                                                                                                                                                                        | Deleted; tests now use `page`/`detail`                                                                                                                                                                                                                                                                                                                                                                                                |
| `storageLayouts/catalogue:getStorageFloor` | Added 2026-08-21. `git log -G` over `src`/`scripts` finds no caller on any commit. The only other mentions were an archived plan document.                                                                              | Deleted                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `finishedGoods/workflow:list`              | `fgRefs.list` existed since 983fb5a6 (2026-09-19) but was only ever a type source: `git log -G "fgRefs\.list($\|,\|\))"` finds no runtime subscriber. The catalogue screen renders `finishedGoods/catalogue:page` rows. | Deleted. `FinishedGoodsTable`, `FinishedGoodsMobileList` and `unitNextAction` are now typed from `catalogue:page` (`CatalogueProduct`, `CatalogueUnit`, `FinishedGoodsRows` in `finishedGoodsApi.ts`); the TSX change is limited to the type import. The test fixture list is a test-only source type. Its tests now use `workflow:getPallet` (move status, registered coverage) and `catalogue:summary` (denials, read-only access). |
| `hr/periods:close`                         | Frontend caller removed only on 2026-11-02 (#119).                                                                                                                                                                      | Kept (documented later contract step)                                                                                                                                                                                                                                                                                                                                                                                                 |
| `catalogue:getStorageBuilding`             | Used by operator scripts                                                                                                                                                                                                | Kept                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Contract: `breakingChanges(base, current)` lists exactly the six removals. The only other changed entries are the two A04 narrowings. Counts are in `logs/correction-contract-counts.log`: base 239 public / 238 with an `any` result; now 233 / 230. Old-tab safety: a tab still running a frontend from before those releases gets a missing-function error for that read and must reload. No document, schema field or write changes. This is documented in `docs/operations/backend-compatibility.md`, and the snapshot is refreshed under that named plan.

A07 residual: the remaining `rows()` readers use an index prefix or exact equality. `recommendations` is covered by `storage-query-scale` (1,200 zones). Native, keyset and multi-range readers are unchanged, and no benchmark was run.

## A03: domain and persistence boundary

- Six `convex/model/hr/*Schema.ts` files moved with `git mv` to `convex/hr/schema/`.
- The policy and work-rule validators moved unchanged to `convex/hr/schema/policy.ts`. Compile-time assertions there fail if the validators drift from the pure `PolicyCapability`/`LeaveType`/`PolicyConfig`/`WorkRules` types.
- `schema.export()` output is byte-identical before and after (167,938 bytes, compared with `cmp`).
- `module-boundaries` checks that `convex/model` imports only itself (plus one documented type-only `_generated` use), and that production `src/` imports backend modules at runtime only from `_generated` and `model`. A red check was run: adding a `convex/values` import fails it.

## A04: explicit results (pilot)

- `storageLayouts/writes:layoutReadiness` now has an explicit union result. The frontend `LayoutReadiness` types are inferred from it, not hand-mirrored.
- `storageLayouts/zones:archiveStorageZone` returns `writeOutcomeValidator`.
- An `expectTypeOf` test asserts the exact client types.
- `storage-explicit-results` calls both functions through the registered API, so the result validator runs. A red check was run: an extra field makes `Return value validation failed`.

UNRESOLVED:

- 230 public results still contain `any`.
- `clientRef` still erases every `Id` brand, so wrong-table IDs are not type errors.
- There is no shared refusal/failure envelope.

## A05: workflow ownership

FIXED (backend): the finished-goods write envelope and record lookups moved unchanged from `workflow.ts` into `finishedGoods/commands.ts` and `records.ts`. Six command modules no longer import `workflow.ts`, and no registered function or transaction changed.

UNRESOLVED, with concrete seams; this pass made no TSX mount or ownership change:

- `StorageZonesPanel` is one component (lines 90–1763). Zone create, update and archive share one `useAsyncOperation` (one request identity scope with `navigation: "write"` pending protection), one `useWorkflowStep` impact step and one `useNavigationDraft`. Extracting the archive flow (`archiving`/`archiveRefusal` state and `archiveZone`) means splitting that operation owner. The Back inventory owners and the tests that prove pending protection (`StorageLayoutNavigation`, `StorageLayoutActions`) must move with it.
- In `StorageLayoutScreens.tsx`, route screens (catalogue, new building, editor, floor editor, review) are already separate components imported by separate pages. Moving them to files is pure code movement. The mixed ownership is `FloorForm` (lines 1821–2498): 11 `useState` (baseline and received version, geometry context, dimension and placement drafts, reserved blocks, editor open/pending, map-edit request, refusal, message), one `saveFloor` mutation, one `useAsyncOperation`, and two `useWorkflowStep`s (impact, offset). A useful seam is a floor-draft reducer that owns baseline/version/dimensions/blocks transitions, keeping the operation and steps in `FloorForm`. It needs the floor-editor caller cases in `back-navigation.json`.
- HR `shared.ts`: 51 importers use several of its sections (scope, plans, period locks, command envelope), so a split would move imports without removing dependencies.

## A06: command mechanics

There is a behavior matrix in `docs/architecture/module-map.md`. Request-ID bounds, actor binding, replay reconstruction, HR retirement fences, master-data target checks, missing-digest tolerance and the client uncertainty persistence all differ on purpose and are unchanged.

`resultIdentityDigest`/`verifiedResultIdentity` replace four copies of the digest and two copies of strict verification; the stored format is pinned by `idempotency-receipts`. One unreachable edge changed: an HR replay of an empty `resultRef` is now unverifiable.

## A08: projection ownership

Inventory before the change:

- `runTenantHandler` wrapped every audited mutation with `trackFinishedGoodsWrites` and `trackSearchIndexWrites`.
- 51 `mutationWithOrg` definitions in 12 FG/storage modules. There are no aliases or re-exports of `mutationWithOrg`; `grep` finds only direct `mutationWithOrg({` calls.
- 32 more in HR, AI-usage and similar modules.
- Test probes writing source tables: 3 in the search-index tests. The other probes write only `warehouses`.
- Raw writers are listed in the test below.

Change:

- `schemaPolicy.PROJECTED_SOURCE_TABLES` names the 11 source tables. A test asserts it equals the union of `FINISHED_GOODS_SOURCE_TABLES` and `SEARCH_SOURCE_TABLES`, which are now exported by the trackers.
- `tenantFunctions` no longer imports any projection module. A mutation may declare `writer: TenantWriteOwner`, a generic `{ db, flush }` contract. Without one, its handler database throws on any write to a projected source table, so the transaction aborts with a generic internal error and nothing commits.
- `convex/lib/inventoryWriter.ts` owns the composition. It wraps the summary tracker, then the search tracker over it, with derived search writes going to the untracked database, and flushes in the same order as before.
- All 50 FG/storage mutations that write sources declare `writer: inventoryWriter`. `summaryMaintenance:prepare` writes only derived rows and declares none.

Preserved behavior:

- Authorization runs before the handler, as before, and writes only `auditEvents`.
- The tracked database is passed to authorization exactly as before; its writes are untracked tables.
- The handler's returned refusals still flush.
- A thrown error still aborts with no flush.
- The scheduler is passed through unchanged.

New guards:

- `inventory-writer` (3 tests): without the writer, a source write is refused and nothing commits, not even the authorization audit row; with it, the source and change shards and readiness commit together; non-source writes do no projection work.
- `module-boundaries`:
  - `tenantFunctions` and every `convex/hr/**` file cannot reach `inventoryWriter`, `finishedGoodsSummary`, `searchIndexWrites`, `zoneOccupancy`, `zoneSurfaces` or `warehouseTotals`. A red check was run: one added import reports four reached modules.
  - Every raw writer that mentions a source table is named with a reason, so a new one fails until reviewed.
  - The source-table set matches the trackers.

Raw writers (each reviewed):

- Staging seeds: `annexDemo`, `storageLayoutUiDemo`, `e2eFixture`, `jobScanDemo`, `paginationDemo`. `scripts/seed-local-test.mjs` runs the totals, occupancy and search backfills after them.
- Rebuilds: `zoneOccupancyBackfill`, `totalsBackfill`, `searchIndexBackfill`.
- Migrations: `moveBuildingMigration` (move building-index fields only) and `staging/locationBuildingBackfill`.
- `operations/duplicateAudit`, which only reads.

Existing rebuild and incremental equivalence coverage was rerun: `finished-goods-summary` ("backfills across pages and reconciles live changes without double counting"), `finished-goods-warehouse-totals`, `finished-goods-change-shards`, `storage-occupancy`, `storage-query-scale`.

UNRESOLVED: no randomized rebuild-equals-incremental test was added beyond those, and contention for shared summary and generation rows was not measured.

## A10, A11, A12

- **A10:** `src/lib/browser/appHistoryMarkers.ts` is now the import-free leaf for history markers and `appHistoryIndex`. `appHistory.ts` re-exports the same names. No inventory target changed. There were no new navigation changes in the correction pass; the first-pass navigation evidence stands: `pnpm check:navigation`, 27 caller files with 338 tests, and 64 navigation e2e tests.
- **A11:** The staged close already existed and is covered by `hr-period-staged-close` and `hr-period-realistic-close` (120 × 31). Certification history is capped at 50. The new `hr-workflows` case "re-certifies up to the supported history and then refuses instead of dropping history" covers the over-limit refusal.
- **A12:** `docs/architecture/module-map.md` is linked from the README. Checker lanes, providers and telemetry are unchanged. Their cost and value were not measured.
