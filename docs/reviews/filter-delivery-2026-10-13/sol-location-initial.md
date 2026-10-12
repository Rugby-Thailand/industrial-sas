# Sol initial location audit — tenant range adapter

Initial read-only source audit on October 13, 2026. Audited worktree: `/Users/macbook/Development/industrial-sas-filter-locations`; baseline: `11c8c2cc`. Kiro was actively implementing. This report covers only the current changes to `convex/lib/tenantDb.ts` and `convex/lib/tenantStorage.ts`, with supporting reads of tenant table/index/schema policy, the implementation plan, and `sol-coverage.md`. It is not final delivery or release approval.

## Initial result

No concrete security or correctness defect found in these two changed files during this pass.

- The accessor injects its organization as the first equality term; supplied equality terms must follow the declared index prefix and cannot replace that organization.
- The storage adapter independently requires a nonempty, contiguous equality prefix beginning with a valid organization ID. Explicit `missing: true` terms cannot target `orgId`.
- Schema-derived index policy permits only tenant tables and organization-first indexes with distinct fields.
- A range must target the next declared field after the equality prefix, or `_creationTime` after all declared fields are fixed. It cannot range over `orgId` or skip an intervening equality field.
- Bounds require strings or finite numbers, boolean inclusivity, at least one bound, and matching types when both bounds exist. The adapter applies both bounds after all equality terms.

Generic validation currently accepts string `_creationTime` bounds and inverted bounds. Neither is classified as a defect here: no affected application caller or violated contract was established, and empty ranges can be legitimate. This is not a request to add an unrelated cursor-signing requirement.

## Verification

Executed in the audited location worktree:

```sh
pnpm exec vitest run tests/integration/tenant-storage.integration.test.ts tests/integration/tenant-index-policy.integration.test.ts tests/isolation/tenant-storage.isolation.test.ts tests/isolation/tenant-document-access.isolation.test.ts
```

Result: **4 files passed, 96 tests passed**. These existing tests establish relevant adapter/index-policy/isolation regressions; they do not independently establish complete coverage of the new range API.

An additional read-only Node probe transpiled local TypeScript in memory, created the repository's `createConvexTenantWorld()` fixture, and invoked the actual `createTenantDocumentAccess()` with the actual `createMutationTenantStorage()` against `convex-test`. It did not substitute a mock builder or a mock storage port. The fixture includes tenant A's `ALPHA`, `BRAVO`, `CHARLIE`, `DELTA` warehouses and tenant B's `ALPHA` warehouse.

Probe reproduction logic inside `world.t.run(ctx => ...)`, using an accessor scoped to `world.orgA`:

```ts
const access = createTenantDocumentAccess(
  { orgId: world.orgA, requestId: "audit" },
  createMutationTenantStorage(ctx, "audit"),
);

// Returned ALPHA and BRAVO, both owned by tenant A.
await access
  .byIndex("warehouses", "by_orgId_code", [], {
    field: "code",
    lower: { value: "A", inclusive: true },
    upper: { value: "C", inclusive: false },
  })
  .take(100);

// Returned tenant A's ALPHA only, excluding tenant B's equal-code row.
await access
  .byIndex("warehouses", "by_orgId_code", [{ field: "code", value: "ALPHA" }], {
    field: "_creationTime",
    lower: { value: 0, inclusive: true },
  })
  .take(100);

// Returned an empty array, because every fixture warehouse has a code.
await access
  .byIndex("warehouses", "by_orgId_code", [{ field: "code", missing: true }])
  .take(100);
```

Each of these three attempts raised `TenantDbError` with `INVALID_INDEX_QUERY`:

1. Empty equality prefix with a range on `orgId`, lower bound `world.orgB`.
2. Supplied equality `{ field: "orgId", value: world.orgB }` after the accessor's injected organization.
3. Empty equality prefix with a range on `_creationTime` while declared `code` is not fixed.

## Exact limits and pending review

- The probes ran actual local accessor/adapter code through the Convex test emulator, not a deployed Convex database or public authenticated location handler. They establish the observed local behavior only.
- No browser session, production call, production write, commit, deployment, or product-file edit was performed. This Markdown report is the sole requested write.
- The files were reviewed while implementation was in progress; incomplete work was not treated as final defects.
- This pass does not establish location projection parity, migration/backfill readiness, synchronization of every writer, rename/archive/delete invalidation, physical/support relationships, building/floor filtering, location cursor lifecycle, picker UI behavior, contains-search completeness, or performance scaling.
- Full location diff and backend writer/filter/cursor lifecycle review remain pending until Kiro completes the slice. Deployment measurements and final release verification remain parent-owned.

## Follow-up: keyset and available location query code

Read-only audit of the in-progress `convex/lib/keysetScan.ts`, `convex/finishedGoods/jobScanLocations.ts`, and `convex/storageLayouts/locationCatalogue.ts`. The findings below are reproduced behavior in available query code, not claims that unfinished UI or backfill work is final. Line references identify the source read during this pass and may move as implementation continues.

### P1 — Backfill can silently omit an eligible physical choice from continuation

References: `jobScanLocations.ts:303–361` (`pickerSegments`), `jobScanLocations.ts:682–695` (picker calls `keysetScan` without a generation), and `keysetScan.ts:230–235` (continuation resumes at its old segment).

The building filter traverses populated `buildingId` rows first, then missing-field legacy rows. A legacy ledger row whose `buildingId` is populated between pages moves into an already traversed segment. The existing cursor then finishes without that still-eligible choice. Adding metadata during the advertised online backfill is enough; no code or eligibility change is needed.

Actual authenticated `searchPage` probe under `convex-test`:

1. Create an active building and a valid active physical area `AUD-F01-Z01` with the public building/zone handlers. Remove only the physical ledger's optional `buildingId`/`floorId` to represent a legacy row. Insert 20 active named locations `ZZ-00` through `ZZ-19` in the same building and warehouse.
2. Request `{ warehouseId, buildingId, text: "", pageSize: 20 }`. The first page contains the 20 `ZZ-*` choices; its cursor position is `{ s: 1 }`.
3. Before migration, requesting that cursor returns `AUD-F01-Z01`.
4. Populate the physical ledger's correct building/floor fields, leaving eligibility unchanged. Request the same cursor: it returns `items: []`, `isDone: true`.
5. A fresh first-page request now includes `AUD-F01-Z01`, demonstrating the omitted row is eligible.

The probe uses actual tenant wrappers/readers and actual index queries; the metadata patch is a synthetic local representation of the pending backfill. A reset/version strategy must cover segment membership changes, including the normal page cursor, or the reader must maintain a traversal invariant during migration. Treat writer/readiness implementation as pending, but do not activate this query without resolving this demonstrated boundary.

### P1 — Sparse descendant search exceeds the advertised request work budget

References: `keysetScan.ts:259–279` and `locationCatalogue.ts:167–220, 307–329`.

The work threshold is checked only before fetching a zone batch. The inner evaluation loop continues over that entire batch despite evaluator reads crossing the threshold; each evaluation can scan the zone's complete descendant history. The evaluator itself does not yield when its budget runs out. Consequently `maxWork: 400` does not bound the actual work of this caller.

Actual authenticated physical catalogue `page` probe under `convex-test`: create 12 zones with public handlers; seed 120 inactive positions per zone, each with a distinct valid ledger ID, position ID, code, and QR. Request `{ warehouseId, pageSize: 20, search: "NEVER_MATCH" }`, instrumenting the real database's `withIndex(...).take(...)` results. One request returned `status: "ready"`, `scanned: 12` after **1,452 position rows, 1,473 total indexed rows, and 60 index query calls**. Parent document reads are additional. The first reproduction reused the repository's older history-fixture shape; the numbers above were independently repeated with distinct ledger/position identities to avoid relying on that shortcut.

The bound must apply within evaluation/descendant traversal and within a fetched batch, with enough cursor state to resume unfinished work. Reading fewer outer zones alone does not bound a single zone's growing archived history.

### P1 — Exactly 1,000 archived descendants make catalogue text search fail

Reference: `locationCatalogue.ts:175–178, 208–217`.

`positionText` allows ten reads of 100 rows for each status and throws before an eleventh read. A tenth full chunk cannot establish exhaustion, so **exactly 1,000** same-status positions trigger the refusal too. The complete concatenated text is only checked for a match after `positionText` returns; a match inside the first 1,000 rows cannot prevent this error. Archived position history has no corresponding 1,000-row write/domain bound.

Actual authenticated physical catalogue `page` probe: extend one zone from the preceding fixture to exactly 1,000 inactive positions with distinct ledger IDs/codes. Put label `late needle` on position 999. Request `{ warehouseId, pageSize: 20, search: "late needle" }`. The public tenant wrapper raised **`INTERNAL_ERROR`**; source identifies the underlying `CATALOGUE_READ_CAPACITY_EXCEEDED` throw. There is no continuation that makes the match reachable. Historical descendant traversal needs a resumable budget rather than this new terminal read cap.

### P2 — Mutable code boundaries repeat rows after a rename

References: `keysetScan.ts:43, 165–181, 230–235` and `jobScanLocations.ts:392–433` (`buildingOptions`).

Normal page cursors retain the previous code/creation-time tuple, with no row anchor or checked revision. Deduplication is confined to the current page. Moving an already returned row's code after the boundary makes that same identity appear again on a later page; moving an unvisited row before the boundary can omit it.

Actual authenticated `buildingOptions` probe under `convex-test`: seed 51 active authorized buildings with unique codes; fetch its fixed-size 50-row first page; patch the first returned building's code to `ZZZ-RENAMED`; fetch Next using the emitted cursor. Next returned two rows, including the **same building ID** already present on the first page, now labeled `ZZZ-RENAMED`. This is ordinary sort-key mutation, not forged cursor state. Agree a reactive mutation/reset policy and test it; generic cursor signing would not fix it.

### Additional ordering observation

The static legacy fixture from the first finding also returns all `ZZ-*` rows before `AUD-F01-Z01`, although the latter sorts first by code. The building and legacy segments are concatenated rather than merged. This is deterministic segment order, but it does not satisfy the current blank-browse documentation's global code-order claim while legacy rows remain. Prefix-before-contains phase ordering is intentional and is not this observation.

### Checks, non-findings, and remaining limits

- Executed `pnpm exec vitest run tests/integration/storage-location-catalogue.integration.test.ts tests/integration/finished-goods-job-scans.integration.test.ts`: **20 passed, 7 failed**. Two failures assume the old multi-request scanning schedule; five expect the removed `canCreate: false` response property. These tests need final contract reconciliation; those failures alone are not classified as product defects while Kiro is finishing the API/UI slice.
- The code currently re-reads retained IDs and re-evaluates tenant/warehouse/current-parent eligibility. No cross-tenant or cross-building disclosure was established during this pass. Cursor scope includes tenant, actor, criteria, and page size. Scoped unsigned JSON remains continuation state; this report does not request HMAC without an authorization need.
- Keysets use `code` plus `_creationTime`, without `_id`. Distinct keys with tied creation times do not fail traversal. Exact equal key/time tuples would be skipped at a boundary, but current callers have code-uniqueness contracts; no valid-domain reproduction of that tie was established, so it is not a reported defect. A future caller with nonunique keys needs an additional tie-breaker.
- Empty/deleted retained IDs are dropped by re-evaluation. Arbitrary insertions before an existing immutable tuple boundary and continuously changing snapshots still require a documented reactive paging policy; deployed behavior was not measured.
- Probe records were seeded in a local Convex emulator. Public handlers and real local accessors/adapters were executed, but this is neither deployed Convex profiling nor production latency evidence. No browser, production call/write, commit, deployment, or product edit was performed.
- Complete writer synchronization, imports, rename/archive/delete invalidation, backfill readiness, frontend cursor recovery, and the final integrated diff remain pending. These concrete query findings should be addressed before final delivery audit.

### Complete read-only reproduction script

Run the following from `/Users/macbook/Development/industrial-sas-filter-locations` against the audited source. It writes only to an in-memory `convex-test` fixture. TypeScript is transpiled in memory; no application/test files, browser state, environment files, or production database are changed. JSON output reports each scenario; the last scenario should print the public `INTERNAL_ERROR` on the audited implementation.

```sh
node <<'NODE'
const fs = require('fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  filename,
);
const { createConvexTenantWorld, seedConvexAuthorization } =
  require('./tests/fixtures/convex-tenant-world.ts');
const { createStorageBuilding } = require('./convex/storageLayouts/writes.ts');
const { createStorageZone } = require('./convex/storageLayouts/zones.ts');
const { searchPage, buildingOptions } =
  require('./convex/finishedGoods/jobScanLocations.ts');
const { page } = require('./convex/storageLayouts/locationCatalogue.ts');
const identity = { subject: 'user_fixture_a', org_id: 'org_fixture_a' };
const call = (world, fn, args, wrap) => world.t.withIdentity(identity).run(
  ctx => fn._handler(wrap ? { ...ctx, db: wrap(ctx.db) } : ctx, args),
);

(async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: 'ORG_ADMIN' });
  const warehouseId = world.warehouses.alphaA;
  const made = await call(world, createStorageBuilding, {
    warehouseId, requestId: 'audit-building', code: 'AUD', name: 'Audit',
    widthMm: 30000, depthMm: 20000, defaultFloorHeightMm: 4000, floorCount: 1,
  });
  const buildingId = made.value.documentId;
  await world.t.run(ctx => ctx.db.patch(buildingId, { status: 'ACTIVE' }));
  const makeZone = n => call(world, createStorageZone, {
    warehouseId, buildingId, requestId: 'audit-zone-' + n,
    floorNumber: 1, label: 'Spot ' + n, xMm: n * 2000, yMm: 0,
    widthMm: 1000, depthMm: 1000, maxStackHeightMm: 3000,
  });
  await makeZone(0);
  const legacy = await world.t.run(async ctx => {
    const zone = (await ctx.db.query('storageZones').collect())[0];
    await ctx.db.patch(zone.locationId, {
      buildingId: undefined, floorId: undefined, status: 'ACTIVE',
    });
    for (let n = 0; n < 20; n++) await ctx.db.insert('locations', {
      orgId: world.orgA, warehouseId, buildingId,
      code: 'ZZ-' + String(n).padStart(2, '0'), label: 'Named ' + n,
      locationType: 'NAMED_STORAGE', status: 'ACTIVE',
    });
    return zone;
  });
  const pickerArgs = { warehouseId, buildingId, text: '', pageSize: 20 };
  const first = await call(world, searchPage, pickerArgs);
  const before = await call(world, searchPage, {
    ...pickerArgs, cursor: first.value.continueCursor,
  });
  await world.t.run(ctx => ctx.db.patch(legacy.locationId, {
    buildingId, floorId: legacy.floorId,
  }));
  const after = await call(world, searchPage, {
    ...pickerArgs, cursor: first.value.continueCursor,
  });
  const fresh = await call(world, searchPage, pickerArgs);
  console.log(JSON.stringify({
    scenario: 'legacy segment migration',
    firstCodes: first.value.items.map(row => row.code),
    beforeNext: before.value.items.map(row => row.code),
    afterNext: after.value.items.map(row => row.code),
    afterDone: after.value.isDone,
    freshCodes: fresh.value.items.map(row => row.code),
    firstPosition: JSON.parse(first.value.continueCursor).pos,
  }));

  await world.t.run(async ctx => {
    const { _id, _creationTime, ...fields } = await ctx.db.get(buildingId);
    for (let n = 0; n < 50; n++) await ctx.db.insert('storageBuildings', {
      ...fields, code: 'CODE-' + String(n).padStart(2, '0'),
    });
  });
  const buildings = await call(world, buildingOptions, { warehouseId });
  const renamed = buildings.value.page[0];
  await world.t.run(ctx => ctx.db.patch(renamed.buildingId, {
    code: 'ZZZ-RENAMED',
  }));
  const buildingNext = await call(world, buildingOptions, {
    warehouseId, cursor: buildings.value.continueCursor,
  });
  console.log(JSON.stringify({
    scenario: 'code rename across boundary',
    firstCount: buildings.value.page.length,
    nextCount: buildingNext.value.page.length,
    duplicate: buildingNext.value.page.find(
      row => row.buildingId === renamed.buildingId,
    ),
  }));

  for (let n = 1; n < 12; n++) await makeZone(n);
  const addHistory = async (ctx, zone, n, i) => {
    const code = `HIST-${n}-${String(i).padStart(4, '0')}`;
    const locationId = await ctx.db.insert('locations', {
      orgId: world.orgA, warehouseId, buildingId: zone.buildingId,
      floorId: zone.floorId, code, locationType: 'FLOOR_BLOCK',
      status: 'INACTIVE',
    });
    await ctx.db.insert('storagePositions', {
      orgId: world.orgA, warehouseId, buildingId: zone.buildingId,
      floorId: zone.floorId, zoneId: zone._id, locationId, code,
      label: i === 999 ? 'late needle' : 'Historical position',
      qrValue: `ISAS:LOCATION:1:${locationId}`,
      kind: 'FLOOR', isDefault: false, status: 'INACTIVE',
      createdAt: 1, updatedAt: 1,
      createdByUserId: world.userA, updatedByUserId: world.userA,
    });
  };
  const zones = await world.t.run(async ctx => {
    const rows = await ctx.db.query('storageZones').collect();
    for (const [n, zone] of rows.entries())
      for (let i = 0; i < 120; i++) await addHistory(ctx, zone, n, i);
    return rows;
  });
  const reads = [];
  const track = db => new Proxy(db, {
    get(target, key) {
      const member = Reflect.get(target, key);
      if (key === 'query') return table => {
        const query = member.call(target, table);
        return new Proxy(query, {
          get(q, name) {
            const method = Reflect.get(q, name);
            if (name === 'withIndex') return (...args) => {
              const bounded = method.apply(q, args);
              return new Proxy(bounded, {
                get(b, operation) {
                  const fn = Reflect.get(b, operation);
                  if (operation === 'take') return async count => {
                    const rows = await fn.call(b, count);
                    reads.push({ table, count, rows: rows.length });
                    return rows;
                  };
                  return typeof fn === 'function' ? fn.bind(b) : fn;
                },
              });
            };
            return typeof method === 'function' ? method.bind(q) : method;
          },
        });
      };
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
  const sparse = await call(world, page, {
    warehouseId, pageSize: 20, search: 'NEVER_MATCH',
  }, track);
  console.log(JSON.stringify({
    scenario: 'sparse descendant work', status: sparse.value.status,
    scanned: sparse.value.scanned, queryCalls: reads.length,
    positionRows: reads.filter(r => r.table === 'storagePositions')
      .reduce((sum, r) => sum + r.rows, 0),
    allIndexRows: reads.reduce((sum, r) => sum + r.rows, 0),
  }));
  await world.t.run(async ctx => {
    for (let i = 120; i < 1000; i++) await addHistory(ctx, zones[0], 0, i);
  });
  try {
    const late = await call(world, page, {
      warehouseId, pageSize: 20, search: 'late needle',
    });
    console.log('exactly-1000-result', JSON.stringify(late));
  } catch (error) {
    console.log('exactly-1000-public-error', error.message);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

## Follow-up: completed picker sections

Functional source audit of the rewritten `src/features/finishedGoods/jobScan/LocationPicker.tsx`, using the repository's impeccable audit guidance. This is not a visual/browser audit. The mechanical detector returned `[]`; that does not verify the state transitions below.

### P1 — Read denial leaves previously authorized choices enabled

References: `LocationPicker.tsx:488–514, 529–531, 574–577, 624–631`.

When `outcome` becomes `{ ok: false }`, `fresh` becomes undefined. The component still assigns the previous same-page `held.value` to `current`. If that answer was ready, `interactive` remains true, so the previously rendered choices remain enabled alongside the denial message. A permission change can therefore leave stale data available for selection, even though the latest query explicitly denied reading it. This is a client-state flaw, not evidence of a server write-authorization bypass.

Actual `LocationChoices`/hooks rendered under React/jsdom with mocked Convex answers: render one ready choice, then rerender with `{ ok: false }` without changing warehouse/criteria. Output: `denialShown: true`, `heldChoiceShown: true`, **`heldChoiceEnabled: true`**. Retention must stop or disable on a denied result and be scoped to current actor/organization as well as criteria.

### P2 — Building-option reset leaves the filter stuck loading

References: `LocationPicker.tsx:787–804, 813, 874–901`.

`BuildingOptions` advances `scanning` but never handles `reset`. After More produces a rejected/stale cursor, the old page cursor remains in the next query arguments; there is no automatic restart, reset notice, or Retry action. Previously accumulated options remain selectable while loading is shown. Closing/reopening the popover is a workaround because it remounts the component, but the visible state offers no explanation of that workaround.

Actual `BuildingOptions`/hooks rendered under React/jsdom with mocked Convex answers: initial ready page with `continueCursor: "old-cursor"`; click More after changing the query answer to `reset`. Output: **`loading: true`, `hasMore: false`, `lastQueryArgs.cursor: "old-cursor"`, `retryButtons: 0`, `optionsStillSelectable: true`**. Implement one safe reset attempt followed by explicit recoverable failure if the reset persists.

### P1 — A ready prefix page is mistaken for complete search absence

References: `LocationPicker.tsx:512–514, 532–542, 650–665`.

`complete` means only `status === "ready"` and settled typing; it ignores `isDone` and the search phase. A full prefix page is ready while more prefix/contains work remains. If the typed prefix itself has no exact identity, `typedCanCreate` and `offerUnmapped` become true anyway. The UI offers Add location and free-text selection while the complete contains search is unfinished and valid matching choices already exist. This recreates the exact-miss/complete-search confusion the plan requires fixing. The separate barcode-confirmed missing path should remain immediate.

Actual `LocationChoices` mock-query/jsdom probe: pass settled text `F1-L30`; return a valid ready choice page with `isDone: false`; return an exact resolver miss `{ ok: false, error: { code: "LOCATION_NOT_FOUND" } }` inside its successful tenant envelope; enable `allowUnmapped`. Output: **`addLocationShown: true`, `unmappedShown: true`**. To reproduce using the complete UI script below, change `props.text` and `props.settledText` to `F1-L30`, `allowUnmapped` to true, and the search result's `isDone` to false; retain `locationMode = "ready"` instead of setting it to denied; return that exact miss for `fgRefs.resolveJobScanLocation`. Assert `screen.queryByRole("button", { name: "addLocation" })` and `screen.queryByRole("button", { name: /useUnmapped/ })` are both present. This is a mocked valid backend response shape, not a deployed latency measurement.

### Other verified recovery gaps and scope limits

- **P2, source-confirmed:** the location list does call `useCatalogueSync`, which recovers one reset while a page/scan cursor exists. It is inaccurate to claim every reset is unhandled. An initial reset, or a repeated reset after that attempt, falls through to an empty status, `aria-busy`, and disabled pager with no reset message/Retry (`LocationPicker.tsx:512–554, 604, 678`; `useCatalogueSync.ts:55–65`). A repeated identical scanning cursor likewise has no progress guard or actionable recovery. These fall-through states were inspected in source, not reproduced with deployed responses.
- **P2, source-confirmed:** `BuildingOptions`' `useQuery` is outside the local `QueryErrorBoundary`, which wraps only `LocationChoices` (`LocationPicker.tsx:267–271, 368–398, 795`). A thrown building-options query failure cannot use the picker's local Retry fallback. Envelope denials also show loading and denial together and offer no filter-specific retry. A local error boundary/retry should preserve the surrounding draft.
- Exact lookup is independent of the catalogue, blank browse is enabled, the filter has an accessible name and 48px trigger, and exact/page deduplication uses canonical `locationId`. No canonical-identity deduplication defect was found.
- The picker session/page/held keys do not include actor or organization. The main `JobScanScreen` additionally remounts its workflow using `useDraftKey`, so this pass does not claim that every full auth switch preserves picker rows. The reproduced ready-to-denied transition remains defective even without an identity switch. `JobScanRecords` mounts by warehouse, and remembered paging is keyed by warehouse; complete parent/provider auth-transition verification remains pending.
- Executed `pnpm exec vitest run src/features/finishedGoods/jobScan/LocationPicker.test.tsx src/features/finishedGoods/jobScan/LocationPicker.ai.test.tsx src/features/finishedGoods/jobScan/LocationPicker.image.test.tsx`: **34 passed, 8 failed**, with AI and image suites passing. Existing picker tests still require blank queries to be skipped and use choices without the now-canonical `locationId`; several assertions assume only one status node. Those failures require fixture/contract reconciliation and are not eight independent product defects.
- UI probes use mocked Convex query answers, mocked translations, and actual in-memory component/hook code under jsdom. The unused registration form and pagination rendering were replaced by inert components to avoid unrelated framework/DOM dependencies. This proves the observed component transition only; it does not prove deployed authentication behavior or rendered mobile/keyboard layout.

### Complete UI state reproduction script

Run from the audited location worktree. It exposes private components only in the in-memory transpiled module; it does not modify source files.

```sh
node <<'NODE'
const fs = require('fs'), path = require('path');
const ts = require('typescript'), Module = require('module');
const root = process.cwd(), originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith('@/')
    ? path.join(root, 'src', request.slice(2)) : request, parent, ...rest);
};
const file = path.join(root, 'src/features/finishedGoods/jobScan/LocationPicker.tsx');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, f) => {
  let source = fs.readFileSync(f, 'utf8');
  if (f === file) source += '\nexport { BuildingOptions as AuditBuildingOptions, LocationChoices as AuditLocationChoices };';
  m._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, f);
};
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement',
  'HTMLFormElement', 'HTMLInputElement', 'HTMLButtonElement', 'DocumentFragment',
  'Element', 'Node', 'MutationObserver', 'Event', 'CustomEvent', 'getComputedStyle'])
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let buildingMode = 'ready', locationMode = 'ready';
const buildingArgs = [], originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './AddLocationForm') return { AddLocationForm: () => null };
  if (request === '@/components/system/CursorPagination') return { CursorPagination: () => null };
  if (request === 'next-intl') return { useTranslations: () => key => key, useLocale: () => 'en' };
  if (request === 'convex/react') return {
    useConvex: () => ({}),
    useQuery: (ref, args) => {
      const { fgRefs } = require('./src/lib/convex/finishedGoodsApi.ts');
      if (ref === fgRefs.jobScanBuildingOptions) {
        buildingArgs.push(args);
        return { ok: true, value: buildingMode === 'ready' ? {
          status: 'ready', page: [{ buildingId: 'building-a', code: 'A', name: 'Alpha' }],
          isDone: false, continueCursor: 'old-cursor',
        } : { status: 'reset', page: [], isDone: false, continueCursor: '' } };
      }
      if (ref === fgRefs.searchJobScanLocations) return locationMode === 'denied'
        ? { ok: false } : { ok: true, value: {
          status: 'ready', items: [{ locationId: 'location-a', buildingId: 'building-a',
            code: 'A-01', name: 'Location A' }],
          page: [{ _id: 'location-a' }], isDone: true, continueCursor: '',
        } };
      return undefined;
    },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const React = require('react');
const { render, screen, fireEvent, cleanup, act } = require('@testing-library/react');
const { AuditBuildingOptions, AuditLocationChoices } = require(file);
(async () => {
  render(React.createElement(AuditBuildingOptions, {
    warehouseId: 'warehouse-a', value: null, onChange() {},
  }));
  buildingMode = 'reset';
  fireEvent.click(screen.getByText('moreBuildings'));
  await act(async () => {});
  console.log(JSON.stringify({ scenario: 'building reset after More',
    loading: !!screen.queryByText('loadingBuildings'),
    hasMore: !!screen.queryByText('moreBuildings'),
    lastQueryArgs: buildingArgs.at(-1),
    retryButtons: screen.queryAllByText(/retry/i).length,
    optionsStillSelectable: !screen.getByRole('button', { name: /A.*Alpha/ }).disabled,
  }));
  cleanup();
  const props = { warehouseId: 'warehouse-a', text: '', settledText: '',
    building: null, onClearBuilding() {}, allowUnmapped: false,
    scannedMissing: false, confirmedMissing: undefined, acquiring: false,
    onChoose() {}, onAdd() {},
  };
  const view = render(React.createElement(AuditLocationChoices, props));
  locationMode = 'denied';
  view.rerender(React.createElement(AuditLocationChoices, props));
  await act(async () => {});
  console.log(JSON.stringify({ scenario: 'read permission denied after ready result',
    denialShown: !!screen.queryByText('locationLookupDenied'),
    heldChoiceShown: !!screen.queryByRole('button', { name: /A-01/ }),
    heldChoiceEnabled: !screen.getByRole('button', { name: /A-01/ }).disabled,
  }));
  cleanup();
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```
