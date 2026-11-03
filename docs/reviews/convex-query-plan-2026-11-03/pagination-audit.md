# Byte-limited pagination audit (workstream G)

Reviewed against the installed Convex/convex-test implementation on 2026-11-03. No pagination runtime change was justified by the retained employee-payslip reproduction: every published statement was returned exactly once.

## Contracts and caller inventory

`tenantStorage.ts` permits one native page per request and supplies a 524,288-byte / 101-row read cap. `tenantDb.ts` forwards native split metadata. `paginatedScan` and `advanceNativeRange` in `cataloguePagination.ts` explicitly retain split subranges; HR's `hrScanPage` uses that helper. These helpers remain unchanged.

The following inventory groups the direct tenant `.page()` consumers by what they return or retain. This is a source audit, not a scale test of every endpoint.

| Consumers                                                                                                                                                                                                | Existing contract                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finished-goods catalogue page/summary, product summaries, product batches/legacy units, history, job scan records and workflow lists; storage catalogue/location catalogue; AI dimensions; HR scan pages | Explicit scanning/range helpers retain continuation and split state.                                                                                                                                                |
| Employee payslips and payslip imports; HR self periods, corrections, notifications and announcements                                                                                                     | Return every eligible row in the bounded native page and preserve continuation even when filtering leaves a short or empty page. Some adapters omit split metadata; omission alone does not establish skipped rows. |
| Finished-goods batch revisions; HR leave history page; AI usage operation detail pages                                                                                                                   | Return/spread the native page contract, including split metadata.                                                                                                                                                   |
| AI recent usage                                                                                                                                                                                          | Consumes a single native page, preserves its continuation before traversing further days.                                                                                                                           |
| Duplicate audit, temporary retention, finished-goods summary preparation                                                                                                                                 | Consume each bounded chunk and persist/return its native cursor.                                                                                                                                                    |
| Workspace selection, HR leave overview, employee history preview, job scan history preview                                                                                                               | Explicit bounded previews report `complete`/`requestsComplete` from native `isDone`. They do not claim complete traversal.                                                                                          |

## Retained evidence

`tests/integration/hr-payslip-pagination.integration.test.ts` calls the registered employee query through `t.query`, with transaction limits enabled. It seeds 15 legacy inline rows of 200,000 characters apiece in separate transactions, including unpublished rows and identical indexed period values, plus a different employee's published row.

An independent native query confirms `SplitRequired`, a nonempty `splitCursor`, a three-row first page and `isDone: false`. The employee handler returns that exact native continuation even when all three first-page rows are unpublished. Repeated public queries traverse short and empty pages, return all eight authorized published IDs in native descending order exactly once, and exclude amounts and original payload bytes.

`src/features/hr/Payslips.test.tsx` additionally verifies the real employee screen keeps Next enabled on an empty intermediate page, reaches a published page, and restores the empty page with Previous. The complete caller suite passes (22 tests).

Existing native `SplitRequired` output in this installed test runtime contains all rows through its `continueCursor`. Consequently, ordinary sequential traversal remains complete in this experiment without interpreting `splitCursor`. The shared helpers also support callers that deliberately split fixed native ranges.

## Limits and follow-up

- This is local runtime evidence, not proof that every production reactive split behaves identically. The official API allows an incomplete page and recommends splitting when `pageStatus` requires it. Do not generalize this result to a live, fixed `endCursor` range under concurrent writes without a development-backend experiment.
- Period index keys are tied. Exact `_creationTime` ties are not claimed: supported convex-test inserts deliberately increment colliding timestamps by 0.001 and reject creation-time edits. No private harness state was altered to manufacture that case.
- The payload split already removes large bytes from newly written statement rows. Legacy inline rows remain useful regression fixtures until migration completes.
- No second native paginate call, cursor format change, new signed scope rule or client navigation behavior was introduced for G. Further runtime adaptation should follow a demonstrated affected caller, preserving authorization and existing result contracts.

Sources: [Convex PaginationOptions](https://docs.convex.dev/api/interfaces/server.PaginationOptions), [Convex pagination](https://docs.convex.dev/database/pagination), and installed `node_modules/convex-test/dist/index.js` native paginate implementation (accessed 2026-11-03).
