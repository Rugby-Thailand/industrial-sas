# Filter, search and pagination delivery

Integration draft — final checks and release status to be filled after all slices land.

Kiro wrote the implementation in three isolated worktrees; GPT-6.1-Sol independently audited coverage, location behavior, operations and HR. The original working tree was preserved.

## Requested behavior

| Request                        | Delivery                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Slow known location search     | Authorized exact lookup renders independently of catalogue completion; typed text does not automatically select a location.                |
| No locations with blank search | First eligible page loads on opening the picker, with distinct loading, empty, denial and recovery states.                                 |
| Location pagination            | Bounded server traversal, Previous/Next and compatible page sizes, including sparse matches and older physical descendants.                |
| Icon building filter           | Accessible icon opens independently paged building choices; building selection is enforced by the backend and retained while typing.       |
| Pagination across collections  | The inventory below covers growing collections; complete forms, calendars, geometry and bounded snapshots retain their authoritative data. |

## Collection coverage

| Collections                                                                                                                       | Paging behavior                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Location picker and physical catalogue                                                                                            | Bounded indexed traversal with complete sparse-search continuation; exact selection independent.            |
| Named location catalogue and building cards                                                                                       | Existing catalogue pagination retained; derived sorts still have full-domain cost.                          |
| Saved scans                                                                                                                       | Bounded source search, progressive matches and explicit recovery; visible-row mutation selection.           |
| Finished-goods product/unit catalogue, product batches, legacy units                                                              | Existing cursor pages retained.                                                                             |
| Move history, stack candidates                                                                                                    | New source pages; selected candidate and active-move validation independent of the current page.            |
| Destination recommendations                                                                                                       | Presentation pages over the complete globally ranked result; selected/recommended choice remains available. |
| Floor tables/mobile location lists                                                                                                | Existing presentation pages retained; authoritative geometry remains complete.                              |
| HR employees, attendance review, manager leave queue, administrative periods                                                      | New source pages with server criteria and authorized-site traversal.                                        |
| HR holidays, access members, employee audit, account/supervisor options                                                           | New source pages; selected identities and editor drafts remain independent of option pages.                 |
| HR period blockers and employee summaries                                                                                         | Presentation pages over the complete period calculation; close/export still use all data.                   |
| HR older versions and day correction history                                                                                      | Complete discovery/explicit paged-history navigation.                                                       |
| HR correction requests, employee leave history, announcements, receipts, notifications, payslips/imports, employee frozen periods | Existing source continuation retained and navigation state improved.                                        |
| AI grouped usage and filter dimensions                                                                                            | Group presentation pages; independent server-paged user/warehouse options with off-page labels.             |
| AI recent activity and exports                                                                                                    | Existing cursor continuation retained.                                                                      |

Finite exceptions: packing/repacking drafts (50 packages), structural layout drafts and collision geometry, one selected calendar month/year, complete frozen period snapshots (50 employees × 31 days), bounded leave/correction revisions and AI attempts. See the detailed [coverage audit](sol-coverage.md) for the actual write/domain limits.

## Audit problem list

Final disposition is documented in the location, operations and HR reports. Fixes include premature missing-location prompts, legacy cursor duplication, unsafe retained-row actions, ineffective retries, stalled scans, missing late-site records and pagination-history collisions. No audit is represented as production latency evidence.

Remaining performance work:

1. Arbitrary substring search still scans bounded batches. A sparse match can require many requests; a maintained text-search projection would reduce total work.
2. Derived catalogue sorts and destination recommendation ranking still require full-domain computation. Presentation pagination reduces rendered rows, not that computation.
3. AI summary aggregation remains explicitly partial beyond its 3,000-row scan budget; model/environment choices still derive from that summary.
4. Some batch/legacy readers still scan historical rows before filtering, and complete floor geometry is loaded for editing/collision validation.

## Local performance evidence

Authenticated handler harness, 1,000 physical locations. These count requests/reads in a deterministic local fixture; they do not measure hosted wall-clock latency.

| Journey                                   | Before            | Revised backend  |
| ----------------------------------------- | ----------------- | ---------------- |
| First exact/prefix match in picker search | Response 50       | Response 1       |
| Complete sparse-label picker search       | 50 requests       | 3 requests       |
| Complete no-match picker search           | 50 requests       | 3 requests       |
| Sparse physical-location catalogue search | 2,000 requests    | 4 requests       |
| First blank picker page                   | 122 document gets | 25 document gets |

The separate exact resolver remains one request. The UI now renders its authorized answer without waiting for broader catalogue completion. Raw [before](kiro-locations-before.json) and [revised](kiro-locations-after-final.json) counts include the remaining index-query cost, which still scales with substring search. The optional building-field backfill is not a prerequisite for correctness.

## Verification

- Baseline: 300 files / 3,879 tests passed before implementation.
- Operations integration checkpoint: 303 files / 3,949 tests, both TypeScript checks and lint passed.
- Final combined suite, code generation, formatting, build, browser checks and CI: pending.
- Browser transport fixtures use synthetic data. Their interaction timings are not hosted performance measurements. Initial T3 desktop checks passed; screenshot and native mobile-resize automation failed. Final responsive checks: pending.
- Hosted baseline observations and local handler read counts are retained separately; final hosted latency is not yet measured.
