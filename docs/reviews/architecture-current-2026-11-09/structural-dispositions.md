# Structural dispositions: A02–A08, A10–A12

Reviewed against `origin/main` at `de79d7ad`, then integrated with `739afa94` (including #149 and #150). The original report described an older checkout; each finding was checked against current callers and behavior before implementation. Breaking interfaces and fresh-data cutovers are explicitly authorized for this prelaunch project. No remote reset or migration was needed or performed.

Kiro CLI produced the initial structural changes, then repeatedly stalled (`Model stream stalled: no data received for 300000ms`). Its controller stopped and awaited exit 130. Codex reviewed that partial work, corrected the integration and completed the typed pilot and floor-draft seam. No alternate Kiro provider was substituted. Standards and specification reviews informed these corrections; validation below distinguishes demonstrated behavior from unmeasured hypotheses.

| ID  | Verified outcome                                                                                                       | Remaining work / decision                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A02 | Removed seven proved-uncalled public interfaces and the historical exact-schema freeze.                                | Retain active geometry/domain fallbacks until their current semantics justify removal; no speculative migration.             |
| A03 | HR persistence schemas live under `convex/hr/schema`; pure model imports are enforced.                                 | Keep domain and persistence changes separate.                                                                                |
| A04 | Two explicit-result pilots, inferred frontend results, table-derived tenant reads and ID-preserving client references. | 229 of 234 public results still contain `any`; migrate feature by feature when touched. Do not claim a whole-API conversion. |
| A05 | Finished-goods command/record modules and an independently testable floor-draft reducer.                               | Keep live operation and Back ownership in the caller. Do not split HR helpers solely to move imports.                        |
| A06 | Shared receipt digest and verification; feature replay policies preserved.                                             | Keep intentional policy differences explicit.                                                                                |
| A07 | Removed four unused broad inventory readers; measured existing indexed search.                                         | No evidence supports replacing already-indexed readers or raising limits.                                                    |
| A08 | Explicit inventory-writer ownership, no-writer guards and incremental/rebuild equivalence.                             | Production contention and partitioning remain unmeasured hypotheses.                                                         |
| A10 | Removed the runtime history import cycle through an import-free marker leaf.                                           | Preserve the navigation contract and caller tests.                                                                           |
| A11 | Staged close already existed; added certification-history limit refusal coverage.                                      | Production load is unmeasured; supported fixture limits remain.                                                              |
| A12 | Added an enforced module map; #149 fixes lint scope.                                                                   | Checker value, provider cost and telemetry delivery require measurements before redesign.                                    |

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
| `hr/periods:close`                         | Frontend caller removed only on 2026-11-02 (#119).                                                                                                                                                                      | Deleted; canonical begin interface covers review and replay                                                                                                                                                                                                                                                                                                                                                                           |
| `catalogue:getStorageBuilding`             | Used by operator scripts                                                                                                                                                                                                | Kept                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The additional `hr/periods:close` shim has no production callers; current callers use `hr/periodClose:begin`. Its replay/close tests now call that canonical interface. Seven interfaces are removed in total. The reviewed public snapshot also includes #150’s two attachment functions and narrowed A04 results: original base 239 public / 238 containing `any`; integrated result 234 / 229. The obsolete October schema snapshot and exact-validator freeze were removed; current schema, tenant/index, seed, function-contract and codegen checks remain. Old-tab safety: a tab still running a frontend from before those releases gets a missing-function error for that read and must reload. No document, schema field or write changes. This is documented in `docs/operations/backend-compatibility.md`, and the snapshot is refreshed under that named plan.

A07: remaining `rows()` readers use an index prefix or exact equality. `recommendations` is covered by `storage-query-scale` (1,200 zones). The existing 2,200-record search fixture compares indexed and fallback read counts with identical results; the passing assertions bound rare-needle reads to matches + 200 and under one tenth of fallback reads, in one request. Common first pages are bounded to 320 reads. The local comparison passed in 559.63 seconds; console read reports were not retained by the runner, so no additional observed counts are claimed. Native, keyset and multi-range readers are unchanged.

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

The pilots now use `tenantDocument(db, table, id)`: the table determines both the document and ID type, with `NoInfer` preventing wrong-table ID widening. Their `typedClientRef` retains result ID brands and rejects already-branded IDs of the wrong table. Raw URL/scanner strings remain accepted as inputs and are validated at the registered server boundary. Compile-time negative tests and registered malformed/wrong-table input tests cover both sides.

The shared authorization refusal stays the tenant outcome envelope; archive uses the existing write-outcome validator. No parallel error framework was added. The legacy adapter remains for other features, and 229 public results still contain `any`. These pilots establish the migration seam; broad conversion is future feature work, not represented as complete.

## A05: workflow ownership

FIXED (backend): the finished-goods write envelope and record lookups moved unchanged from `workflow.ts` into `finishedGoods/commands.ts` and `records.ts`. Six command modules no longer import `workflow.ts`, and no registered function or transaction changed.

FIXED (UI): `floorDraft.ts` owns baseline, received version, geometry context, dimension overrides, reserved blocks and placement. `FloorForm` owns its live async save, pending protection, impact/offset steps and shared dialogs. Dirty drafts pin their version; pristine refresh and successful saves reconcile without remounting. Ten reducer cases and caller tests cover these invariants, including a pending save through refresh and the next Back. The seven presentation-data inventory entries now point to the real reducer owner and exact existing semantic targets.

`StorageZonesPanel` and HR `shared.ts` retain their current operation/policy owners. Extracting those purely by file size would not demonstrate a new reliable seam. They are candidates when a concrete independent command or policy emerges, not confirmed defects requiring arbitrary splitting.

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

Additional proof: `inventory-rebuild-equivalence` runs eight seeded packing batches with varying package counts and quantities through the registered command, repeats every delivery, deletes only derived summary rows, and rebuilds from authoritative units. Rebuilt and incremental summaries match exactly. The three focused writer/summary/rebuild files pass (5 tests). Production contention and generation-row partitioning remain unmeasured.

## A10, A11, A12

- **A10:** `src/lib/browser/appHistoryMarkers.ts` is now the import-free leaf for history markers and `appHistoryIndex`. `appHistory.ts` re-exports the same names. No inventory target changed. The floor-draft correction updates only the documented presentation-data ownership; the operation/workflow owners remain. Initial navigation evidence: `pnpm check:navigation`, 27 caller files with 338 tests, and 64 navigation e2e tests.
- **A11:** The staged close already existed and is covered by `hr-period-staged-close` and `hr-period-realistic-close` (120 × 31). Certification history is capped at 50. The new `hr-workflows` case "re-certifies up to the supported history and then refuses instead of dropping history" covers the over-limit refusal.
- **A12:** `docs/architecture/module-map.md` is linked from the README. Checker lanes, providers and telemetry are unchanged. Their cost and value were not measured.

## Final integration validation

- Job-scan source-maintenance cases that timed out during Kiro’s run pass together in 86.04 seconds with unchanged 600-second limits. No timeout increase or skipped case.
- Canonical close, HR parity, registered contracts and current schema: 5 files / 89 tests pass.
- Writer guards, source rebuild equivalence and summary maintenance: 3 files / 5 tests pass.
- Floor reducer and real caller integration: 6 focused files / 188 tests pass before final full-suite validation.
- Final integration gates pass: normal lint/format, Bun 1.4.3 / TypeScript 7.0.2 and TypeScript 6.0.3, codegen freshness, test discovery (477 Vitest files), and navigation (68 fixtures, 60 routes, 308 owners, 26 actions). A fresh production navigation build passes 32 desktop/mobile Chromium cases. Full local Vitest is still running at PR creation; all required CI checks remain mandatory before merge.

Local command outputs live in ignored `logs/coordinator-*.log`; the reproducible test names and commands above, maintained tests and PR checks are the durable evidence. No cloud ACL, production transaction budget or telemetry delivery was verified by local tests.

### CI correction: strict mutation registry

The first #154 test shard 3 run found that the new floor caller used a local fallback mutation mock, violating the existing registry ratchet. The caller now uses `getTestMutation` and registers only `storageLayoutRefs.saveFloor`; unexpected writes fail through the shared teardown. No allowlist or guard was weakened. The registry detector, reducer and caller tests pass together (3 files / 24 tests); the pinned checker passes again.
