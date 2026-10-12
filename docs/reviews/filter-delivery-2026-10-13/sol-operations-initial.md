# Operations audit — initial evidence

Date: October 13, 2026. Auditor: independent GPT-6.1-Sol operations review.

**Final-diff review pending.** Kiro was still writing during this audit. These findings concern the initial `boundedRecordPage` implementation and its `listJobScans` integration; unfinished callers and other operations surfaces have not been assessed as final defects.

Reviewed worktree: `/Users/macbook/Development/industrial-sas-filter-operations`. Baseline: `11c8c2cc`. No product files were edited. The helper was untracked when inspected, so a tracked-only `git diff` did not include it.

## Concrete compatibility finding

The initial helper returns partial matches in `scanning.items`, copies `scanCursor` into `continueCursor`, and retains those matches in cursor `ids`. A client without scan-continuation handling can display the partial rows, press Next with `continueCursor`, and receive the same accumulated rows again on the next displayed page.

Initial source locations: `convex/finishedGoods/boundedRecordPage.ts:38` claims compatibility with clients without scan-continuation support; lines 173–174 reload retained accepted IDs; lines 214–228 return those IDs and expose the scan cursor as the ordinary continuation cursor. `convex/finishedGoods/jobScans.ts` delegates `listJobScans` to this helper. Line numbers may change as Kiro finishes.

Reproduction with 150 records, matches every 20 records, and page size 20:

1. First request returns `status: "scanning"`, `items: ["0", "20", "40", "60", "80"]` and `isDone: false`.
2. A legacy client sends that `continueCursor` as its next ordinary page cursor.
3. The second request returns `status: "ready"`, `items: ["0", "20", "40", "60", "80", "100", "120", "140"]` and `isDone: true`.

The first five displayed rows repeat. A caller that correctly treats scan continuation as progression within the same page can avoid this, so final assessment must include the completed UI and any backend/frontend rollout compatibility strategy. This is a concrete protocol compatibility concern, not an authorization bypass.

## Malformed-state hardening

The initial helper encodes plain JSON and checks `scope` by equality. It validates array lengths and string lengths but does not reject duplicate retained IDs. A caller can copy a genuine scope and rewrite the state to `ids: []`, `tail: ["140", "140"]`, `exhausted: true`; the probe returned `ready`, duplicated rows, and `isDone: true` without another native read.

This demonstrates caller-controlled navigation corruption. It does **not** demonstrate a tenant or warehouse leak. Existing catalogue pagination also uses scoped JSON with live ID revalidation; the aggregate-summary HMAC helper requires a provisioned key and is not an automatic drop-in requirement for these lists. Straightforward acceptance checks include rejecting duplicate IDs, invalid IDs, malformed ranges, and invalid state transitions. Do not describe these unsigned cursors as authenticated.

## Authorization and traversal observations

No tenant or warehouse scope leak was found in the initial `listJobScans` integration. Native reads use tenant-scoped warehouse indexes. Retained documents are re-read through `tenantDb.get`, then checked against the requested warehouse, mapped filter, and current text. Parent labels are also tenant-read and warehouse-checked before display.

An additional in-memory traversal probe passed **240 cases**, with page sizes 1/20/50/100, filtered and unfiltered reads, and datasets from 50 to 1,245 records. It performed **27,356 helper requests**, including **4,404 recursively simulated `SplitRequired` transitions**, and compared all completed pages against the expected ordered matching IDs. It found no natural duplicate or lost row in those simulated cases.

These are **in-memory probes of the actual helper source**, loaded through TypeScript transpilation with synthetic `get`, `read`, and `hydrate` functions. They are **not actual Convex handler/database measurements**, native database split tests, production observations, or latency/scaling benchmarks. They verify helper control flow under the stated mock contract only. Bun was unavailable in the shell, so the probes used Node 24.19.0 and the installed TypeScript compiler. No files were written by the probes.

## Reproduction command

Run from `/Users/macbook/Development/industrial-sas-filter-operations` against the initial helper. This command transpiles source in memory and prints both the legacy-continuation and duplicate-state results.

```sh
node <<'NODE'
const fs = require('node:fs');
const ts = require('typescript');
const load = (file, dependencies = {}) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', out)(
    key => dependencies[key] ?? require(key),
    exports,
  );
  return exports;
};
const cat = load('convex/lib/cataloguePagination.ts');
const { boundedRecordPage } = load(
  'convex/finishedGoods/boundedRecordPage.ts',
  { '../lib/cataloguePagination': cat },
);
(async () => {
  const ctx = {
    tenant: { organization: { _id: 'o' }, actor: { _id: 'a' } },
  };
  const rows = Array.from({ length: 150 }, (_, i) => ({
    _id: String(i), orgId: 'o', match: i % 20 === 0,
  }));
  let reads = 0;
  const opts = {
    scope: ['test'],
    pageSize: 20,
    filtering: true,
    get: async id => rows.find(row => row._id === id) ?? null,
    accept: row => row.match,
    hydrate: async records => records.map(row => row._id),
    read: async (range, limit) => {
      reads++;
      const start = Number(range.raw ?? 0);
      const page = rows.slice(start, start + limit);
      return {
        page,
        isDone: start + limit >= rows.length,
        continueCursor: String(start + page.length),
      };
    },
  };
  const first = await boundedRecordPage(ctx, opts);
  const second = await boundedRecordPage(ctx, {
    ...opts, cursor: first.continueCursor,
  });
  const state = JSON.parse(first.continueCursor);
  const forged = await boundedRecordPage(ctx, {
    ...opts,
    cursor: JSON.stringify({
      ...state, ids: [], tail: ['140', '140'], exhausted: true,
    }),
  });
  console.log(JSON.stringify({ first, second, reads, forged }));
})();
NODE
```

## Acceptance checks for the completed implementation

- Legacy-client traversal must avoid repeated displayed rows, or the rollout must explicitly address the changed scan-continuation protocol.
- Completed callers must continue `scanning` within the same logical page, retain truthful progress, handle reset/failure without silent loops, and prevent obsolete criteria responses from displaying.
- Reject malformed/duplicate retained IDs; test criteria, actor, warehouse, and page-size changes, plus deleted rows and mapped-status changes during continuation.
- Test complete ordered traversal at native chunk boundaries, sparse late matches, zero matches, equal timestamps, and datasets beyond the former 10,000-record cap.
- Exercise actual native `SplitRequired` recovery and nested splits through the handler/database harness, with at most one native pagination call per request.
- Verify text matching normalization and every searchable displayed field, visible-row mutation selection, and export preservation.
- Final operations review must cover workflow movement history, stack/destination behavior, finished-goods catalogue, and AI usage as well as the completed saved-scans callers.

## Focused follow-up: movement, stacking, destinations, and AI groups

This follow-up reviewed Kiro's implemented `history.ts` / `MoveHistory`, current-move and held-placement reads in `workflow.ts` / `batchManagement.ts`, `stackChoices` / `stackPreview` / `StackScreen`, local `DestinationPicker` paging, and local `UsageBreakdown` paging. Kiro was still finishing other checks. **Integrated final-diff review remains pending.** Generated audit documents and contracts were not assessed as incomplete product defects.

### Verification

The following focused command passed **6 test files / 105 tests** in 2.84 seconds:

```sh
node node_modules/vitest/vitest.mjs run \
  src/features/finishedGoods/MoveHistory.test.tsx \
  src/features/finishedGoods/StackScreen.test.tsx \
  src/features/finishedGoods/DestinationPicker.test.tsx \
  src/features/aiUsage/AiUsageScreen.test.tsx \
  tests/integration/finished-goods-moves.integration.test.ts \
  tests/integration/finished-goods-stacking.integration.test.ts
```

Run directory: `/Users/macbook/Development/industrial-sas-filter-operations`. This includes real repository handlers executed through the local Convex test harness and mocked UI tests. It is not a production/database latency measurement or a test of native production pagination splits.

The handler tests cover 121 finished moves at sizes 20/50, active-move exclusion, the compatible bounded legacy 20-move preview, current clients skipping history, pallet-scoped cursors, and unsupported sizes. The stack tests traverse 81 eligible choices among 162 warehouse units at sizes 20/50/100, compare their global code order to the legacy endpoint, search a late code prefix, and verify that a by-ID preview does not use the warehouse-wide pallet-code index. The UI tests preserve a selected stack pallet off-page and keep both chosen and recommended destination cards reachable across local pages.

No new access leak, natural traversal loss, off-page stack-selection failure, or global recommendation change was found in these reviewed changes. `stackPreview` resolves the chosen upper pallet by ID and rechecks eligibility rather than depending on the visible choice page. History hydration checks the placement's pallet/warehouse before returning its labels. Current-move and held-placement queries use status-specific indexes and preserve occupancy/support checks.

### Small criteria-reset issue to consider

`src/features/aiUsage/UsageBreakdown.tsx:34`–42 calculates page one when the current criteria differ from `view.criteria`, but does not update the stored criteria/page. If the component remains mounted while criteria change A → B → A, the second visit to A resurrects its earlier page instead of starting at page one as the component's documented contract states.

Reproduction using the actual component transpiled in memory, synthetic reports with 30 groups, and a minimal retained `useState` mock:

1. Render criteria A and invoke the footer's `onNext`: range becomes 26–30.
2. Render criteria B without invoking a paging control: range becomes 1–25.
3. Render criteria A again: range becomes 26–30, because the stored state is still `{ criteria: A, page: 2, size: 25 }`.

This is a low-severity presentation state issue, not missing records or incorrect aggregates. The full screen may remount the breakdown during an unresolved query, which resets it and can mask the issue; the reproduction specifically covers criteria changes with a mounted component, such as supplied/cached report results. A criteria-change state reset, or an explicit decision to restore pages per criterion, would make the behavior consistent. Add an A → B → A mounted-component test if page-one reset is the intended contract. This probe was not a full React/browser interaction test.

### Backend limitations remain separate from page reachability

- **Destination recommendations:** `workflow.ts:944`–955 still reads the warehouse's complete zone collection and builds each location context before globally ranking candidates. `DestinationPicker.tsx:74`–89 only slices the complete returned list and pins selected/recommended cards. It improves rendered-list size and preserves global recommendation semantics, but provides no bounded backend-read or first-candidate latency improvement. The plan's separate recommendation-performance work and 121/1,000/10,000 measurements remain required before claiming that improvement.
- **Stack choices:** `workflow.ts:2580`–2605 reads bounded native chunks in code order, then checks text and eligibility. This establishes complete continuation and avoids re-reading the whole warehouse for a chosen preview; sparse searches still require scanning earlier code ranges. The test with 162 units establishes local traversal correctness, not 10,000-row latency or selective indexed-search scaling.
- **AI grouped breakdown:** `UsageBreakdown.tsx:40`–44 bounds rendered groups from the existing aggregate. `convex/aiUsage/reports.ts:165`–205 still has the existing overall 3,000-row summary read budget and explicit partial-report behavior. Presentation paging does not complete a partial aggregate.
- **AI filter discovery and labels:** `convex/aiUsage/reports.ts:24`–25 / 77–82 still limits label discovery to 200 actors and 100 warehouses, and controls use the returned report dimensions. Long group tables can now be paged, but the plan's independently discoverable filter dimensions and selected off-page labels are not delivered by this UI-only change. These are existing remaining scope gaps, not new defects caused by slicing the group table.

The initial legacy saved-scan continuation finding and duplicate-state hardening recommendation above remain available for Kiro's follow-up. This audit changed the report only; it made no product edits.

## Focused follow-up: retained rows and recovery controls

Reviewed the initial completed `JobScanRecords` and `MoveHistory` React implementations while Kiro's separately assigned compatibility/options/reset follow-up was running. The findings below concern existing UI behavior; they do not assess unfinished follow-up changes as final defects.

### P2 — retained scan rows remain mutable during continuation loading

`JobScanRecords.tsx:137`–162 retains a previous same-page response while `useQuery` returns `undefined` for the next scan continuation. Its comment says those rows are read-only during that interval. The actual selection and action guards at lines 232–243, 378, 394, 469, and 539–542 check operation/picker state without checking whether the current query response exists. The displayed rows can therefore still be selected, assigned, or deleted while their latest membership is unresolved.

An isolated **real React / Testing Library probe** confirmed the destructive path:

1. The saved-record query returns `scanning`, one `FO001` row with ID `scan-a`, and `scanCursor: "scan-in-flight"`.
2. The automatic next request contains that scan cursor and its mocked response remains `undefined`.
3. The retained row is visible and its list has `aria-busy="true"`, but `Select FO001` is enabled.
4. Select it, choose `Delete 1 selected record`, then confirm `Delete` in the dialog.
5. The mocked `deleteScans` mutation receives `{ warehouseId: "warehouse-a", requestId: <generated>, ids: ["scan-a"] }` while the query remains pending.

This is a UI freshness/selection defect, not an authorization bypass. The backend still enforces tenant and warehouse ownership. Retention should keep the row readable but disable all mutation entry points during an unresolved continuation, including a previously opened picker or confirmation. The action handlers should enforce the same rule as their disabled controls. A fresh partial response may be deliberately actionable; the finding specifically concerns fallback rows while that response is unavailable.

Reproduction fragment appended to an external temporary copy of the existing record test file, using its original mocks/providers:

```tsx
mocks.listJobScans = (args) =>
  args["scanCursor"]
    ? undefined
    : querySuccess({
        status: "scanning",
        items: [originalRecords[0]],
        isDone: false,
        continueCursor: "scan-in-flight",
        scanCursor: "scan-in-flight",
        scanned: 100,
      });
renderWithIntl(<JobScanRecordsScreen />, {
  locale: "en",
  workspace: false,
  preserveProviders: true,
});
await waitFor(() =>
  expect(mocks.listCalls.at(-1)).toMatchObject({
    scanCursor: "scan-in-flight",
  }),
);
expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
const checkbox = screen.getByRole("checkbox", { name: "Select FO001" });
expect(checkbox).toBeEnabled(); // Confirms the defect.
await user.click(checkbox);
await user.click(
  screen.getByRole("button", {
    name: "Delete 1 selected record",
  }),
);
await user.click(
  within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
);
await waitFor(() =>
  expect(mocks.deleteScans).toHaveBeenCalledWith({
    warehouseId: "warehouse-a",
    requestId: expect.any(String),
    ids: ["scan-a"],
  }),
);
```

### P2 — first-page recovery can be a same-query no-op

The records recovery action at `JobScanRecords.tsx:412`–415 calls `scan.advance()` and `paging.reset()`. The history recovery action at `MoveHistory.tsx:77` only calls `paging.reset()`. If already on page one with no scan cursor, these actions change neither function reference nor serialized query arguments. They cause a component render but do not request a fresh subscription.

Installed Convex source supports this conclusion: `node_modules/convex/src/react/client.ts:928`–945 memoizes the query descriptor by serialized arguments, query name, and skip flag, with an explicit comment that semantically identical arguments do not trigger the query descriptor again. This was checked locally; no production/network observation was made.

Two isolated **real React / Testing Library probes** returned a persistent `reset` result on the first page. After clicking records `Try again` or history `Back to the first page`, respectively:

- The failure alert remained visible.
- The set of serialized query arguments seen across all renders had cardinality **1**.
- The arguments after the action were identical to those before it.

The existing record recovery test switches `mocks.listJobScans` from `reset` to success immediately before clicking the action. Its mock recalculates on any component render, so that test can pass even though the real subscription key has not changed.

Recovery from a later cursor can still work because resetting that cursor changes the query arguments. This finding concerns retrying an already-failed first-page subscription. Provide a concrete fresh-request mechanism for this case, and test request identity/progress rather than merely changing the mock's return value before a render.

Reproduction assertion used in both temporary tests:

```tsx
// Return querySuccess({ status: "reset", items: [], isDone: false,
//   continueCursor: "", scanned: 0 }) for every query response.
await screen.findByRole("alert");
const before = JSON.stringify(calls.at(-1));
await user.click(screen.getByRole("button", { name: recoveryLabel }));
expect(screen.getByRole("alert")).toBeInTheDocument();
expect(new Set(calls.map((args) => JSON.stringify(args))).size).toBe(1);
expect(JSON.stringify(calls.at(-1))).toBe(before);
```

Here `calls` is `mocks.listCalls` for records or `mocks.calls` for history; `recoveryLabel` is `Try again` or `Back to the first page`. These assertions confirm the current defect; a fixed implementation should instead prove that a new query request/subscription is initiated.

### Probe provenance

The three custom probes passed as assertions of the observed defects: **2 temporary test files, 3 tests passed, 20 existing tests skipped**, 1.98 seconds. Temporary copies/configuration were placed outside the repository under `/private/var/folders/m6/xkxc506x2z31wxpkssyvcch40000gn/T/sol-operations-ui-G1qmLN`, using the actual product components and existing repository UI fixtures. Product files and committed tests were not edited.

Executed command:

```sh
node node_modules/vitest/vitest.mjs run \
  --config /private/var/folders/m6/xkxc506x2z31wxpkssyvcch40000gn/T/sol-operations-ui-G1qmLN/vitest.config.mts \
  -t 'SOL probe'
```

These are UI tests with mocked query/mutation responses. They demonstrate enabled controls, dispatched mutation arguments, and unchanged query identity. They do not demonstrate a production mutation, backend data corruption, or production network retry behavior. No browser or production tools were used. Integrated final review and verification after Kiro's fixes remain pending.
