# Query and performance audit — 15 October 2026

Kiro CLI (`claude-opus-5.5`, high effort) found five issues in the current working tree at HEAD `733c6aca`. The parent reviewer independently reproduced all five through real registered Convex handlers in isolated `convex-test` fixtures. Application code was not changed.

| Priority | Finding                                                                                           | Verified evidence                                                                                                                                                                       | Source                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 · Q1  | Quantity sorting skips and repeats products when unit spellings differ only by case.              | Of 45 products alternating `PCS`/`pcs`, only 38 unique products appeared: 7 missing and 6 repeated rows, in both sort directions. Consistent unit spelling returned all 45 once.        | [Comparator](../../../convex/finishedGoods/catalogueFilters.ts#L75), [pagination boundary](../../../convex/lib/cataloguePagination.ts#L204) |
| P2 · Q2  | Product search processes pending products one per sequential query.                               | A lot search over 105 products required 111 handler executions and 1,338 indexed reads to return one match. A name search required 110 executions.                                      | [Pending-product search](../../../convex/finishedGoods/catalogue.ts#L261)                                                                   |
| P2 · Q3  | HR name search checks unrelated employees' legacy identity histories before matching their names. | One matching employee among 60 caused 300 audit documents to be read, although that employee had only 5. An unrelated 10,001-row history also made the answer report `complete: false`. | [Search ordering](../../../convex/hr/search.ts#L231), [identity fallback](../../../convex/hr/shared.ts#L240)                                |
| P3 · Q4  | Draft/archived registered-location filters scan active locations even though none can match.      | Each filter took 6 executions and read all 120 active location documents to return an empty result.                                                                                     | [Constant-false filter](../../../convex/finishedGoods/jobScanLocations.ts#L473)                                                             |
| P3 · Q5  | The legacy-unit query loads move state for batch units before discarding them.                    | 100 batch units plus 1 legacy unit caused 202 move lookups for a one-row result.                                                                                                        | [Hydration before filtering](../../../convex/finishedGoods/batches.ts#L550)                                                                 |

These specific findings were not in the earlier reports reviewed. Q3 comes from the uncommitted legacy-identity changes; the other four also exist in HEAD. The known warehouse-total retry lockout remains open but is not counted as a new finding.

## Fix order and review notes

1. Fix Q1 first: use a transitive quantity comparator with consistent unit and ID tie-breaks. Preserve the distinction between unit spellings unless normalisation is explicitly chosen. Keep the mixed-unit pagination regression.
2. Fix Q3 and Q5 by applying cheap matching or eligibility predicates before expensive history or move reads. Preserve all authorization and self-review checks for records that can be returned. Q4 can return an authorized, ready empty result immediately for impossible status filters.
3. Redesign Q2's bounded search step or add a compact search projection. Keep substring semantics, ordering and complete continuation. The observed 111 executions are exact for this fixture; `N + ceil(N/20)` is not universal because leading direct matches and multiple unit pages change it. The probe's 12-request threshold is a proposed performance budget, not an existing product contract or a validated guarantee for a replacement implementation. If using the detailed report's `take(51)` suggestion, continuation must depend on **raw rows**, including retired rows, and respect an overall read budget; counting only live rows could skip later matches.

The parent strengthened Q5's original fixture: its 100 batch units are now created through two real `commitBatch` mutations, each within the 50-package limit. The result remains 202 move lookups. This rules out the original fixture's draft-batch inconsistency as an explanation.

## Reproduction and checks

```sh
pnpm exec vitest run --config docs/reviews/query-performance-2026-10-15/kiro/vitest.config.mts --reporter=verbose
```

Expected on the audited application source: **7 failing probes and 2 passing controls/observations**. These deliberately assert corrected behavior or a proposed read budget. They live outside the normal test suites. Failures reproduce findings; they are not regressions introduced into the default suite.

The parent ran the full audit suite independently, then reran Q5 with the stronger fixture. Evidence: [independent verification](evidence/parent-verification.log), [Q5 through real batch writes](evidence/parent-legacy-verification.log), [Kiro run](evidence/kiro-probes.log).

Existing baseline checks independently passed: **7 files, 71 tests** across query caching, storage catalogues, inventory regressions, HR employee reads, catalogue pagination, job scans and catalogue synchronization. Kiro separately passed 37 existing integration tests ([log](evidence/baseline-integration.log)). The audit code passes targeted ESLint and TypeScript checks.

Counts describe local handler invocations and database API operations, not measured browser round trips, billed bytes or production latency. Fixture sizes are synthetic. No production data or browser session was used.

Only this audit directory was added or edited by this task. Pre-existing application source still matches the start-of-task hashes. Concurrent design-document edits were observed and left untouched.

[Detailed Kiro report](kiro-findings.md) · [Probe source](kiro/)
