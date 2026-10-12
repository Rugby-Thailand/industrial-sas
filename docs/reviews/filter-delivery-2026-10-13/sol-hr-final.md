# Sol HR backend follow-up — tested worker snapshot

October 13, 2026. Read-only audit against actual handlers in `/Users/macbook/Development/industrial-sas-filter-hr`, based on `11c8c2cc`. Kiro was still finishing frontend recovery/history work. Despite this requested filename, this is **not final integrated/UI/release approval**. No product edits, browser, production calls, commits or deployment were performed by the auditor. Supplemental test/config files were created only in a temporary directory outside the repository.

## Result

No unresolved backend authorization/reachability failure was established in the final tested snapshot. The former site51 defect is fixed for the new list/choice endpoints and the reviewed direct detail, decision, period-close and export paths. A newly introduced cross-site review continuation stall was reproduced in the existing actual-handler regression, sent to the parent, fixed by the parent, and independently reverified below.

The previously reported frontend recovery, retained-action, history/selector and discovery UI fixes remain outside this backend verdict. Additive old-client list endpoints retain their explicit legacy caps; the new endpoint contracts provide complete traversal.

## Concrete regression found and resolved during audit

Before the parent patch, `tests/integration/hr-pagination.integration.test.ts` failed:

> review queue pages → pages employee groups so every open issue beyond 500 items stays reachable

The actual query returned more than 400 scan continuations without settling. `review.queuePage` uses `peekLanes:0` to bound employee/day evaluation. The helper's following-lane loop broke when its peek budget was zero **before persisting the next unfinished lane**, so it returned the same finished old lane repeatedly. This also occurred when an active following site had no employees.

The parent split the full-page and zero-budget conditions at `convex/hr/pagination.ts:311–327`: zero-budget lookahead now records the next lane with `finished:false, range:{}` so the next request reads it natively. No auditor product edit was made. After that patch the existing full HR pagination test passed, and an independent 60-site review traversal returned all 60 employee groups in 64 requests without stalling. The request count includes empty site/lane boundaries; it is not a production latency measurement.

## Independent actual-handler probes

These probes reused the repository's `createConvexTenantWorld`, `seedConvexAuthorization`, actual exported `_handler` functions, and the same per-transaction `readPage`/`traverse` rules as the existing integration harness. They were not the earlier in-memory fake-adapter tests.

| Scenario                                          | Fixture and assertions                                                                                                                                                                                                                                                                   | Result                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| All authorized sites beyond 50                    | Added 60 active sites/grants and one employee/site to a warehouse-scoped HR administrator. Traversed `setup.employeesPage`; compared all IDs, count 60 and unique count 60. Switched the same actor to ORG_WIDE and repeated full traversal/direct late-site selection.                  | Pass; all 60 employees reachable in both modes                                                      |
| Direct site outside preload                       | Read the actor's grants in the actual index order and chose grant index 55. Queried employee list by that exact site and employee editor by ID.                                                                                                                                          | Pass; direct late site/employee reachable                                                           |
| Complete site choices and selected off-page label | Traversed `access.sitesPage` over61 allowed active site choices. Queried with an impossible search plus `selectedId` at the late site, then removed its grant.                                                                                                                           | Pass; zero search rows with authorized exact selected label; selected becomes null after revocation |
| Review queue/detail/decision at late site         | Queried October 8 review groups at the late site and by exact day; traversed the whole 60-site team; applied actual ABSENT disposition to the late employee.                                                                                                                             | Pass; direct decision writes; 60 groups complete after fixed continuation                           |
| Leave queue/detail/decision at late site          | Seeded a valid discretionary annual request at that site. Queried exact detail, traversed queue, and applied actual Return decision.                                                                                                                                                     | Pass; request reachable and decision writes                                                         |
| Period create/close/full export at late site      | Used a complete finite nonworking 2-day period for the late employee; actual create, preview, fingerprint-based close, list and frozen export.                                                                                                                                           | Pass; period and frozen export reachable independently of list position                             |
| Revoked late-site grants                          | Deleted the actual grant, then queried employee/day/leave/period/version detail and selected site; attempted attendance/leave decision, frozen export and replay of the previously successful close request.                                                                             | Pass; access refused, no replay/write bypass; selected label null                                   |
| Older period versions                             | Seeded 151 retained versions. Traversed `periods.versionsPage` and compared exact sequence 151→1; foreign-organization lookup refused.                                                                                                                                                   | Pass; all 151 discoverable without the old 50-version selector bound                                |
| Older day corrections                             | Seeded 45 requests for one exact reviewable day. Traversed `review.dayCorrectionsPage`, asserted 45 unique IDs; foreign organization refused.                                                                                                                                            | Pass; all 45 reachable beyond detail's newest 20                                                    |
| Indexed year read bounds                          | Seeded2,000 holidays outside 2010 plus 151 inside 2010. Wrapped the real database queries to inspect returned index rows. Administrative 2010 page returned 20 rows with one native page and no out-of-year index rows. Personal 2010 calendar made one indexed query returning all 151. | Pass; unrelated calendar history is excluded before reading result rows                             |

Sparse matching, status/site criteria, retained-ID changes, malformed/foreign/criteria/page-size cursors and tenant isolation are also covered by the existing handler batch below. Unsigned cursor edits are not credentials: retained rows are reloaded through tenant access and current endpoint authorization. Malicious callers changing their own traversal order were not misclassified as access failures.

## Commands and results

After the parent correction:

```sh
pnpm exec vitest run tests/integration/hr-pagination.integration.test.ts tests/integration/hr-employee-reads.integration.test.ts tests/integration/hr-final-review.integration.test.ts tests/integration/hr-policy-leave.integration.test.ts
```

**4 files, 52 tests passed**, 1.00 s. This includes the initially failing multi-site review case. A pre-patch run had 51 passed / 1 failed; that failure is not being hidden as a moving-UI issue.

```sh
pnpm exec vitest run tests/integration/tenant-storage.integration.test.ts tests/isolation/tenant-storage.isolation.test.ts tests/integration/hr-review-completion.integration.test.ts tests/integration/hr-frozen-requests.integration.test.ts
```

**4 files, 60 tests passed**,542ms.

Supplemental outside-repo probe:

```sh
pnpm exec vitest run --config /var/folders/m6/xkxc506x2z31wxpkssyvcch40000gn/T/sol-hr-backend-yshgufih/vitest.config.mts
```

**1 file, 3 tests passed**,719ms. The adjacent `backend.test.ts` contains the 60-site/grant/detail/decision/close/revocation probe, 151-version/45-correction probe, and instrumented2,000-unrelated-calendar probe. It imports actual current-worker source by absolute path. The config derives the worker integration project but includes only that temporary test. Early probe runs exposed two auditor fixture/call mistakes (missing required policy fields and using `periods.page` instead of `periods.listPage`); those were corrected in the temporary probe, not reported as application defects. Final refusal assertions follow the actual `{written:false,error:{code}}` mutation contract.

Reproduction after temporary-directory cleanup: reuse the helpers at the top of `tests/integration/hr-pagination.integration.test.ts`, add 60 active warehouse/grant rows and one employee/site, choose the 56th grant in index order rather than assuming creation order, and execute the endpoint/action/assertion matrix above. This specifically catches the preloaded 50-site gap; 51 warehouse codes alone do not prove a warehouse-scoped late grant was exercised.

## Audited backend fingerprints

These files had unchanged hashes across the final probe/batch checks. Later edits require a fresh targeted check; the worker was not a committed immutable snapshot.

| File                      | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `convex/hr/pagination.ts` | `084b71a6b011af4b6a99cd4e2d967b21424c06e66109fba0ad835ea3b138a94c` |
| `convex/hr/shared.ts`     | `c714bad4695ea34afc45d44fd1a001049280aeb53c8b5a560b64aae56678929e` |
| `convex/hr/setup.ts`      | `8f03a1662e19e7cbab98670df792dd780fa48428e54b12a3c121b6fe4df75667` |
| `convex/hr/review.ts`     | `fe074e16991f1f38b95b21c0db60ef371f202876057a7012764ad61404eedfb0` |
| `convex/hr/leave.ts`      | `b9a3d3ae1689af9c1e5211130bc5e519ef5c6832953209658c0d29e86890f192` |
| `convex/hr/periods.ts`    | `977d5a0a56b6382ef17e19af786177bad314ed80f19d3174ad683b7def8fdee6` |
| `convex/hr/self.ts`       | `6c77cf15fbc236bc3c1a23792173ffe3ad070ca716cc686f41ccb58a515dccb1` |
| `convex/hr/access.ts`     | `00c6dad2a28a4955f763ebf8f3398fe51c68c3f387f412ff678f4bf759ca7066` |

## Remaining verification limits

These are local actual-handler integration fixtures, not live Convex production profiling. They establish exercised authorization, traversal, mutations and index-row bounds; they do not establish native reactive split behavior under real concurrent workload, production p95 latency, migration deployment readiness, or complete frontend recovery/Back/keyboard behavior. The checked finite CSV still comes from complete frozen rows, not visible page slices. Final integrated API/schema/reference checks and browser verification remain release gates.
