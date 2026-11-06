# Staged attendance-period close

Status: implemented and covered by local fixtures. No production or load measurement has been run.

## Why

Creating or closing a period refused rosters above 50 employees (`PERIOD_TOO_LARGE`/`EMPLOYEES`), because the close recomputed and froze every row in one mutation, and the preview and exports read every row at once. Lock checks also read up to 1,000 of the site's periods for every covered-date write.

## Model

`hrPeriods.status` is `DRAFT | CLOSING | CLOSED`. The close runs in stages (`convex/hr/periodClose.ts`):

| Command                | Effect                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin`                | Requires a past period. Freezes it (`CLOSING`), records a snapshot time and timezone offset, inserts an **unpublished** version (`build` present), and runs the first step.                                                                                                                        |
| `advance(step)`        | Evaluates the next 25 employed people (scanning at most 100 roster documents), validates their sources against the snapshot, writes their frozen rows, and extends the running totals and fingerprint chain. A stale or duplicate step is refused (`PERIOD_CLOSE_STEP_STALE`) and changes nothing. |
| `publish(fingerprint)` | Publishes a `READY` build only if the fingerprint matches what the reviewer saw. It flips the version to published and the period to `CLOSED` in one transaction.                                                                                                                                  |
| `cancel`               | Switches to discard. Later `advance` calls delete staged rows 500 at a time, then return the period to `DRAFT`.                                                                                                                                                                                    |

These outcomes discard the attempt, record the reason on the period, and return it to `DRAFT`: an open day (`PERIOD_NOT_READY` / `PERIOD_SHIFT_UNFINISHED`, with the employee and date), an empty roster (`PERIOD_EMPTY`), or a source revised after the snapshot (`PERIOD_STALE`). The version number is not consumed. Totals become history only on publication. Until then, every history reader ignores the version: version lists, version by number, row pages, exports and employee frozen history.

Rosters of up to 50 employees keep the one-click flow. Their draft is previewed completely with the same fingerprint chain, and `begin` with that fingerprint checks the draft first, then builds and publishes in one transaction. The deprecated `hr/periods:close` is a thin shim over this path for tabs opened before the rollout. Remove it in a later contract release.

## Write guards while closing

`closedPeriodCovering` treats `CLOSING` like `CLOSED`, so clock-in/out, correction submit/decision, leave request/decision/restore and certification refuse with `HR_PERIOD_CLOSING`. Holiday save/delete on a covered date and any employee save at the site (old or new site) also refuse while a close is in progress. Each build step also checks employee, day and holiday revisions against the snapshot. A write that bypassed the guards discards the attempt instead of publishing a mixed snapshot.

The covered-date lookup now reads only the site's periods ending on or after the date (`by_orgId_warehouseId_endDate`). This is exact for legacy overlapping or overlong periods, so no data audit is required. It reads 2 periods instead of 261 for a recent date in the five-year fixture, and still refuses beyond 1,000 rather than truncating.

## Reads

- Draft: complete preview up to 50 employees; otherwise `PAGED`, reviewed through `draftEmployeesPage`.
- Closed: frozen rows inline up to 1,550 rows; otherwise `rowsPaged`, read through `versionRowsPage`.
- CSV export: parts of at most 2,000 rows that never split an employee (`cursor` / `continueCursor`). Each part is an audited command. The client joins the parts into one file identical to a single-part export.

## Interruption and recovery

The UI drives `advance` from the displayed step. Reopening the period resumes an interrupted close, and **Continue** resends the current step. Concurrent drivers are safe: one step applies and the others are refused. A close left `CLOSING` keeps the period's attendance frozen until someone continues, publishes or cancels it. No server-side scheduler drives it, and no business recovery objective is implied.

## Rollout

Schema changes are additive: the new status literal, optional fields and new indexes. Existing documents remain valid and need no backfill. Deploy the backend before the frontend. Old tabs keep the one-step close through the shim. They do not understand the new `PAGED`/`CLOSING` views and need a reload for large periods.
