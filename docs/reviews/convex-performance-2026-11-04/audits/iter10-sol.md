## Score: 7/10

- **Measured:** Final L recommendations still read 438/439 documents (~747 KB); reservation re-executes six subscriptions reading 1,053 documents/1,591.5 KB. This is substantially better than base's 6,098 documents, but still broad (`evidence/iter10.md`, recommendation and fan-out tables).
- **Measured:** Maximum deletion now succeeds atomically for the same 300 IDs using 2,486 of 4,096 read calls, 6,223 documents read and 2,074 writes. This closes the demonstrated accepted-limit failure for this corpus; it does not establish universal maximum-input safety (`evidence/iter10-delete-after.json`).
- **Measured:** Search maintenance remains expensive: current 50-delete reads 4,066 documents versus base 160. Eleven subsequent observed reindex completions read 45,897 documents and write 15,299; these are time-window totals, not isolated request attribution or eliminated work (`evidence/iter10-delete-followups.json`).
- **Measured:** Inventory still reads 469.4 KB in 35 documents; different-product creation incurs 52 OCC retries and one failure. The stopping point at iteration ten earns no score increase (`evidence/iter10.md`).

Independent reviewer: Sol. Frozen SHA `80a57bbdc0f6d4bb02a8331aa5c3966b063edc4f`; incremental `e8c7ac38..80a57bbd`, cumulative `80dc0a93..80a57bbd`. Read AGENTS.md, both briefs and my iteration 9 report. Inspected incremental source/tests and cumulative scope with prior independent findings carried forward; this is not a fresh exhaustive review of every cumulative line. No other auditor report read, delegation, tests, backend calls, deployments, imports or commits performed. Only this audit written; pre-existing untracked report.html untouched.

## Changes since last audit

- **Correct, inferred — exhausted-budget orphan deferral:** `convex/lib/jobScanSearch.ts:253` returns before term/link reads when no write budget remains. Released terms remain scheduled (`:553`), and deferred processing rechecks linkage (`:566`, `:257`) before deletion. Source/search-row removal remains in the transaction (`:408`); a concurrent relink participates in the indexed read conflict. No authorization or tenant boundary is relaxed. The new test checks 300 source deletions, empty search and eventual removal of rows/postings/terms (`tests/integration/job-scan-delete-limit.integration.test.ts:10`). Real-engine before failed at the 4,096 read-call limit with all 300 sources retained; after succeeds with 1,610 read calls remaining. Documents and read calls are different metrics. This is one corpus/sample, not latency-distribution or throughput evidence.
- **Correct, inferred — probe security:** `convex/staging/performanceLimits.ts:7` requires both explicit local-seed enablement and an exact loopback URL. Public visibility preserves acting-as identity; it calls the actual public mutation (`:32`), whose MANAGE permission, warehouse binding and selection validation remain (`convex/finishedGoods/jobScans.ts:583`). It grants no identity or tenant override. Hosted refusal and anonymous denial are covered (`tests/integration/job-scan-delete-limit.integration.test.ts:117`); tests do not separately exercise every role/tenant combination through the wrapper. Internal metrics also use the local guard. Hosted deployment must retain a hosted URL and disabled local-seed configuration.
- **Correct, inferred — legacy roster:** `convex/hr/roster.ts:406` obtains the bounded code-ordered employed population before UI filtering and hydration; `convex/hr/shared.ts:1185` handles former rows and code ties, refusing rather than truncating at its scan bound. The cap therefore applies before search/department filters, preserving the legacy contract. New 60-former/40-current and filtered-oversize cases supplement 49/50/51 coverage (`tests/integration/hr-roster-paging.integration.test.ts:90`, `:112`). Modern paging retains its prior path. Legacy calls can still scan historical employee rows up to the explicit bound.
- **Correct evidence repair:** Baseline previous-month roster omits candidate paging arguments; a refusal is not a successful equivalent answer. Final profile is seven uncached samples after identical L restore, with queries, flows, fan-out and contention. Candidate profile at ad175269 has backend identical to c4ff5087/frozen final (no Convex diff). After-delete evidence explicitly records dirty HEAD 5f0a51c7 with backend later committed unchanged as c4ff5087; do not identify that sample by HEAD alone. The diagnostic logging was temporary and excluded from the final source.
- **Validation, reported rather than rerun:** 28 HR tests and final combined 60 tests/six files pass; full ESLint and Convex typecheck pass. Iteration 9 broader search's ten tests now passed. Entire iteration 8 suite remains 5,704 passed/two unresolved intermittent failures. Last full real-engine parity remains iteration 8's 537 traversals/300 needles; there is no new iteration 10 parity claim (`evidence/iter10-notes.md`).

## Findings (ranked by impact, max 10)

### 1. Partially resolved — search write amplification and deferred cleanup
- Location: `convex/lib/jobScanSearch.ts:253`, `:377`, `:553`, `:562`; caller `convex/finishedGoods/jobScans.ts:583`.
- Evidence — measured: 50-save writes 1,253 documents/5,368 index rows; 50-delete reads 4,066 versus 160 base. Maximum-delete evidence and substantial follow-up totals are above.
- Cost mechanism — inferred: substring postings and orphan checks multiply work; deferral protects the foreground transaction but shifts work into scheduled transactions.
- Fix: measure diverse sustained churn, queue lag, cleanup failure recovery and input extremes; reduce redundant term/posting work while retaining exact substring results, atomic source/link deletion and tenant checks.
- Expected impact and risk: lower write/read amplification and backlog. Maximum-delete failure is resolved for the measured corpus; previous finding 2 remains partially resolved overall. Do not remove cleanup to improve foreground numbers.

### 2. Partially resolved — broad compatible-zone subscriptions
- Location: `convex/finishedGoods/workflow.ts:1347`; `convex/lib/zoneSurfaces.ts:345`.
- Evidence — measured: 438/439 recommendation reads; reservation/cancellation fan-out six queries and 1,053 reads. Viewed-zone preview is only 16 reads (`evidence/iter10.md`).
- Cost mechanism — inferred: all compatible zones participate in ranking and share invalidation dependencies.
- Fix: incrementally maintain/evaluate candidates while retaining full ordering, fit reasons and authorization; verify unrelated-zone invalidation and full ranking parity.
- Expected impact and risk: reduce repeated screen work; semantic ranking regressions are the principal risk. Previous finding 1 partially resolved.

### 3. Open — shared sequence contention
- Location: `convex/finishedGoods/workflow.ts:117`.
- Evidence — measured: different-product burst 52 retries/one failure; base also has one failure. Same-product candidate 43 retries/no failures. Same-zone reservations yield seven business refusals per target, not successful throughput gains (`evidence/iter10.md`).
- Cost mechanism — inferred: shared warehouse numbering serializes allocations.
- Fix: define acceptable throughput and tail latency, then change allocation only with an explicit numbering-contract decision.
- Expected impact and risk: remove or characterize the retained ceiling without duplicate/gapped identifiers contrary to the contract. Previous finding 4 open; no newly introduced regression established.

### 4. Partially resolved — dense inventory bytes and recovery headroom
- Location: `convex/lib/zoneOccupancy.ts:428`, `:548`; `convex/storageLayouts/zoneOccupancyBackfill.ts:114`, `:224`.
- Evidence — measured: 35 inventory reads carry 469.4 KB. Profile setup uses ten-row backfill pages and timeout retry, not production-default time-headroom proof.
- Cost mechanism — inferred: large per-zone arrays couple bytes and writes; zone-boundary stopping can exceed the between-zone threshold.
- Fix: establish dense-zone/default-backfill bounds and successful non-overlapping reservation throughput; partition only while preserving atomic capacity and parity.
- Expected impact and risk: smaller payloads, more predictable recovery. Previous finding 3 partially resolved; generation guard remains resolved by prior inspection/coverage.

### 5. Open — unsupported bypass-writer recovery
- Location: `convex/lib/searchReadiness.ts:26`; `convex/finishedGoods/searchIndexBackfill.ts:389`, `:453`, `:648`.
- Evidence — inferred: creation windows cannot discover arbitrary old-name changes or raw deletions without meaningful stamps/invalidation. No new maintained-writer defect identified.
- Cost mechanism: incomplete postings can yield false negatives; live candidate verification cannot restore missing candidates.
- Fix: require explicit invalidation/rebuild in import/repair procedures or durable change capture and bounded reconciliation.
- Expected impact and risk: completeness with controlled maintenance cost. Previous finding 5 open.

### 6. Partially resolved — rollout evidence gaps
- Location: `scripts/performance/convex/profile.mjs:314`; `tests/integration/job-scan-delete-limit.integration.test.ts:10`; `evidence/iter10-notes.md`.
- Evidence — measured/reported: restored seven-sample profile and maximum-delete probe improve coverage; only 126 products, one maximum-delete corpus, no fresh full engine parity, two unresolved full-suite failures.
- Cost mechanism — inferred: one successful bound does not constrain every text distribution, dense zone, cleanup backlog or production backfill duration.
- Fix: stage rollout with readiness/backfill completion checks, cleanup lag/error monitoring, read-call/byte headroom alerts, production-shaped catalogue/dense-zone trials and explicit rollback/invalidation procedures. Resolve or formally isolate the outstanding suite failures before claiming clean validation.
- Expected impact and risk: stronger operational confidence; no performance score credit for planned validation. Previous finding 6 partially resolved; previously unfinished search tests are now resolved.

## Already good (brief)

Selective tenant-scoped pages, maintained totals, exact indexed substring readers, narrow zone preview, generation-owned recovery and orphan cleanup materially improve the baseline. Iteration 9 bounded building reconciliation and occupancy-generation protections remain intact. No new authorization, ordering or data-integrity regression identified in inspected incremental changes. Legacy roster compatibility defect is repaired. Residual core costs justify retaining 7/10 rather than promoting the score for completion of the audit cycle.

## What would raise the score to 9+

Demonstrate materially lower search maintenance amplification and recommendation invalidation, bounded dense inventory payloads, acceptable sequence throughput without OCC failures, and production-default recovery headroom. Complete fresh semantic parity for affected maintenance paths and rollout monitoring for readiness and deferred work. Preserve exact search, tenant isolation, legacy refusal behavior and atomic mutations throughout.
