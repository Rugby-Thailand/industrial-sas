# Operations follow-up audit

Date: October 13, 2026. Auditor: independent GPT-6.1-Sol.

**Final operations-slice verdict: approved for integration, with no unresolved correctness or authorization blockers in the reviewed slice.** The parent fixed the final live-deletion-confirmation finding in integration commit `ce7d8301`; its guard and rendered regression were independently reviewed and 33 focused integrated tests passed. The earlier sections preserve the first follow-up and early-hook evidence; the final section records the completed second follow-up and verified resolution. Cross-worker integrated-diff review is separate.

Reviewed worktree: `/Users/macbook/Development/industrial-sas-filter-operations`. Baseline: `11c8c2cc`. No product files or committed tests were edited. Probe files/configuration were created outside the repository; this report is the only repository write made by this audit.

## Result

No new correctness or authorization blocker was found in the completed first follow-up. The original legacy duplicate-page reproduction is addressed, duplicate/malformed continuation state is rejected, options beyond the report's actor/warehouse label caps are reachable, selected labels can be resolved independently, and changing mounted breakdown criteria A → B → A now resets to page one.

The recovery hook's retry identity, stalled-cursor checks, continuation budget, and resume behavior passed four focused React hook probes. This is an early hook-design assessment, not final approval of its still-changing callers or the complete recovery flow.

## Protocol and helper review

`boundedRecordPage.ts:19`–28 now documents two protocols. `listJobScans` defaults to short ready pages for clients that know only `items`, `continueCursor`, and `isDone`; current clients explicitly send `progressive: true`. The helper's short-page branch at lines 255–271 does not carry displayed rows into the next page. Progressive replies at lines 273–288 retain accumulated matches only in a scan state and return an **empty ordinary continuation cursor**, so scan progression cannot be mistaken for the next normal page.

The original 150-record/every-20th-match case is now an actual-handler regression test: legacy traversal displays each matching row exactly once, with five matches in its first short page. Additional handler tests traverse 1,000 sparse records at sizes 20/50/100. Both protocols recover byte-budget `SplitRequired` ranges, including nested splits, for 260 approximately 12 KiB records in the local Convex test runtime. The tests compare all returned IDs against the ordered expected static dataset.

An independent in-memory probe of the revised helper covered **480 cases**: both protocols, sizes 1/20/50/100, filtered/unfiltered reads, 50–1,245 records, and recursively simulated splits. It performed **54,675 helper requests** and **8,793 simulated split transitions**. Every completed traversal matched the ordered expected IDs, with no lost or duplicated static rows. The probe loaded the actual TypeScript helper via in-memory CommonJS transpilation and supplied synthetic native/read-by-ID/hydration ports; these counts are not production database measurements or latency benchmarks.

Live pagination may change row counts when records are deleted, cease to match, or change mutable indexed sort fields between requests. Re-reading retained IDs and rechecking membership intentionally removes obsolete rows. This should not be reported as static-data loss; it also does not establish snapshot/export semantics for a changing dataset.

### Cursor validation and authorization

The revised state is version 2 with an explicit `page`/`scan` kind. `boundedRecordPage.ts:117`–139 rejects duplicate retained IDs, malformed IDs/ranges, negative or invalid progress, incorrect state kinds, page states containing accumulated rows, and exhausted states without unread rows. Actual-handler tests exercise these refusals and ensure rejected cursors do not read the saved-record history.

Cursors remain unsigned continuation state. A caller can still construct a well-formed state containing allowed same-scope row IDs and alter their own order/completeness, but this is not a new authorization grant. Retained IDs are re-read through tenant access and `listJobScans` rechecks warehouse, mapped status, and text. Tests also re-authorize foreign retained IDs and refuse other criteria, page sizes, actors, and tenants. No tenant or warehouse leak was found.

Compatibility has a defined invalidation boundary: old numeric search offsets and version-1 helper state are refused with `reset`, `isDone: true`, and an empty cursor. Plain previous native cursors remain accepted for unfiltered saved-scan pages. The new short-page protocol fixes fresh legacy traversal; it does not transparently migrate an already-open numeric-offset search page. Final rollout/caller review should account for that cursor reset rather than claim seamless restoration of every pre-release cursor.

## AI dimensions review

`convex/aiUsage/dimensions.ts` pages every organization membership, including revoked/former memberships, through the tenant-scoped `by_orgId_userId` index and resolves names through `ctx.members.get`. That member-directory port first resolves membership in the current organization before reading the global user. Actor search normalizes case, width, and composition. Warehouse options use tenant-scoped code order and code/name search.

The new label endpoint resolves at most 100 actor IDs and 100 warehouse IDs per request. Actor IDs pass through the membership directory; warehouse IDs pass through `tenantDb.get`. Foreign and unknown IDs are omitted. The integration fixture contains 250 additional members, 120 additional warehouses, and a foreign member. Tests cover complete traversal, former-member inclusion, late English/Thai searches, ordered warehouses, late code/name matches, unsupported page sizes, foreign-ID omission, and the label-request bound. A usage-only reader is intentionally organization-scoped; this access follows the existing AI report permission model.

`DimensionFilter` independently pages options and pins an off-page selected ID with a direct label lookup. `UsageBreakdown` resolves names missing from the report's first 200 actor / 100 warehouse labels for its currently displayed page. The stable UI tests cover selecting an actor beyond the old cap, returning to a previous option page while preserving the label, server search, active-filter naming, and naming breakdown actors absent from the report's labels.

The mounted A → B → A breakdown-reset test now passes: `UsageBreakdown.tsx` updates its stored criteria and page when criteria change, rather than deriving a temporary first-page view while retaining the old page.

These changes address filter discovery and presentation labels; they do not complete an existing partial aggregate. `reports.ts` still has its explicit 3,000-row summary budget. Sparse arbitrary name/code substring option searches remain bounded scans with continuation, not selective indexed substring lookups. No 10,000-row latency or production performance claim is established by these tests.

## Early recovery-hook assessment

`useScanRecovery.ts` changes a serialized `attempt` argument on retry and resets its continuation state for the new attempt. It distinguishes the response that issued the current scan cursor (`state.from`) from a new answer that improperly repeats that cursor, avoiding a false stall during subscription transition. Missing/repeated cursor responses are withheld from `useCatalogueSync`; automatic progression pauses after 50 steps and can resume for another budget.

Four independent React `renderHook` probes passed:

- Retry increments attempt identity, clears the previous cursor, and increments again on another retry.
- Reusing the issuer response during transition does not falsely stall; a new response repeating the current cursor or omitting its next cursor does stall.
- After 50 advances a new scanning response is paused and withheld; resume allows its unused next cursor to advance.
- A changed request key clears attempt and scan state.

The hook stores only one issuer response and one continuation cursor; it does not accumulate the collection in React state. Attempt must actually be sent to a handler accepting that optional argument, and caller cache keys must include `recovery.key`. Completed caller wiring, fresh-row mutation guards, first-page retry, reset loops, and paused/stalled UI still require final integrated verification after the second follow-up.

## Executed verification

Stable handler tests: **2 files / 25 tests passed**, 1.36 seconds.

```sh
REPORT_READS=1 node node_modules/vitest/vitest.mjs run \
  tests/integration/finished-goods-job-scan-records.integration.test.ts \
  tests/integration/ai-usage-dimensions.integration.test.ts
```

Stable completed AI UI cases: **3 tests passed / 32 skipped**, 2.00 seconds.

```sh
node node_modules/vitest/vitest.mjs run \
  src/features/aiUsage/AiUsageScreen.test.tsx \
  -t 'pages and searches every member|names breakdown actors|starts at page one whenever criteria'
```

Independent early-hook probes: **4 tests passed**, 1.09 seconds. Temporary test/config location is outside the repository.

```sh
node node_modules/vitest/vitest.mjs run \
  --config /private/var/folders/m6/xkxc506x2z31wxpkssyvcch40000gn/T/sol-operations-ui-G1qmLN/vitest.config.mts \
  recovery.test.tsx -t 'SOL followup'
```

An earlier combined run passed the handler files but encountered a newly added second-follow-up AI retry test whose mock returned option-page-shaped data to a label lookup, causing `warehouses.find` on an absent array. That unfinished test fixture was not treated as a product defect; the stable first-follow-up cases were rerun separately as recorded above. This is not a claim that the complete UI suite has passed after the second follow-up.

All handler verification uses the repository's local Convex test runtime. The split tests exercise that runtime's pagination/read-budget implementation, not a production Convex deployment. All UI/hook tests use React Testing Library with mocked query responses. No browser or production tools were used.

## Final operations-slice review after the second follow-up

Read the updated `kiro-operations.md` and reviewed the completed recovery hook and its records/history/stack/dimension consumers. The prior retained-loading-row and first-page retry findings are **resolved**. The initial final review found one additional P2 issue where a deletion confirmation outlived its targets' membership in a fresh page; the parent subsequently fixed it in `ce7d8301`, and the verified resolution is recorded below. No reviewed operations correctness/authorization blocker remains.

### Resolved behavior verified

`JobScanRecords` now distinguishes a current query response from retained rows and gates row controls, selection, bulk actions, location assignment, and delete confirmation on `canManage && fresh && !busy`. It also guards the action handlers. Completed tests confirm that retained loading rows remain readable but cannot select/delete/assign, that an already-open confirmation waits while the query is pending, and that an already-open picker waits while retaining a working Cancel action.

Records, movement history, stack choices, and AI dimension choices send `attempt` on retry; their tests answer by argument identity rather than returning success on an arbitrary rerender. Each first-page retry introduces `attempt: 1` and renders a fresh success response. The saved-scan handler test confirms attempt changes do not affect membership or invalidate an otherwise valid continuation cursor.

The records/history/stack consumers stop a repeated or absent next scan cursor and expose retry. Records pause after 51 requested states, with 5,100 records checked in the synthetic fixture, then allow another budget. Independent temporary React probes also exercised the completed **StackScreen** and **DimensionFilter** consumers: each paused at 51 distinct scan states, its continue control advanced to 101 states, and it paused again. No runaway requests or lost resume cursor were observed. These use synthetic scanning responses, not production scans.

### Resolved P2 — deletion target leaves the fresh page

Source: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:259`–263 and 589–592. `onDelete` and its button check global `actionable`, which establishes that **some** current page response is fresh, but do not verify that `deletion.ids` remain in that page's `visibleIdSet`. The selected IDs and assignment picker are live-filtered against visible IDs; the deletion snapshot is not.

Independent real React / Testing Library reproduction:

1. Return a fresh ready page containing `scan-a` / `FO001`.
2. Select FO001 and open its deletion confirmation.
3. Deliver a fresh ready response to the same query containing only `scan-c` / `FO003`, representing FO001 no longer matching the current criteria after a live update.
4. FO001 disappears from the record list and FO003 is visible, but the open dialog's Delete remains enabled.
5. Confirm Delete: `deleteScans` is dispatched with `ids: ["scan-a"]`.

The external probe passed as an assertion of this unwanted behavior. This is not a tenant/warehouse authorization bypass. It violates the plan's visible-row mutation boundary and can delete a still-existing record that has moved out of the displayed filter while the confirmation was open.

Integrated correction reviewed in `ce7d8301758f2d5d9fcc4a64969ca2be7efcc092`: `deletionVisible` requires every confirmed ID to remain in `visibleIdSet`. A fresh, idle response losing any target dismisses the confirmation; `onDelete` independently requires `deletionVisible`. The batch is not silently trimmed. The new rendered regression opens a deletion dialog, delivers a **fresh ready** page without its target, verifies the dialog closes and the remaining row renders, and asserts no deletion mutation was dispatched.

Reproduction fragment using the existing record-test mocks in an external temporary copy:

```tsx
let items = [originalRecords[0]];
mocks.listJobScans = () =>
  querySuccess({
    status: "ready",
    items,
    isDone: true,
    continueCursor: "",
    scanned: 1,
  });
const view = renderWithIntl(<JobScanRecordsScreen />, {
  locale: "en",
  workspace: false,
  preserveProviders: true,
});
await user.click(screen.getByRole("checkbox", { name: "Select FO001" }));
await user.click(
  screen.getByRole("button", {
    name: "Delete 1 selected record",
  }),
);
const dialog = screen.getByRole("dialog");
items = [originalRecords[2]];
view.rerender(<JobScanRecordsScreen />);
expect(screen.queryByText("FO001")).toBeNull();
expect(screen.getByText("FO003")).toBeInTheDocument();
const confirm = within(dialog).getByRole("button", { name: "Delete" });
expect(confirm).toBeEnabled(); // Confirms the defect.
await user.click(confirm);
await waitFor(() =>
  expect(mocks.deleteScans).toHaveBeenCalledWith({
    warehouseId: "warehouse-a",
    requestId: expect.any(String),
    ids: ["scan-a"],
  }),
);
```

### Final executed verification

The complete focused operations batch passed **10 files / 179 tests**, 5.30 seconds:

```sh
node node_modules/vitest/vitest.mjs run \
  src/features/finishedGoods/jobScan/JobScanRecords.test.tsx \
  src/features/finishedGoods/MoveHistory.test.tsx \
  src/features/finishedGoods/StackScreen.test.tsx \
  src/features/finishedGoods/DestinationPicker.test.tsx \
  src/features/aiUsage/AiUsageScreen.test.tsx \
  tests/integration/finished-goods-job-scan-records.integration.test.ts \
  tests/integration/finished-goods-moves.integration.test.ts \
  tests/integration/finished-goods-stacking.integration.test.ts \
  tests/integration/finished-goods-batch-management.integration.test.ts \
  tests/integration/ai-usage-dimensions.integration.test.ts
```

The prior incomplete AI retry-test fixture error is resolved in this passing full UI run.

External probes used the same temporary configuration recorded earlier:

```sh
node node_modules/vitest/vitest.mjs run \
  --config /private/var/folders/m6/xkxc506x2z31wxpkssyvcch40000gn/T/sol-operations-ui-G1qmLN/vitest.config.mts \
  records-final.test.tsx -t 'SOL final probe'

node node_modules/vitest/vitest.mjs run \
  --config /private/var/folders/m6/xkxc506x2z31wxpkssyvcch40000gn/T/sol-operations-ui-G1qmLN/vitest.config.mts \
  stack-final.test.tsx ai-final.test.tsx -t 'SOL final consumer'
```

The deletion probe passed its pre-fix defect assertions (**1 test**, 1.65 seconds). The stack/dimension pause-resume probes passed (**2 tests**, 2.29 seconds). Product code and committed tests were not edited by this auditor; no browsers, production tools, or production mutations were used.

After the parent integrated the slice and fixed the deletion target guard, the auditor reviewed the exact commit and reran the focused integration-worktree tests: **2 files / 33 tests passed**, 6.11 seconds.

```sh
node node_modules/vitest/vitest.mjs run \
  src/features/finishedGoods/jobScan/JobScanRecords.test.tsx \
  src/hooks/useCursorPagination.test.tsx
```

Run directory: `/Users/macbook/Development/industrial-sas-filter-implementation`. The final operations-slice verdict is **approved**. The backend performance limits and cursor invalidation boundary documented earlier remain stated scope limitations, not newly unresolved correctness blockers or claims of production performance verification.

## AI usage reconciliation with mobile UI merge

Focused read-only review of merge `23876060` incorporating `origin/main` `b0f9fc65` (#85) is **clean** for the combined AI usage files and translations. Compared the result against both merge parents. The upstream `csvExport` interface and single export beside the breakdown heading are preserved, including loading/busy guards and accessible names stating filtered/unfiltered range and timezone. Export still uses the report screen's full frozen scope and lifecycle; local group pagination does not restrict CSV rows. The mobile header's wrapping range/heading and nonshrinking export control are retained. The operations page-size controls, criteria reset, independent dimension selectors, selected off-page labels, and current-page label resolution also remain intact. English/Thai AI usage key sets match and all new scope/paging/option keys exist.

Independent focused verification after the merge: **3 files / 47 tests passed**, 3.22 seconds (`AiUsageScreen.test.tsx`, `usageExport.test.ts`, `csv.test.ts`), covering single scoped export placement, full export lifecycle, group traversal/reset, and dimension selection. No code edits, browser checks, or production access were performed. This is source reconciliation and local test evidence; it does not claim fresh visual viewport verification. No AI usage reconciliation blocker was found, and the operations approval remains unchanged.
